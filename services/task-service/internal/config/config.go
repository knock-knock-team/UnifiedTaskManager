package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	HTTPAddr              string
	DatabaseURL           string
	UseInMemory           bool
	AutoMigrate           bool
	JWTSecret             string
	CORSAllowOrigin       string
	RabbitEnabled         bool
	RabbitURL             string
	RabbitExchange        string
	RabbitUserExistsQueue  string
	RabbitAgentCommandsQueue string
	RabbitRPCTimeout       time.Duration
	UserServiceURL         string
	BoardRedisURL          string
}

func FromEnv() Config {
	return Config{
		HTTPAddr:              getenv("TASK_SERVICE_HTTP_ADDR", ":8083"),
		DatabaseURL:           getenv("TASK_DATABASE_URL", getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/unified_task_manager?sslmode=disable")),
		UseInMemory:           getenvBool("TASK_USE_IN_MEMORY", getenvBool("USE_IN_MEMORY", false)),
		AutoMigrate:           getenvBool("TASK_AUTO_MIGRATE", getenvBool("AUTO_MIGRATE", true)),
		JWTSecret:             getenv("JWT_SECRET", ""),
		CORSAllowOrigin:       getenv("CORS_ALLOW_ORIGIN", "*"),
		RabbitEnabled:           getenvBool("TASK_RABBITMQ_ENABLED", getenvBool("RABBITMQ_ENABLED", false)),
		RabbitURL:               getenv("TASK_RABBITMQ_URL", getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")),
		RabbitExchange:          getenv("TASK_RABBITMQ_EXCHANGE", "task.events"),
		RabbitUserExistsQueue:   getenv("TASK_RABBITMQ_USER_EXISTS_QUEUE", getenv("RABBITMQ_USER_EXISTS_QUEUE", "user-service.user-exists")),
		RabbitAgentCommandsQueue: getenv("TASK_SERVICE_AGENT_COMMANDS_QUEUE", "task-service.agent-commands"),
		RabbitRPCTimeout:        time.Duration(getenvInt("TASK_RABBITMQ_RPC_TIMEOUT_SECONDS", getenvInt("RABBITMQ_RPC_TIMEOUT_SECONDS", 3))) * time.Second,
		UserServiceURL:          getenv("TASK_USER_SERVICE_URL", getenv("USER_SERVICE_URL", "http://localhost:8082")),
		BoardRedisURL:           getenv("TASK_BOARD_REDIS_URL", getenv("REDIS_URL", "")),
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getenvBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return parsed
}

func getenvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return parsed
}
