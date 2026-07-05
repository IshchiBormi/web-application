package config

import (
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppEnv string // "dev" | "production"

	MongoURI string
	MongoDB  string

	HTTPAddr string

	// TrustProxyHeaders: honor X-Forwarded-For for client IP / rate limiting.
	// Only enable when running behind a trusted reverse proxy.
	TrustProxyHeaders bool

	JWTAccessSecret  string
	JWTRefreshSecret string
	JWTAccessTTL     time.Duration
	JWTRefreshTTL    time.Duration

	CORSOrigins []string
	AvatarDir   string

	AdminSeedUser string
	AdminSeedPass string

	BotSharedSecret string
	OTPLength       int
	OTPTTL          time.Duration
	OTPDevReturn    bool

	TelegramBotToken    string
	TelegramBotUsername string

	// AWS S3
	AWSRegion          string
	AWSAccessKeyID     string
	AWSSecretAccessKey string
	AWSS3Bucket        string
	AWSS3PublicBaseURL string

	// Local-disk upload fallback (used when AWS_S3_BUCKET is empty).
	UploadDir        string
	UploadPublicBase string
}

func envStr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return def
}
func envBool(k string, def bool) bool {
	v := strings.ToLower(os.Getenv(k))
	switch v {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	}
	return def
}

func Load() Config {
	cfg := Config{
		AppEnv:              strings.ToLower(envStr("APP_ENV", "dev")),
		MongoURI:            envStr("MONGO_URI", "mongodb://localhost:27017"),
		MongoDB:             envStr("MONGO_DB", "ishchibormi"),
		HTTPAddr:            envStr("HTTP_ADDR", ":8080"),
		TrustProxyHeaders:   envBool("TRUST_PROXY_HEADERS", false),
		JWTAccessSecret:     envStr("JWT_ACCESS_SECRET", "dev-access-secret"),
		JWTRefreshSecret:    envStr("JWT_REFRESH_SECRET", "dev-refresh-secret"),
		// 15 kun (21600 daqiqa). Frontend refresh oqimini ishlatmagani uchun
		// foydalanuvchi seansi to'g'ridan-to'g'ri shu access token muddati bilan
		// belgilanadi — qisqa qo'yilsa, logout qilmasa ham tez chiqib ketadi.
		JWTAccessTTL:        time.Duration(envInt("JWT_ACCESS_TTL_MIN", 21600)) * time.Minute,
		JWTRefreshTTL:       time.Duration(envInt("JWT_REFRESH_TTL_HRS", 720)) * time.Hour,
		CORSOrigins:         strings.Split(envStr("CORS_ORIGINS", "http://localhost:3000"), ","),
		AvatarDir:           envStr("AVATAR_DIR", "./data/avatars"),
		AdminSeedUser:       envStr("ADMIN_SEED_USER", "admin"),
		AdminSeedPass:       envStr("ADMIN_SEED_PASS", "Admin123!"),
		BotSharedSecret:     envStr("BOT_SHARED_SECRET", "dev-shared"),
		OTPLength:           envInt("OTP_LENGTH", 6),
		OTPTTL:              time.Duration(envInt("OTP_TTL_SECONDS", 180)) * time.Second,
		// Defaults to false: returning OTP codes over the API is a dev-only
		// convenience and a credential leak in production.
		OTPDevReturn:        envBool("OTP_DEV_RETURN", false),
		TelegramBotToken:    envStr("TELEGRAM_BOT_TOKEN", ""),
		TelegramBotUsername: envStr("TELEGRAM_BOT_USERNAME", ""),

		AWSRegion:          envStr("AWS_REGION", "eu-central-1"),
		AWSAccessKeyID:     envStr("AWS_ACCESS_KEY_ID", ""),
		AWSSecretAccessKey: envStr("AWS_SECRET_ACCESS_KEY", ""),
		AWSS3Bucket:        envStr("AWS_S3_BUCKET", ""),
		AWSS3PublicBaseURL: envStr("AWS_S3_PUBLIC_BASE_URL", ""),

		UploadDir:        envStr("UPLOAD_DIR", "./data/uploads"),
		UploadPublicBase: envStr("UPLOAD_PUBLIC_BASE", "http://localhost:8080/uploads"),
	}
	cfg.mustValidate()
	return cfg
}

func (c Config) IsProd() bool { return c.AppEnv == "production" || c.AppEnv == "prod" }

// mustValidate fails fast in production when insecure defaults are left in
// place. This prevents accidentally shipping forgeable JWTs, a default admin
// password, or OTP leakage.
func (c Config) mustValidate() {
	if !c.IsProd() {
		return
	}
	var problems []string
	weak := map[string]bool{
		"": true, "dev-access-secret": true, "dev-refresh-secret": true,
		"change-me-access": true, "change-me-refresh": true,
		"dev-shared": true, "change-me-shared": true,
	}
	if weak[c.JWTAccessSecret] || len(c.JWTAccessSecret) < 32 {
		problems = append(problems, "JWT_ACCESS_SECRET must be set to a strong (>=32 char) random value")
	}
	if weak[c.JWTRefreshSecret] || len(c.JWTRefreshSecret) < 32 {
		problems = append(problems, "JWT_REFRESH_SECRET must be set to a strong (>=32 char) random value")
	}
	if c.JWTAccessSecret == c.JWTRefreshSecret {
		problems = append(problems, "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ")
	}
	if weak[c.BotSharedSecret] {
		problems = append(problems, "BOT_SHARED_SECRET must be set to a strong random value")
	}
	if c.AdminSeedPass == "Admin123!" || c.AdminSeedPass == "" {
		problems = append(problems, "ADMIN_SEED_PASS must be changed from the default")
	}
	if c.OTPDevReturn {
		problems = append(problems, "OTP_DEV_RETURN must be false in production")
	}
	if len(problems) > 0 {
		log.Fatalf("insecure configuration for production:\n  - %s", strings.Join(problems, "\n  - "))
	}
}
