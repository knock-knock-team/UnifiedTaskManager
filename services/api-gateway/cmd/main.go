package main

import (
	"log"

	"vg-task-system/services/api-gateway/internal/config"
	"vg-task-system/services/api-gateway/internal/handler"
	"vg-task-system/services/api-gateway/internal/service"
)

func main() {
	cfg := config.FromEnv()
	if cfg.JWTSecret == "" {
		log.Fatal("JWT_SECRET is required")
	}

	tokens := service.NewTokenManager(cfg.JWTSecret)
	h, err := handler.NewHTTPHandler(cfg.UserServiceURL, cfg.TaskServiceURL, cfg.ChatServiceURL, tokens)
	if err != nil {
		log.Fatalf("gateway init failed: %v", err)
	}
	h.SetCORSAllowOrigin(cfg.CORSAllowOrigin)

	log.Printf("api-gateway starting on %s", cfg.HTTPAddr)
	if err := h.Run(cfg.HTTPAddr); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
