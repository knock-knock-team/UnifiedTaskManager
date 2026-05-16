package main

import (
	"context"
	"log"
	"time"

	"UnifiedTaskManager/services/task-service/internal/config"
	"UnifiedTaskManager/services/task-service/internal/event"
	"UnifiedTaskManager/services/task-service/internal/handler"
	"UnifiedTaskManager/services/task-service/internal/repository"
	"UnifiedTaskManager/services/task-service/internal/service"
)

func main() {
	cfg := config.FromEnv()
	if cfg.JWTSecret == "" {
		log.Fatal("JWT_SECRET is required")
	}

	ctx := context.Background()

	var repo repository.TaskStore
	if cfg.UseInMemory {
		repo = repository.NewInMemoryTaskRepository()
		log.Printf("using in-memory task repository")
	} else {
		pgRepo, err := repository.NewPostgresTaskRepository(ctx, cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("postgres init failed: %v", err)
		}
		if cfg.AutoMigrate {
			if err := pgRepo.EnsureSchema(ctx); err != nil {
				log.Fatalf("task schema migration failed: %v", err)
			}
		}
		repo = pgRepo
		log.Printf("using postgres task repository")
	}

	publisher := event.NewNoopPublisher()
	userDirectory := service.NewNoopUserDirectory()
	if cfg.RabbitEnabled {
		rabbitPublisher, err := event.NewRabbitMQPublisher(cfg.RabbitURL, cfg.RabbitExchange)
		if err != nil {
			log.Fatalf("rabbitmq init failed: %v", err)
		}
		defer func() {
			if err := rabbitPublisher.Close(); err != nil {
				log.Printf("rabbitmq close warning: %v", err)
			}
		}()
		publisher = rabbitPublisher
		log.Printf("rabbitmq publisher enabled exchange=%s", cfg.RabbitExchange)

		rabbitUserDirectory, err := service.NewRabbitUserDirectory(cfg.RabbitURL, cfg.RabbitUserExistsQueue, cfg.RabbitRPCTimeout)
		if err != nil {
			log.Fatalf("rabbitmq user directory rpc init failed: %v", err)
		}
		defer func() {
			if err := rabbitUserDirectory.Close(); err != nil {
				log.Printf("rabbitmq user directory rpc close warning: %v", err)
			}
		}()
		userDirectory = rabbitUserDirectory
		log.Printf("rabbitmq user directory rpc enabled queue=%s timeout=%s", cfg.RabbitUserExistsQueue, cfg.RabbitRPCTimeout)
	}

	tokenManager := service.NewTokenManager(cfg.JWTSecret)
	permissionClient := service.NewPermissionClient(cfg.UserServiceURL, 3*time.Second)
	svc := service.NewTaskService(repo, publisher, userDirectory)
	h := handler.NewHTTPHandler(svc, repo.Ping, tokenManager, permissionClient)
	h.SetCORSAllowOrigin(cfg.CORSAllowOrigin)

	log.Printf("task-service starting on %s", cfg.HTTPAddr)
	if err := h.Run(cfg.HTTPAddr); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
