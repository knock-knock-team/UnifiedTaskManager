package config

import (
	"os"
	"strconv"
)

type Config struct {
	HTTPAddr        string
	UserServiceURL  string
	TaskServiceURL  string
	ChatServiceURL  string
	JWTSecret       string
	CORSAllowOrigin string
}

func FromEnv() Config {
	return Config{
		HTTPAddr:        getenv("GATEWAY_HTTP_ADDR", ":8081"),
		UserServiceURL:  getenv("GATEWAY_USER_SERVICE_URL", getenv("USER_SERVICE_URL", "http://user-service:8082")),
		TaskServiceURL:  getenv("GATEWAY_TASK_SERVICE_URL", getenv("TASK_SERVICE_URL", "http://task-service:8083")),
		ChatServiceURL:  getenv("GATEWAY_CHAT_SERVICE_URL", getenv("CHAT_SERVICE_URL", "http://chat-service:8084")),
		JWTSecret:       getenv("JWT_SECRET", ""),
		CORSAllowOrigin: getenv("CORS_ALLOW_ORIGIN", "*"),
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
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
