package admin

import (
	"context"
	"encoding/csv"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/config"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/notification"
	"github.com/ishchibormi/backend/internal/upload"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
	"github.com/ishchibormi/backend/pkg/totp"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/crypto/bcrypt"
)

// validRoles enumerates the admin roles the panel understands. Kept in sync with
// the RBAC guards wired in cmd/api/main.go and the seed.
var validRoles = map[string]bool{"superadmin": true, "moderator": true, "support": true}

type Handler struct {
	Cfg      config.Config
	Admins   *mongo.Collection
	Users    *mongo.Collection
	Elons    *mongo.Collection
	Cats     *mongo.Collection
	Reports    *mongo.Collection
	Feedback   *mongo.Collection
	AuditCol   *mongo.Collection
	Broadcasts *mongo.Collection
	Notify     *notification.Service
	Apps       *mongo.Collection
	Storage    *storage.Service
}

func NewHandler(cfg config.Config, db *mongo.Database, n *notification.Service, s *storage.Service) *Handler {
	return &Handler{
		Cfg:      cfg,
		Admins:   db.Collection("admins"),
		Users:    db.Collection("users"),
		Elons:    db.Collection("elons"),
		Cats:     db.Collection("categories"),
		Reports:    db.Collection("reports"),
		Feedback:   db.Collection("feedback"),
		AuditCol:   db.Collection("admin_audit"),
		Broadcasts: db.Collection("broadcasts"),
		Notify:     n,
		Apps:       db.Collection("applications"),
		Storage:    s,
	}
}

// pageParams reads ?page & ?limit with safe bounds (1-based page, 1..100 limit,
// default 20) and returns the Mongo skip for that page.
func pageParams(r *http.Request) (page, limit int, skip int64) {
	page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ = strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	return page, limit, int64((page - 1) * limit)
}

// paged is the standard shape for admin list responses, matching the public
// feed ({items,page,limit,total}) so the frontend can paginate uniformly.
func paged(w http.ResponseWriter, items any, page, limit int, total int64) {
	httpx.JSON(w, 200, map[string]any{"items": items, "page": page, "limit": limit, "total": total})
}

// escRe safely quotes free-text search input for use inside a MongoDB $regex so
// a user-supplied "." or "(" can't change the match semantics or cause errors.
func escRe(s string) string { return regexp.QuoteMeta(s) }

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

// slugify builds a URL-safe slug from a category name (lowercase, non-alnum -> "-").
func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = slugRe.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

func startOfToday() time.Time {
	n := time.Now()
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, n.Location())
}

// find decodes up to `limit` documents matching `filter`, newest first by
// `sortField`. Errors yield an empty (non-nil) slice — the admin detail view
// prefers partial data over a hard failure.
func find[T any](ctx context.Context, col *mongo.Collection, filter bson.M, sortField string, limit int64) []T {
	out := []T{}
	cur, err := col.Find(ctx, filter, options.Find().SetSort(bson.D{{Key: sortField, Value: -1}}).SetLimit(limit))
	if err != nil {
		return out
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var v T
		if cur.Decode(&v) == nil {
			out = append(out, v)
		}
	}
	return out
}

func decodeElons(ctx context.Context, col *mongo.Collection, f bson.M, n int64) []models.Elon {
	return find[models.Elon](ctx, col, f, "createdAt", n)
}
func decodeApps(ctx context.Context, col *mongo.Collection, f bson.M, n int64) []models.Application {
	return find[models.Application](ctx, col, f, "appliedAt", n)
}
func decodeReports(ctx context.Context, col *mongo.Collection, f bson.M, n int64) []models.Report {
	return find[models.Report](ctx, col, f, "createdAt", n)
}

type loginReq struct {
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required"`
	Code     string `json:"code"` // TOTP code, only when 2FA is enabled
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	var a models.Admin
	if err := h.Admins.FindOne(r.Context(), bson.M{"username": req.Username, "isActive": true}).Decode(&a); err != nil {
		h.auditRaw(r.Context(), primitive.NilObjectID, "login_failed", req.Username, "no such active admin")
		httpx.Err(w, httpx.NewError(401, "bad_credentials", "invalid credentials"))
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(a.PasswordHash), []byte(req.Password)); err != nil {
		h.auditRaw(r.Context(), a.ID, "login_failed", req.Username, "bad password")
		httpx.Err(w, httpx.NewError(401, "bad_credentials", "invalid credentials"))
		return
	}
	// Second factor. When enabled, a valid TOTP code is required. A missing code
	// returns "totp_required" so the client can prompt for it, then resubmit.
	if a.TOTPEnabled {
		if strings.TrimSpace(req.Code) == "" {
			httpx.Err(w, httpx.NewError(401, "totp_required", "2FA code required"))
			return
		}
		if !totp.Validate(a.TOTPSecret, req.Code) {
			h.auditRaw(r.Context(), a.ID, "login_failed", req.Username, "bad 2FA code")
			httpx.Err(w, httpx.NewError(401, "bad_totp", "invalid 2FA code"))
			return
		}
	}
	tok, err := httpx.IssueAdminToken(h.Cfg.JWTAccessSecret, a.ID.Hex(), a.Role, h.Cfg.JWTAccessTTL)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.auditRaw(r.Context(), a.ID, "login_success", a.Username, "")
	httpx.JSON(w, 200, map[string]any{"accessToken": tok, "admin": a})
}

// auditRaw writes an audit entry with an explicit admin id (used where the admin
// isn't yet in the request context, e.g. login attempts).
func (h *Handler) auditRaw(ctx context.Context, adminID primitive.ObjectID, action, target, detail string) {
	_, _ = h.AuditCol.InsertOne(ctx, models.AdminAudit{
		AdminID: adminID, Action: action, Target: target, Detail: detail, CreatedAt: time.Now(),
	})
}

