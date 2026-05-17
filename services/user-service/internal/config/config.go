package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var loadEnvOnce sync.Once

type Config struct {
	HTTPAddr                     string
	DatabaseURL                  string
	UseInMemory                  bool
	AutoMigrate                  bool
	RabbitEnabled                bool
	RabbitURL                    string
	RabbitExchange               string
	RabbitUserExistsQueue        string
	OutboxCleanerEnabled         bool
	OutboxArchiveEnabled         bool
	OutboxRetentionDays          int
	OutboxCleanupIntervalSeconds int
	OutboxCleanupBatchSize       int
	OutboxMaxAttempts            int
	AdminOpsToken                string
	CORSAllowOrigin              string
	JWTSecret                    string
	AccessTokenTTL               time.Duration
	RefreshTokenTTL              time.Duration

	BootstrapAdminEmail    string
	BootstrapAdminPassword string
	BootstrapAdminName     string

	SMTPHost     string
	SMTPPort     string
	SMTPUsername string
	SMTPPassword string
	SMTPFrom     string
	SMTPFromName string
}

func FromEnv() Config {
	loadEnvOnce.Do(loadDotEnv)

	return Config{
		HTTPAddr:                     getenv("HTTP_ADDR", ":8082"),
		DatabaseURL:                  getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/unified_task_manager?sslmode=disable"),
		UseInMemory:                  getenvBool("USE_IN_MEMORY", false),
		AutoMigrate:                  getenvBool("AUTO_MIGRATE", true),
		RabbitEnabled:                getenvBool("RABBITMQ_ENABLED", false),
		RabbitURL:                    getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/"),
		RabbitExchange:               getenv("RABBITMQ_EXCHANGE", "user.events"),
		RabbitUserExistsQueue:        getenv("RABBITMQ_USER_EXISTS_QUEUE", "user-service.user-exists"),
		OutboxCleanerEnabled:         getenvBool("OUTBOX_CLEANER_ENABLED", true),
		OutboxArchiveEnabled:         getenvBool("OUTBOX_ARCHIVE_ENABLED", true),
		OutboxRetentionDays:          getenvInt("OUTBOX_RETENTION_DAYS", 7),
		OutboxCleanupIntervalSeconds: getenvInt("OUTBOX_CLEANUP_INTERVAL_SECONDS", 60),
		OutboxCleanupBatchSize:       getenvInt("OUTBOX_CLEANUP_BATCH_SIZE", 500),
		OutboxMaxAttempts:            getenvInt("OUTBOX_MAX_ATTEMPTS", 10),
		AdminOpsToken:                getenv("ADMIN_OPS_TOKEN", ""),
		CORSAllowOrigin:              getenv("CORS_ALLOW_ORIGIN", "*"),
		JWTSecret:                    getenv("JWT_SECRET", ""),
		AccessTokenTTL:               time.Duration(getenvInt("ACCESS_TOKEN_MINUTES", 60)) * time.Minute,
		RefreshTokenTTL:              time.Duration(getenvInt("REFRESH_TOKEN_HOURS", 504)) * time.Hour,

		BootstrapAdminEmail:    getenv("BOOTSTRAP_ADMIN_EMAIL", ""),
		BootstrapAdminPassword: getenv("BOOTSTRAP_ADMIN_PASSWORD", ""),
		BootstrapAdminName:     getenv("BOOTSTRAP_ADMIN_NAME", "System Admin"),

		SMTPHost:     getenv("SMTP_HOST", ""),
		SMTPPort:     getenv("SMTP_PORT", "587"),
		SMTPUsername: getenv("SMTP_USERNAME", ""),
		SMTPPassword: getenv("SMTP_PASSWORD", ""),
		SMTPFrom:     getenv("SMTP_FROM", getenv("SMTP_USERNAME", "")),
		SMTPFromName: getenv("SMTP_FROM_NAME", "UnifiedTaskManager"),
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func getenvBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func loadDotEnv() {
	paths := []string{
		".env",
		filepath.Join("..", ".env"),
		filepath.Join("..", "..", ".env"),
	}

	for _, path := range paths {
		loadDotEnvFile(path)
	}
}

func loadDotEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		val = strings.Trim(val, "\"")
		val = os.Expand(val, func(name string) string {
			if v, ok := os.LookupEnv(name); ok {
				return v
			}
			return ""
		})
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, val)
		}
	}
}
