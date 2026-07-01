package auth

import (
	"context"
	"net/http"
	"time"

	"github.com/ishchibormi/backend/config"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Handler struct {
	cfg   config.Config
	otp   *OTPRepo
	users *mongo.Collection
}

func NewHandler(cfg config.Config, db *mongo.Database) *Handler {
	return &Handler{
		cfg:   cfg,
		otp:   NewOTPRepo(db, cfg.OTPTTL, cfg.OTPLength),
		users: db.Collection("users"),
	}
}

// Users exposes the users collection for wiring auth middleware in main.
func (h *Handler) Users() *mongo.Collection { return h.users }

type requestOTPResp struct {
	TGToken  string `json:"tgToken"`
	BotURL   string `json:"botUrl"`
	DevCode  string `json:"devCode,omitempty"`
	DevPhone string `json:"devPhone,omitempty"`
}

func (h *Handler) RequestOTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tok, err := h.otp.RequestToken(ctx)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	resp := requestOTPResp{TGToken: tok}
	// Username sozlanmagan bo'lsa bo'sh qoldiramiz — aks holda "https://t.me/?start="
	// kabi buzuq havola qaytadi va frontend zaxira havolasi (NEXT_PUBLIC_BOT_USERNAME)
	// hech qachon ishlamaydi.
	if h.cfg.TelegramBotUsername != "" {
		resp.BotURL = "https://t.me/" + h.cfg.TelegramBotUsername + "?start=" + tok
	}
	httpx.JSON(w, 200, resp)
}

type verifyReq struct {
	Token string `json:"token"`
	Phone string `json:"phone"`
	Code  string `json:"code" validate:"required"`
}

type verifyResp struct {
	AccessToken  string             `json:"accessToken"`
	RefreshToken string             `json:"refreshToken"`
	User         models.User        `json:"user"`
}

func (h *Handler) VerifyOTP(w http.ResponseWriter, r *http.Request) {
	var req verifyReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	if req.Code == "" {
		httpx.Err(w, httpx.NewError(400, "bad_request", "code required"))
		return
	}
	ctx := r.Context()
	var (
		phone string
		tgID  int64
		err   error
	)
	// SECURITY: verification MUST be bound to a specific OTP record — either the
	// deep-link token (normal flow) or the user's own phone number. The previous
	// "match by code only" fallback let an attacker brute-force the 6-digit space
	// against EVERY active code in the database and log in as an arbitrary user
	// (account takeover). That path has been removed.
	switch {
	case req.Token != "":
		phone, tgID, err = h.otp.VerifyByToken(ctx, req.Token, req.Code)
	case req.Phone != "":
		phone, tgID, err = h.otp.VerifyByPhone(ctx, req.Phone, req.Code)
	default:
		httpx.Err(w, httpx.NewError(400, "bad_request", "token or phone required"))
		return
	}
	if err != nil {
		httpx.Err(w, httpx.NewError(401, "invalid_code", "invalid or expired code"))
		return
	}
	if phone == "" {
		httpx.Err(w, httpx.NewError(401, "no_phone_bound", "bot has not bound phone yet"))
		return
	}
	user, err := h.upsertUser(ctx, phone, tgID)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	access, err := httpx.IssueUserToken(h.cfg.JWTAccessSecret, user.ID.Hex(), h.cfg.JWTAccessTTL)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	refresh, err := httpx.IssueUserToken(h.cfg.JWTRefreshSecret, user.ID.Hex(), h.cfg.JWTRefreshTTL)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, verifyResp{AccessToken: access, RefreshToken: refresh, User: *user})
}

func (h *Handler) upsertUser(ctx context.Context, phone string, tgID int64) (*models.User, error) {
	now := time.Now()
	filter := bson.M{"phone": phone}
	update := bson.M{
		"$setOnInsert": bson.M{
			"createdAt":           now,
			"firstName":           "",
			"lastName":            "",
			"rating":              0.0,
			"reviewsCount":        0,
			"completedJobsCount":  0,
			"langPref":            "latin",
			"themePref":           "light",
			"isPremium":           false,
			"isBlocked":           false,
			"isDeleted":           false,
			"onboardingCompleted": false,
		},
		"$set": bson.M{
			"phone":           phone,
			"telegramId":      tgID,
			"isPhoneVerified": true,
			"updatedAt":       now,
		},
	}
	opts := options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After)
	var u models.User
	err := h.users.FindOneAndUpdate(ctx, filter, update, opts).Decode(&u)
	return &u, err
}

type refreshReq struct {
	RefreshToken string `json:"refreshToken"`
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	uid, err := httpx.ParseUserToken(h.cfg.JWTRefreshSecret, req.RefreshToken)
	if err != nil {
		httpx.Err(w, httpx.NewError(401, "bad_refresh", "invalid refresh token"))
		return
	}
	access, err := httpx.IssueUserToken(h.cfg.JWTAccessSecret, uid, h.cfg.JWTAccessTTL)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]string{"accessToken": access})
}

// DevPeekOTP — dev-only endpoint that returns the most recent OTP for a token.
// Guarded by config.OTPDevReturn.
func (h *Handler) DevPeekOTP(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.OTPDevReturn {
		httpx.Err(w, httpx.NewError(404, "not_found", "dev peek disabled"))
		return
	}
	tok := r.URL.Query().Get("token")
	if tok == "" {
		httpx.Err(w, httpx.NewError(400, "bad_request", "token required"))
		return
	}
	doc, err := h.otp.LatestForToken(r.Context(), tok)
	if err != nil {
		httpx.JSON(w, 200, map[string]any{"code": "", "phone": "", "telegramId": 0})
		return
	}
	httpx.JSON(w, 200, map[string]any{
		"code":       doc.Code,
		"phone":      doc.Phone,
		"telegramId": doc.TelegramID,
	})
}

// RequireActiveUser is middleware that runs AFTER httpx.UserAuth. It rejects
// requests from accounts that have been blocked or soft-deleted, so an admin's
// block/delete actually revokes API access instead of only hiding the user.
func RequireActiveUser(users *mongo.Collection) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			oid, err := primitive.ObjectIDFromHex(httpx.UserID(r))
			if err != nil {
				httpx.Err(w, httpx.NewError(401, "bad_token", "bad user id"))
				return
			}
			var u models.User
			err = users.FindOne(r.Context(), bson.M{"_id": oid}).Decode(&u)
			if err != nil {
				httpx.Err(w, httpx.NewError(401, "no_account", "account not found"))
				return
			}
			if u.IsBlocked || u.IsDeleted {
				httpx.Err(w, httpx.NewError(403, "account_disabled", "account is blocked or deleted"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Used by /api/me to expand the current user object.
func LoadUser(ctx context.Context, users *mongo.Collection, idHex string) (*models.User, error) {
	oid, err := primitive.ObjectIDFromHex(idHex)
	if err != nil {
		return nil, httpx.NewError(401, "bad_token", "bad user id")
	}
	var u models.User
	if err := users.FindOne(ctx, bson.M{"_id": oid}).Decode(&u); err != nil {
		return nil, httpx.NewError(404, "not_found", "user not found")
	}
	return &u, nil
}