func (h *Handler) audit(r *http.Request, action, target, detail string) {
	aid, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	h.auditRaw(r.Context(), aid, action, target, detail)
}

// Dashboard returns the KPI cards for the overview screen. Each metric is a
// cheap CountDocuments; heavier time-series live under Stats.
func (h *Handler) Dashboard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	notDeleted := bson.M{"isDeleted": bson.M{"$ne": true}}
	today := bson.M{"createdAt": bson.M{"$gte": startOfToday()}}

	count := func(col *mongo.Collection, filter bson.M) int64 {
		n, _ := col.CountDocuments(ctx, filter)
		return n
	}
	merge := func(a, b bson.M) bson.M {
		m := bson.M{}
		for k, v := range a {
			m[k] = v
		}
		for k, v := range b {
			m[k] = v
		}
		return m
	}

	httpx.JSON(w, 200, map[string]any{
		"users":           count(h.Users, notDeleted),
		"activeUsers":     count(h.Users, merge(notDeleted, bson.M{"isBlocked": bson.M{"$ne": true}})),
		"blockedUsers":    count(h.Users, bson.M{"isBlocked": true}),
		"todayUsers":      count(h.Users, merge(notDeleted, today)),
		"elons":           count(h.Elons, notDeleted),
		"recruitingElons": count(h.Elons, merge(notDeleted, bson.M{"status": "recruiting"})),
		"filledElons":     count(h.Elons, merge(notDeleted, bson.M{"status": "filled"})),
		"todayElons":      count(h.Elons, merge(notDeleted, today)),
		"completed":       count(h.Apps, bson.M{"status": "completed"}),
		"openReports":     count(h.Reports, bson.M{"status": "open"}),
		"openFeedback":    count(h.Feedback, bson.M{"status": "open"}),
	})
}

type dayPoint struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// dailySeries returns one point per day for the last `days` days (gaps filled
// with 0) counting documents by their createdAt date. Used for growth charts.
func dailySeries(ctx context.Context, col *mongo.Collection, days int) []dayPoint {
	since := startOfToday().AddDate(0, 0, -(days - 1))
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"createdAt": bson.M{"$gte": since}, "isDeleted": bson.M{"$ne": true}}}},
		{{Key: "$group", Value: bson.M{
			"_id":   bson.M{"$dateToString": bson.M{"format": "%Y-%m-%d", "date": "$createdAt"}},
			"count": bson.M{"$sum": 1},
		}}},
	}
	counts := map[string]int{}
	if cur, err := col.Aggregate(ctx, pipeline); err == nil {
		defer cur.Close(ctx)
		for cur.Next(ctx) {
			var row struct {
				ID    string `bson:"_id"`
				Count int    `bson:"count"`
			}
			if cur.Decode(&row) == nil {
				counts[row.ID] = row.Count
			}
		}
	}
	out := make([]dayPoint, 0, days)
	for i := 0; i < days; i++ {
		d := since.AddDate(0, 0, i).Format("2006-01-02")
		out = append(out, dayPoint{Date: d, Count: counts[d]})
	}
	return out
}

// Stats powers the analytics widgets: 30-day growth curves, the application
// funnel, top categories and regional distribution — all via aggregation.
func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	// Time range for the growth curves: 7 | 30 | 90 days (default 30).
	days := 30
	switch r.URL.Query().Get("days") {
	case "7":
		days = 7
	case "90":
		days = 90
	}

	// Application funnel — counts per status.
	funnel := map[string]int{}
	if cur, err := h.Apps.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$group", Value: bson.M{"_id": "$status", "count": bson.M{"$sum": 1}}}},
	}); err == nil {
		defer cur.Close(ctx)
		for cur.Next(ctx) {
			var row struct {
				ID    string `bson:"_id"`
				Count int    `bson:"count"`
			}
			if cur.Decode(&row) == nil {
				funnel[row.ID] = row.Count
			}
		}
	}

	// Top categories by number of (non-deleted) elons.
	type nameCount struct {
		Name  string `json:"name" bson:"_id"`
		Count int    `json:"count" bson:"count"`
	}
	topCats := []nameCount{}
	if cur, err := h.Elons.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"isDeleted": bson.M{"$ne": true}}}},
		{{Key: "$group", Value: bson.M{"_id": "$categoryName", "count": bson.M{"$sum": 1}}}},
		{{Key: "$sort", Value: bson.M{"count": -1}}},
		{{Key: "$limit", Value: 5}},
	}); err == nil {
		defer cur.Close(ctx)
		for cur.Next(ctx) {
			var row nameCount
			if cur.Decode(&row) == nil {
				topCats = append(topCats, row)
			}
		}
	}

	// Users per region (top 10).
	regions := []nameCount{}
	if cur, err := h.Users.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"isDeleted": bson.M{"$ne": true}, "region": bson.M{"$nin": bson.A{"", nil}}}}},
		{{Key: "$group", Value: bson.M{"_id": "$region", "count": bson.M{"$sum": 1}}}},
		{{Key: "$sort", Value: bson.M{"count": -1}}},
		{{Key: "$limit", Value: 10}},
	}); err == nil {
		defer cur.Close(ctx)
		for cur.Next(ctx) {
			var row nameCount
			if cur.Decode(&row) == nil {
				regions = append(regions, row)
			}
		}
	}

	httpx.JSON(w, 200, map[string]any{
		"userGrowth":    dailySeries(ctx, h.Users, days),
		"elonGrowth":    dailySeries(ctx, h.Elons, days),
		"funnel":        funnel,
		"topCategories": topCats,
		"regions":       regions,
	})
}

