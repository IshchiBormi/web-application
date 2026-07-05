package httpx

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey string

const (
	CtxUserID    ctxKey = "userId"
	CtxAdminID   ctxKey = "adminId"
	CtxAdminRole ctxKey = "adminRole"
)

// TrustProxyHeaders controls whether the X-Forwarded-For header is honored when
// determining the client IP (used for rate limiting). It MUST stay false unless
// the service runs behind a trusted reverse proxy that overwrites the header;
// otherwise a client can spoof XFF to get an unlimited number of rate-limit
// buckets and defeat brute-force protection. Set from config at startup.
var TrustProxyHeaders = false

// allowedJWTMethods pins token verification to HMAC-SHA256, preventing
// algorithm-confusion / "alg:none" downgrade attacks.
var allowedJWTMethods = []string{"HS256"}

type Claims struct {
	UserID string `json:"uid"`
	jwt.RegisteredClaims
}

type AdminClaims struct {
	AdminID string `json:"aid"`
	Role    string `json:"role"`
	jwt.RegisteredClaims
}

func UserAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tok := tokenFromReq(r)
			if tok == "" {
				Err(w, NewError(http.StatusUnauthorized, "no_token", "missing token"))
				return
			}
			c := &Claims{}
			_, err := jwt.ParseWithClaims(tok, c,
				func(*jwt.Token) (any, error) { return []byte(secret), nil },
				jwt.WithValidMethods(allowedJWTMethods))
			if err != nil || c.UserID == "" {
				Err(w, NewError(http.StatusUnauthorized, "bad_token", "invalid token"))
				return
			}
			ctx := context.WithValue(r.Context(), CtxUserID, c.UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func AdminAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tok := tokenFromReq(r)
			if tok == "" {
				Err(w, NewError(http.StatusUnauthorized, "no_token", "missing token"))
				return
			}
			c := &AdminClaims{}
			_, err := jwt.ParseWithClaims(tok, c,
				func(*jwt.Token) (any, error) { return []byte(secret), nil },
				jwt.WithValidMethods(allowedJWTMethods))
			if err != nil || c.AdminID == "" {
				Err(w, NewError(http.StatusUnauthorized, "bad_token", "invalid token"))
				return
			}
			ctx := context.WithValue(r.Context(), CtxAdminID, c.AdminID)
			ctx = context.WithValue(ctx, CtxAdminRole, c.Role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func tokenFromReq(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	if t := r.URL.Query().Get("token"); t != "" {
		return t
	}
	return ""
}

func UserID(r *http.Request) string {
	if v, ok := r.Context().Value(CtxUserID).(string); ok {
		return v
	}
	return ""
}
func AdminID(r *http.Request) string {
	if v, ok := r.Context().Value(CtxAdminID).(string); ok {
		return v
	}
	return ""
}

// AdminRole returns the role stored in the admin JWT (superadmin|moderator|
// support). Empty when the request wasn't authenticated as an admin.
func AdminRole(r *http.Request) string {
	if v, ok := r.Context().Value(CtxAdminRole).(string); ok {
		return v
	}
	return ""
}

// RequireRole authorizes an admin request by role. "superadmin" is ALWAYS
// allowed (full access), regardless of the passed list. Any other role passes
// only if it is in `allowed`. Otherwise a 403 is returned.
//
// MUST be mounted AFTER AdminAuth so the role is present in the context. This is
// the RBAC gap the admin panel had: previously every authenticated admin —
// including a plain "moderator" — could hit every endpoint (delete users, send
// broadcasts, manage other admins). Now each route declares who may call it.
func RequireRole(allowed ...string) func(http.Handler) http.Handler {
	set := map[string]bool{"superadmin": true}
	for _, a := range allowed {
		set[a] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !set[AdminRole(r)] {
				Err(w, NewError(http.StatusForbidden, "forbidden", "insufficient role"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				JSON(w, http.StatusInternalServerError, errBody{Error: APIError{Code: "panic", Message: "internal server error"}})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// SecurityHeaders sets conservative response headers. The API serves JSON only,
// so a strict CSP plus nosniff/frame-deny costs nothing and blocks a range of
// content-type confusion and clickjacking issues.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

// RateLimit: simple per-IP token bucket (in-memory).
type bucket struct {
	tokens   float64
	last     time.Time
	capacity float64
	refill   float64 // tokens / sec
}

type Limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	cap     float64
	refill  float64
}

func NewLimiter(cap float64, refillPerSec float64) *Limiter {
	return &Limiter{buckets: map[string]*bucket{}, cap: cap, refill: refillPerSec}
}

func (l *Limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.buckets[key]
	now := time.Now()
	if !ok {
		l.buckets[key] = &bucket{tokens: l.cap - 1, last: now, capacity: l.cap, refill: l.refill}
		return true
	}
	elapsed := now.Sub(b.last).Seconds()
	b.tokens += elapsed * b.refill
	if b.tokens > b.capacity {
		b.tokens = b.capacity
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (l *Limiter) Middleware(prefix string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := prefix + ":" + clientIP(r)
			if !l.allow(key) {
				Err(w, NewError(http.StatusTooManyRequests, "rate_limited", "too many requests"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func clientIP(r *http.Request) string {
	// Only trust the forwarded header when explicitly configured to run behind a
	// trusted proxy. Otherwise an attacker can rotate XFF to mint a fresh
	// rate-limit bucket per request and bypass brute-force protection.
	if TrustProxyHeaders {
		if v := r.Header.Get("X-Forwarded-For"); v != "" {
			if i := strings.IndexByte(v, ','); i > 0 {
				return strings.TrimSpace(v[:i])
			}
			return strings.TrimSpace(v)
		}
	}
	host := r.RemoteAddr
	if i := strings.LastIndexByte(host, ':'); i > 0 {
		return host[:i]
	}
	return host
}
