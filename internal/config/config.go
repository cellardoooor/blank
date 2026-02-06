package config

import (
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	HTTPAddr        string
	JWTSecret       []byte
	JWTDuration     time.Duration
	DB              DatabaseConfig
	DefaultUser     string
	DefaultPassword string
	CORSAllowed     []string
}

type DatabaseConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
	SSLMode  string
}

func Load() *Config {
	godotenv.Load()

	corsAllowed := getEnv("CORS_ALLOWED_ORIGINS", "")
	allowedOrigins := []string{"*"}
	if corsAllowed != "" {
		allowedOrigins = splitEnv(corsAllowed)
	}

	return &Config{
		HTTPAddr:        getEnv("HTTP_ADDR", ":8080"),
		JWTSecret:       []byte(getEnv("JWT_SECRET", "default-secret-change-in-production")),
		JWTDuration:     parseDuration(getEnv("JWT_DURATION", "24h")),
		DefaultUser:     getEnv("DEFAULT_USER", ""),
		DefaultPassword: getEnv("DEFAULT_PASSWORD", ""),
		CORSAllowed:     allowedOrigins,
		DB: DatabaseConfig{
			Host:     getEnv("DB_HOST", "localhost"),
			Port:     getEnv("DB_PORT", "5432"),
			User:     getEnv("DB_USER", ""),
			Password: getEnv("DB_PASSWORD", ""),
			DBName:   getEnv("DB_NAME", ""),
			SSLMode:  getEnv("DB_SSLMODE", "disable"),
		},
	}
}

func (c *DatabaseConfig) DSN() string {
	return "host=" + c.Host + " port=" + c.Port + " user=" + c.User + " password=" + c.Password + " dbname=" + c.DBName + " sslmode=" + c.SSLMode
}

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func splitEnv(s string) []string {
	if s == "" {
		return []string{}
	}
	result := []string{}
	for _, part := range strings.Split(s, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func parseDuration(s string) time.Duration {
	d, _ := time.ParseDuration(s)
	if d == 0 {
		d = 24 * time.Hour
	}
	return d
}