// usersFilter builds the Mongo query shared by ListUsers and the users CSV
// export. Params: q (name/phone), region, blocked=1|0, verified=1|0.
func usersFilter(q url.Values) bson.M {
	filter := bson.M{"isDeleted": bson.M{"$ne": true}}
	if s := strings.TrimSpace(q.Get("q")); s != "" {
		rx := bson.M{"$regex": escRe(s), "$options": "i"}
		filter["$or"] = bson.A{
			bson.M{"firstName": rx}, bson.M{"lastName": rx}, bson.M{"phone": rx},
		}
	}
	if region := strings.TrimSpace(q.Get("region")); region != "" {
		filter["region"] = region
	}
	switch q.Get("blocked") {
	case "1":
		filter["isBlocked"] = true
	case "0":
		filter["isBlocked"] = bson.M{"$ne": true}
	}
	switch q.Get("verified") {
	case "1":
		filter["isPhoneVerified"] = true
	case "0":
		filter["isPhoneVerified"] = bson.M{"$ne": true}
	}
	return filter
}

// elonsFilter is shared by ListElons and the elons CSV export.
// Params: q (title), status, region, categoryId.
func elonsFilter(q url.Values) bson.M {
	filter := bson.M{"isDeleted": bson.M{"$ne": true}}
	if s := strings.TrimSpace(q.Get("q")); s != "" {
		filter["title"] = bson.M{"$regex": escRe(s), "$options": "i"}
	}
	if status := strings.TrimSpace(q.Get("status")); status != "" {
		filter["status"] = status
	}
	if region := strings.TrimSpace(q.Get("region")); region != "" {
		filter["region"] = region
	}
	if cat := strings.TrimSpace(q.Get("categoryId")); cat != "" {
		if oid, err := primitive.ObjectIDFromHex(cat); err == nil {
			filter["categoryId"] = oid
		}
	}
	return filter
}

// appsFilter is shared by ListApplications and the applications CSV export.
// Params: status, stale=1 (pending older than 3 days).
func appsFilter(q url.Values) bson.M {
	filter := bson.M{}
	if status := strings.TrimSpace(q.Get("status")); status != "" {
		filter["status"] = status
	}
	if q.Get("stale") == "1" {
		filter["status"] = "pending"
		filter["appliedAt"] = bson.M{"$lte": time.Now().AddDate(0, 0, -3)}
	}
	return filter
}

// ListUsers: paginated + searchable + filterable. Query params:
//   page, limit, q (name/phone), region, blocked=1|0, verified=1|0
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)
	filter := usersFilter(r.URL.Query())

	cur, err := h.Users.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	out := []models.User{}
	for cur.Next(ctx) {
		var u models.User
		if err := cur.Decode(&u); err == nil {
			out = append(out, u)
		}
	}
	total, _ := h.Users.CountDocuments(ctx, filter)
	paged(w, out, page, limit, total)
}

// GetUser returns a single user plus their related records (elons, applications
// as worker, reviews about them, and reports filed against them) — the "batafsil
// ko'rinish" the doc asks for, in one round-trip.
func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var u models.User
	if err := h.Users.FindOne(ctx, bson.M{"_id": id}).Decode(&u); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "user not found"))
		return
	}
	elons := decodeElons(ctx, h.Elons, bson.M{"ownerId": id}, 100)
	apps := decodeApps(ctx, h.Apps, bson.M{"workerId": id}, 100)
	reports := decodeReports(ctx, h.Reports, bson.M{"targetType": "user", "targetId": id}, 100)
	httpx.JSON(w, 200, map[string]any{
		"user": u, "elons": elons, "applications": apps, "reports": reports,
	})
}

func (h *Handler) VerifyUser(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	if _, err := h.Users.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{"isPhoneVerified": true}}); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "user_verify", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

type notifyUserReq struct {
	Title string `json:"title" validate:"required"`
	Body  string `json:"body"`
}

// NotifyUser sends a single admin-authored notification to one user.
func (h *Handler) NotifyUser(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req notifyUserReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	h.Notify.Push(r.Context(), id, "system", req.Title, req.Body, nil)
	h.audit(r, "user_notify", id.Hex(), req.Title)
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

type setBlockReq struct {
	IsBlocked bool `json:"isBlocked"`
}

func (h *Handler) BlockUser(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req setBlockReq
	_ = httpx.Decode(r, &req)
	_, err = h.Users.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{"isBlocked": req.IsBlocked}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "user_block", id.Hex(), "isBlocked=set")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

func (h *Handler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	// Best-effort: remove the user's avatar from S3, plus images of all their elons.
	var u models.User
	if err := h.Users.FindOne(r.Context(), bson.M{"_id": id}).Decode(&u); err == nil {
		go upload.DeleteByURL(h.Storage, u.AvatarURL)
	}
	cur, _ := h.Elons.Find(r.Context(), bson.M{"ownerId": id})
	if cur != nil {
		defer cur.Close(r.Context())
		for cur.Next(r.Context()) {
			var e models.Elon
			if err := cur.Decode(&e); err == nil {
				for _, u := range e.Images {
					go upload.DeleteByURL(h.Storage, u)
				}
			}
		}
	}
	_, err = h.Users.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{"isDeleted": true}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "user_delete", id.Hex(), "soft-delete")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// ListElons: paginated + filterable. Query params:
//   page, limit, q (title), status, categoryId, region
func (h *Handler) ListElons(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)
	filter := elonsFilter(r.URL.Query())

	cur, err := h.Elons.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	out := []models.Elon{}
	for cur.Next(ctx) {
		var e models.Elon
		if err := cur.Decode(&e); err == nil {
			out = append(out, e)
		}
	}
	total, _ := h.Elons.CountDocuments(ctx, filter)
	paged(w, out, page, limit, total)
}

// SetElonStatus hides (status=hidden) or restores (status=recruiting) an elon —
// lightweight moderation without deleting. isDeleted is left untouched.
func (h *Handler) SetElonStatus(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	_ = httpx.Decode(r, &req)
	allowed := map[string]bool{"hidden": true, "recruiting": true, "filled": true, "cancelled": true}
	if !allowed[req.Status] {
		httpx.Err(w, httpx.NewError(400, "bad_status", "unsupported status"))
		return
	}
	if _, err := h.Elons.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{"status": req.Status}}); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "elon_status", id.Hex(), req.Status)
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

func (h *Handler) DeleteElon(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var prev models.Elon
	_ = h.Elons.FindOne(r.Context(), bson.M{"_id": id}).Decode(&prev)
	_, err = h.Elons.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{"isDeleted": true, "status": "cancelled"}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	for _, u := range prev.Images {
		go upload.DeleteByURL(h.Storage, u)
	}
	h.audit(r, "elon_delete", id.Hex(), "force")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

func (h *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	cur, err := h.Cats.Find(r.Context(), bson.M{}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Category{}
	for cur.Next(r.Context()) {
		var c models.Category
		if err := cur.Decode(&c); err == nil {
			out = append(out, c)
		}
	}
	httpx.JSON(w, 200, out)
}

type setActiveReq struct {
	IsActive bool `json:"isActive"`
}

func (h *Handler) SetCategoryActive(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req setActiveReq
	_ = httpx.Decode(r, &req)
	_, err = h.Cats.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{"isActive": req.IsActive}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "category_active", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

type categoryReq struct {
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	Icon     string `json:"icon"`
	IsActive *bool  `json:"isActive"`
}

// CreateCategory adds a new admin-defined category. Slug is derived from the
// name when not provided; duplicate slugs are rejected (409).
func (h *Handler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	var req categoryReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httpx.Err(w, httpx.NewError(400, "bad_request", "name required"))
		return
	}
	slug := slugify(req.Slug)
	if slug == "" {
		slug = slugify(req.Name)
	}
	if slug == "" {
		httpx.Err(w, httpx.NewError(400, "bad_slug", "could not derive slug"))
		return
	}
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	adminID, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	cat := models.Category{
		Name: req.Name, Slug: slug, Icon: strings.TrimSpace(req.Icon),
		CreatedBy: adminID, IsSystemDefault: false, IsActive: active,
		UsageCount: 0, CreatedAt: time.Now(),
	}
	res, err := h.Cats.InsertOne(r.Context(), cat)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			httpx.Err(w, httpx.NewError(409, "duplicate", "slug already exists"))
			return
		}
		httpx.Err(w, err)
		return
	}
	cat.ID = res.InsertedID.(primitive.ObjectID)
	h.audit(r, "category_create", cat.ID.Hex(), req.Name)
	httpx.JSON(w, 201, cat)
}

// UpdateCategory edits name/slug/icon/active. Only provided fields change.
func (h *Handler) UpdateCategory(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req categoryReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	set := bson.M{}
	if s := strings.TrimSpace(req.Name); s != "" {
		set["name"] = s
	}
	if s := slugify(req.Slug); s != "" {
		set["slug"] = s
	}
	if req.Icon != "" {
		set["icon"] = strings.TrimSpace(req.Icon)
	}
	if req.IsActive != nil {
		set["isActive"] = *req.IsActive
	}
	if len(set) == 0 {
		httpx.Err(w, httpx.NewError(400, "bad_request", "nothing to update"))
		return
	}
	if _, err := h.Cats.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": set}); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			httpx.Err(w, httpx.NewError(409, "duplicate", "slug already exists"))
			return
		}
		httpx.Err(w, err)
		return
	}
	h.audit(r, "category_update", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// DeleteCategory removes a category. System-default categories are protected
// (they are re-created on every deploy by category.EnsureDefaults), and a
// category still in use by elons is refused to avoid orphaning them.
func (h *Handler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var cat models.Category
	if err := h.Cats.FindOne(r.Context(), bson.M{"_id": id}).Decode(&cat); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "category not found"))
		return
	}
	if cat.IsSystemDefault {
		httpx.Err(w, httpx.NewError(400, "protected", "system category cannot be deleted; deactivate it instead"))
		return
	}
	inUse, _ := h.Elons.CountDocuments(r.Context(), bson.M{"categoryId": id, "isDeleted": bson.M{"$ne": true}})
	if inUse > 0 {
		httpx.Err(w, httpx.NewError(409, "in_use", "category is used by elons; deactivate instead"))
		return
	}
	if _, err := h.Cats.DeleteOne(r.Context(), bson.M{"_id": id}); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "category_delete", id.Hex(), cat.Name)
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// ---- Two-factor (TOTP) — every admin manages their own ----

// currentAdmin loads the admin making the request (from the JWT).
func (h *Handler) currentAdmin(r *http.Request) (*models.Admin, error) {
	id, err := primitive.ObjectIDFromHex(httpx.AdminID(r))
	if err != nil {
		return nil, httpx.NewError(401, "bad_token", "bad admin id")
	}
	var a models.Admin
	if err := h.Admins.FindOne(r.Context(), bson.M{"_id": id}).Decode(&a); err != nil {
		return nil, httpx.NewError(404, "not_found", "admin not found")
	}
	return &a, nil
}

// Me returns the current admin (role, username, 2FA status) so the panel can
// show the right controls without exposing the full admin list to non-superadmins.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	a, err := h.currentAdmin(r)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, a)
}

// Logout writes an audit trail entry for the admin leaving the panel. The token
// itself is stateless (cleared client-side), so this endpoint's only job is the
// audit record.
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	aid, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	var a models.Admin
	_ = h.Admins.FindOne(r.Context(), bson.M{"_id": aid}).Decode(&a)
	h.auditRaw(r.Context(), aid, "logout", a.Username, "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// Setup2FA generates (but does not activate) a new TOTP secret and returns the
// secret + otpauth URI to add to an authenticator app. Enrollment is confirmed
// by Enable2FA. Refuses if 2FA is already active (disable first).
func (h *Handler) Setup2FA(w http.ResponseWriter, r *http.Request) {
	a, err := h.currentAdmin(r)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if a.TOTPEnabled {
		httpx.Err(w, httpx.NewError(400, "already_enabled", "2FA already enabled"))
		return
	}
	secret, err := totp.GenerateSecret()
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if _, err := h.Admins.UpdateOne(r.Context(), bson.M{"_id": a.ID},
		bson.M{"$set": bson.M{"totpSecret": secret, "totpEnabled": false}}); err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]string{
		"secret": secret,
		"uri":    totp.URI(secret, a.Username, "IshchiBormi Admin"),
	})
}

type codeReq struct {
	Code string `json:"code"`
}

// Enable2FA verifies the first code against the pending secret and activates 2FA.
func (h *Handler) Enable2FA(w http.ResponseWriter, r *http.Request) {
	a, err := h.currentAdmin(r)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if a.TOTPSecret == "" {
		httpx.Err(w, httpx.NewError(400, "no_setup", "call setup first"))
		return
	}
	var req codeReq
	_ = httpx.Decode(r, &req)
	if !totp.Validate(a.TOTPSecret, req.Code) {
		httpx.Err(w, httpx.NewError(400, "bad_totp", "invalid code"))
		return
	}
	if _, err := h.Admins.UpdateOne(r.Context(), bson.M{"_id": a.ID},
		bson.M{"$set": bson.M{"totpEnabled": true}}); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "2fa_enable", a.ID.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// Disable2FA turns off 2FA for the current admin after verifying a live code.
func (h *Handler) Disable2FA(w http.ResponseWriter, r *http.Request) {
	a, err := h.currentAdmin(r)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if !a.TOTPEnabled {
		httpx.JSON(w, 200, map[string]bool{"ok": true})
		return
	}
	var req codeReq
	_ = httpx.Decode(r, &req)
	if !totp.Validate(a.TOTPSecret, req.Code) {
		httpx.Err(w, httpx.NewError(400, "bad_totp", "invalid code"))
		return
	}
	if _, err := h.Admins.UpdateOne(r.Context(), bson.M{"_id": a.ID},
		bson.M{"$set": bson.M{"totpEnabled": false}, "$unset": bson.M{"totpSecret": ""}}); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "2fa_disable", a.ID.Hex(), "self")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// ---- Admin (staff) management — superadmin only ----

// ListAdmins returns all staff accounts (password hashes are never serialized).
func (h *Handler) ListAdmins(w http.ResponseWriter, r *http.Request) {
	cur, err := h.Admins.Find(r.Context(), bson.M{}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: 1}}))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Admin{}
	for cur.Next(r.Context()) {
		var a models.Admin
		if err := cur.Decode(&a); err == nil {
			out = append(out, a)
		}
	}
	httpx.JSON(w, 200, out)
}

type createAdminReq struct {
	Username string `json:"username"`
	Name     string `json:"name"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func (h *Handler) CreateAdmin(w http.ResponseWriter, r *http.Request) {
	var req createAdminReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	req.Username = strings.TrimSpace(strings.ToLower(req.Username))
	if req.Username == "" || len(req.Password) < 6 {
		httpx.Err(w, httpx.NewError(400, "bad_request", "username and password (>=6 chars) required"))
		return
	}
	if !validRoles[req.Role] {
		httpx.Err(w, httpx.NewError(400, "bad_role", "role must be superadmin, moderator or support"))
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	a := models.Admin{
		Username: req.Username, Name: strings.TrimSpace(req.Name), PasswordHash: string(hash),
		Role: req.Role, IsActive: true, CreatedAt: time.Now(),
	}
	res, err := h.Admins.InsertOne(r.Context(), a)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			httpx.Err(w, httpx.NewError(409, "duplicate", "username already exists"))
			return
		}
		httpx.Err(w, err)
		return
	}
	a.ID = res.InsertedID.(primitive.ObjectID)
	h.audit(r, "admin_create", a.ID.Hex(), req.Username+"/"+req.Role)
	httpx.JSON(w, 201, a)
}

type updateAdminReq struct {
	Role            string  `json:"role"`
	Name            *string `json:"name"`
	IsActive        *bool   `json:"isActive"`
	Password        string  `json:"password"`
	DisableTwoFactor bool   `json:"disableTwoFactor"` // superadmin resets a locked-out admin
}

// UpdateAdmin changes another admin's role/active state or resets their
// password. Guards against self-lockout: a superadmin cannot demote or
// deactivate their own account.
func (h *Handler) UpdateAdmin(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req updateAdminReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	self := httpx.AdminID(r) == id.Hex()
	set := bson.M{}
	if req.Role != "" {
		if !validRoles[req.Role] {
			httpx.Err(w, httpx.NewError(400, "bad_role", "invalid role"))
			return
		}
		if self && req.Role != "superadmin" {
			httpx.Err(w, httpx.NewError(400, "self_lockout", "cannot demote your own account"))
			return
		}
		set["role"] = req.Role
	}
	if req.Name != nil {
		set["name"] = strings.TrimSpace(*req.Name)
	}
	if req.IsActive != nil {
		if self && !*req.IsActive {
			httpx.Err(w, httpx.NewError(400, "self_lockout", "cannot deactivate your own account"))
			return
		}
		set["isActive"] = *req.IsActive
	}
	if req.Password != "" {
		if len(req.Password) < 6 {
			httpx.Err(w, httpx.NewError(400, "bad_request", "password must be >=6 chars"))
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			httpx.Err(w, err)
			return
		}
		set["passwordHash"] = string(hash)
	}
	update := bson.M{}
	if req.DisableTwoFactor {
		set["totpEnabled"] = false
		update["$unset"] = bson.M{"totpSecret": ""}
	}
	if len(set) == 0 && len(update) == 0 {
		httpx.Err(w, httpx.NewError(400, "bad_request", "nothing to update"))
		return
	}
	if len(set) > 0 {
		update["$set"] = set
	}
	if _, err := h.Admins.UpdateOne(r.Context(), bson.M{"_id": id}, update); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "admin_update", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// DeleteAdmin removes a staff account. An admin cannot delete themselves.
func (h *Handler) DeleteAdmin(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	if httpx.AdminID(r) == id.Hex() {
		httpx.Err(w, httpx.NewError(400, "self_delete", "cannot delete your own account"))
		return
	}
	if _, err := h.Admins.DeleteOne(r.Context(), bson.M{"_id": id}); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "admin_delete", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

type broadcastReq struct {
	Title       string `json:"title" validate:"required"`
	Body        string `json:"body"`
	Region      string `json:"region"`
	ActiveOnly  bool   `json:"activeOnly"`
	ScheduledAt string `json:"scheduledAt"` // RFC3339; empty/past = send now
}

// broadcastFilter builds the recipient query for a broadcast: never deleted;
// optionally only a region and/or only non-blocked ("active") users.
func broadcastFilter(req broadcastReq) bson.M {
	filter := bson.M{"isDeleted": bson.M{"$ne": true}}
	if req.ActiveOnly {
		filter["isBlocked"] = bson.M{"$ne": true}
	}
	if region := strings.TrimSpace(req.Region); region != "" {
		filter["region"] = region
	}
	return filter
}

// Broadcast queues a segmented notification and returns immediately. The actual
// per-user push runs in a background goroutine (with its own context), so a
// large audience no longer blocks the request — the doc's flagged problem. Send
// progress is recorded on the broadcasts collection (status sending -> done).
func (h *Handler) Broadcast(w http.ResponseWriter, r *http.Request) {
	var req broadcastReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		httpx.Err(w, httpx.NewError(400, "bad_request", "title required"))
		return
	}
	// Optional schedule. A time more than a minute in the future defers delivery
	// to the background scheduler; anything else sends immediately.
	var scheduledAt *time.Time
	if s := strings.TrimSpace(req.ScheduledAt); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			httpx.Err(w, httpx.NewError(400, "bad_time", "scheduledAt must be RFC3339"))
			return
		}
		if t.After(time.Now().Add(time.Minute)) {
			scheduledAt = &t
		}
	}

	filter := broadcastFilter(req)
	total, _ := h.Users.CountDocuments(r.Context(), filter)

	adminID, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	status := "sending"
	if scheduledAt != nil {
		status = "scheduled"
	}
	bc := models.Broadcast{
		Title: req.Title, Body: req.Body, Region: strings.TrimSpace(req.Region),
		ActiveOnly: req.ActiveOnly, SentCount: 0, Status: status,
		ScheduledAt: scheduledAt, CreatedBy: adminID, CreatedAt: time.Now(),
	}
	res, err := h.Broadcasts.InsertOne(r.Context(), bc)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	bc.ID = res.InsertedID.(primitive.ObjectID)

	if scheduledAt != nil {
		h.audit(r, "broadcast_schedule", req.Title, scheduledAt.Format(time.RFC3339))
		httpx.JSON(w, 202, map[string]any{"id": bc.ID, "recipients": total, "status": "scheduled", "scheduledAt": scheduledAt})
		return
	}
	h.audit(r, "broadcast", req.Title, req.Body)
	// Fire-and-forget delivery. Uses a fresh background context because the
	// request context is cancelled once we respond below.
	go h.sendBroadcast(bc.ID, filter, req.Title, req.Body)
	httpx.JSON(w, 202, map[string]any{"id": bc.ID, "recipients": total, "status": "sending"})
}

// RunScheduler polls for due scheduled broadcasts once a minute until ctx is
// cancelled. Runs as a single background goroutine started in main.
func (h *Handler) RunScheduler(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	h.dispatchDueBroadcasts(ctx) // catch anything already due at startup
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.dispatchDueBroadcasts(ctx)
		}
	}
}

// dispatchDueBroadcasts atomically claims each due broadcast (scheduled ->
// sending via FindOneAndUpdate, so only one worker/tick can win) and delivers
// it. Recipients are rebuilt from the stored segment.
func (h *Handler) dispatchDueBroadcasts(ctx context.Context) {
	for {
		var bc models.Broadcast
		err := h.Broadcasts.FindOneAndUpdate(ctx,
			bson.M{"status": "scheduled", "scheduledAt": bson.M{"$lte": time.Now()}},
			bson.M{"$set": bson.M{"status": "sending"}},
			options.FindOneAndUpdate().SetReturnDocument(options.After),
		).Decode(&bc)
		if err != nil {
			return // ErrNoDocuments (nothing due) or a transient error — retry next tick
		}
		filter := broadcastFilter(broadcastReq{Region: bc.Region, ActiveOnly: bc.ActiveOnly})
		h.sendBroadcast(bc.ID, filter, bc.Title, bc.Body)
	}
}

// CancelBroadcast deletes a broadcast that hasn't started sending yet.
func (h *Handler) CancelBroadcast(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	res, err := h.Broadcasts.DeleteOne(r.Context(), bson.M{"_id": id, "status": "scheduled"})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if res.DeletedCount == 0 {
		httpx.Err(w, httpx.NewError(409, "not_scheduled", "only scheduled broadcasts can be cancelled"))
		return
	}
	h.audit(r, "broadcast_cancel", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// sendBroadcast delivers one notification per matching user and marks the
// broadcast done. Runs detached from the HTTP request.
func (h *Handler) sendBroadcast(id primitive.ObjectID, filter bson.M, title, body string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	cur, err := h.Users.Find(ctx, filter)
	if err != nil {
		_, _ = h.Broadcasts.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"status": "done"}})
		return
	}
	defer cur.Close(ctx)
	count := 0
	for cur.Next(ctx) {
		var u models.User
		if err := cur.Decode(&u); err == nil {
			h.Notify.Push(ctx, u.ID, "system", title, body, nil)
			count++
		}
	}
	_, _ = h.Broadcasts.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"sentCount": count, "status": "done"}})
}

// ListBroadcasts returns the broadcast history (newest first, paginated).
func (h *Handler) ListBroadcasts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)
	cur, err := h.Broadcasts.Find(ctx, bson.M{},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	out := []models.Broadcast{}
	for cur.Next(ctx) {
		var b models.Broadcast
		if err := cur.Decode(&b); err == nil {
			out = append(out, b)
		}
	}
	total, _ := h.Broadcasts.CountDocuments(ctx, bson.M{})
	paged(w, out, page, limit, total)
}

// reportRow is an enriched report for the moderation queue: the raw report plus
// a human-readable target label, the elon owner (for one-click action) and the
// reporter's name — so the admin can triage without extra round-trips.
type reportRow struct {
	models.Report
	TargetLabel   string `json:"targetLabel"`
	TargetOwnerID string `json:"targetOwnerId,omitempty"`
	ReporterName  string `json:"reporterName,omitempty"`
}

// ListReports: paginated moderation queue. Query params: page, limit, status
// (open|resolved|dismissed). Targets and reporters are batch-loaded to avoid N+1.
func (h *Handler) ListReports(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)

	filter := bson.M{}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		filter["status"] = status
	}
	cur, err := h.Reports.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	reports := []models.Report{}
	for cur.Next(ctx) {
		var rp models.Report
		if err := cur.Decode(&rp); err == nil {
			reports = append(reports, rp)
		}
	}

	// Collect ids to batch-load.
	userIDs := map[primitive.ObjectID]bool{}
	elonIDs := map[primitive.ObjectID]bool{}
	for _, rp := range reports {
		userIDs[rp.ReporterID] = true
		switch rp.TargetType {
		case "user":
			userIDs[rp.TargetID] = true
		case "elon":
			elonIDs[rp.TargetID] = true
		}
	}
	users := loadUserMap(ctx, h.Users, userIDs)
	elons := loadElonMap(ctx, h.Elons, elonIDs)

	rows := make([]reportRow, 0, len(reports))
	for _, rp := range reports {
		row := reportRow{Report: rp}
		if u, ok := users[rp.ReporterID]; ok {
			row.ReporterName = strings.TrimSpace(u.FirstName + " " + u.LastName)
		}
		switch rp.TargetType {
		case "user":
			if u, ok := users[rp.TargetID]; ok {
				row.TargetLabel = strings.TrimSpace(u.FirstName+" "+u.LastName) + " · " + u.Phone
			} else {
				row.TargetLabel = "(o'chirilgan foydalanuvchi)"
			}
		case "elon":
			if e, ok := elons[rp.TargetID]; ok {
				row.TargetLabel = e.Title
				row.TargetOwnerID = e.OwnerID.Hex()
			} else {
				row.TargetLabel = "(o'chirilgan e'lon)"
			}
		default:
			row.TargetLabel = "Xabar"
		}
		rows = append(rows, row)
	}
	total, _ := h.Reports.CountDocuments(ctx, filter)
	paged(w, rows, page, limit, total)
}

func loadUserMap(ctx context.Context, col *mongo.Collection, ids map[primitive.ObjectID]bool) map[primitive.ObjectID]models.User {
	out := map[primitive.ObjectID]models.User{}
	if len(ids) == 0 {
		return out
	}
	list := make([]primitive.ObjectID, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	cur, err := col.Find(ctx, bson.M{"_id": bson.M{"$in": list}})
	if err != nil {
		return out
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var u models.User
		if cur.Decode(&u) == nil {
			out[u.ID] = u
		}
	}
	return out
}

func loadElonMap(ctx context.Context, col *mongo.Collection, ids map[primitive.ObjectID]bool) map[primitive.ObjectID]models.Elon {
	out := map[primitive.ObjectID]models.Elon{}
	if len(ids) == 0 {
		return out
	}
	list := make([]primitive.ObjectID, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	cur, err := col.Find(ctx, bson.M{"_id": bson.M{"$in": list}})
	if err != nil {
		return out
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var e models.Elon
		if cur.Decode(&e) == nil {
			out[e.ID] = e
		}
	}
	return out
}

// ListApplications: paginated application feed for the process dashboard.
// Query params: page, limit, status, stale=1 (pending older than 3 days).
func (h *Handler) ListApplications(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)
	filter := appsFilter(r.URL.Query())

	cur, err := h.Apps.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "appliedAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	out := []models.Application{}
	for cur.Next(ctx) {
		var a models.Application
		if err := cur.Decode(&a); err == nil {
			out = append(out, a)
		}
	}
	total, _ := h.Apps.CountDocuments(ctx, filter)
	paged(w, out, page, limit, total)
}

// ---- CSV export ----

const exportMax = 50000

// csvDownload sets download headers and writes a UTF-8 BOM so Excel opens
// Cyrillic/Latin text correctly, then returns a writer for the rows.
//
// Uses ';' as the field delimiter because Excel in Uzbek/Russian locales
// expects the semicolon list separator — a comma-delimited file would open
// with every column crammed into one cell. Go's encoding/csv quotes any
// field that itself contains ';', so values stay intact.
func csvDownload(w http.ResponseWriter, filename string) *csv.Writer {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	_, _ = w.Write([]byte{0xEF, 0xBB, 0xBF})
	cw := csv.NewWriter(w)
	cw.Comma = ';'
	return cw
}

// ExportUsers streams users (same filters as ListUsers) as CSV.
func (h *Handler) ExportUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cur, err := h.Users.Find(ctx, usersFilter(r.URL.Query()),
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(exportMax))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	cw := csvDownload(w, "users.csv")
	_ = cw.Write([]string{"id", "ism", "familiya", "telefon", "viloyat", "tuman", "reyting", "sharhlar", "bajarilganIsh", "tasdiqlangan", "bloklangan", "yaratilgan"})
	for cur.Next(ctx) {
		var u models.User
		if cur.Decode(&u) != nil {
			continue
		}
		_ = cw.Write([]string{
			u.ID.Hex(), u.FirstName, u.LastName, u.Phone, u.Region, u.District,
			strconv.FormatFloat(u.Rating, 'f', 1, 64), strconv.Itoa(u.ReviewsCount),
			strconv.Itoa(u.CompletedJobsCount), strconv.FormatBool(u.IsPhoneVerified),
			strconv.FormatBool(u.IsBlocked), u.CreatedAt.Format(time.RFC3339),
		})
	}
	cw.Flush()
	h.audit(r, "export_users", "", "")
}

// ExportElons streams elons (same filters as ListElons) as CSV.
func (h *Handler) ExportElons(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cur, err := h.Elons.Find(ctx, elonsFilter(r.URL.Query()),
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(exportMax))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	cw := csvDownload(w, "elons.csv")
	_ = cw.Write([]string{"id", "sarlavha", "turkum", "holat", "viloyat", "ishchiKerak", "narx", "egasi", "ko'rishlar", "yaratilgan"})
	for cur.Next(ctx) {
		var e models.Elon
		if cur.Decode(&e) != nil {
			continue
		}
		_ = cw.Write([]string{
			e.ID.Hex(), e.Title, e.CategoryName, e.Status, e.Region,
			strconv.Itoa(e.WorkersNeeded), strconv.FormatInt(e.PriceAmount, 10),
			e.OwnerName, strconv.Itoa(e.ViewsCount), e.CreatedAt.Format(time.RFC3339),
		})
	}
	cw.Flush()
	h.audit(r, "export_elons", "", "")
}

// ExportApplications streams applications (same filters as ListApplications) as CSV.
func (h *Handler) ExportApplications(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cur, err := h.Apps.Find(ctx, appsFilter(r.URL.Query()),
		options.Find().SetSort(bson.D{{Key: "appliedAt", Value: -1}}).SetLimit(exportMax))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	cw := csvDownload(w, "applications.csv")
	_ = cw.Write([]string{"id", "elon", "ishchi", "telefon", "summa", "kelishuv", "holat", "yuborilgan"})
	for cur.Next(ctx) {
		var a models.Application
		if cur.Decode(&a) != nil {
			continue
		}
		_ = cw.Write([]string{
			a.ID.Hex(), a.ElonTitle, a.WorkerName, a.WorkerPhone,
			strconv.FormatInt(a.Amount, 10), strconv.FormatBool(a.IsNegotiable),
			a.Status, a.AppliedAt.Format(time.RFC3339),
		})
	}
	cw.Flush()
	h.audit(r, "export_applications", "", "")
}

// Audit: paginated admin action log. Query params:
//   page, limit, adminId, action, from (RFC3339), to (RFC3339)
func (h *Handler) Audit(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)
	q := r.URL.Query()

	filter := bson.M{}
	if v := strings.TrimSpace(q.Get("adminId")); v != "" {
		if oid, err := primitive.ObjectIDFromHex(v); err == nil {
			filter["adminId"] = oid
		}
	}
	if v := strings.TrimSpace(q.Get("action")); v != "" {
		filter["action"] = v
	}
	rng := bson.M{}
	if v := q.Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			rng["$gte"] = t
		}
	}
	if v := q.Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			rng["$lte"] = t
		}
	}
	if len(rng) > 0 {
		filter["createdAt"] = rng
	}

	cur, err := h.AuditCol.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	type auditRow struct {
		models.AdminAudit
		AdminName string `json:"adminName"`
	}
	rows := []auditRow{}
	idSet := map[primitive.ObjectID]struct{}{}
	for cur.Next(ctx) {
		var a models.AdminAudit
		if err := cur.Decode(&a); err == nil {
			rows = append(rows, auditRow{AdminAudit: a})
			if !a.AdminID.IsZero() {
				idSet[a.AdminID] = struct{}{}
			}
		}
	}
	// Resolve admin ids -> display name (name yoki username) in one query.
	names := map[primitive.ObjectID]string{}
	if len(idSet) > 0 {
		ids := make([]primitive.ObjectID, 0, len(idSet))
		for id := range idSet {
			ids = append(ids, id)
		}
		ac, err := h.Admins.Find(ctx, bson.M{"_id": bson.M{"$in": ids}})
		if err == nil {
			defer ac.Close(ctx)
			for ac.Next(ctx) {
				var a models.Admin
				if ac.Decode(&a) == nil {
					disp := a.Name
					if disp == "" {
						disp = a.Username
					}
					names[a.ID] = disp
				}
			}
		}
	}
	for i := range rows {
		rows[i].AdminName = names[rows[i].AdminID]
	}
	total, _ := h.AuditCol.CountDocuments(ctx, filter)
	paged(w, rows, page, limit, total)
}
