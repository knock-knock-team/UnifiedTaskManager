package main

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"unified-task-manager/services/user-service/internal/config"
	"unified-task-manager/services/user-service/internal/event"
	"unified-task-manager/services/user-service/internal/handler"
	"unified-task-manager/services/user-service/internal/repository"
	"unified-task-manager/services/user-service/internal/service"
)

func main() {
	cfg := config.FromEnv()
	if cfg.JWTSecret == "" {
		log.Fatal("JWT_SECRET is required")
	}

	ctx := context.Background()

	var repo repository.UserStore
	if cfg.UseInMemory {
		repo = repository.NewInMemoryUserRepository()
		log.Printf("using in-memory repository")
	} else {
		postgresRepo, err := repository.NewPostgresUserRepository(ctx, cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("postgres init failed: %v", err)
		}
		if cfg.AutoMigrate {
			if err := postgresRepo.EnsureSchema(ctx); err != nil {
				log.Fatalf("migration failed: %v", err)
			}
		}
		repo = postgresRepo
		log.Printf("using postgres repository")
	}

	publisher := event.NewNoopPublisher()
	outboxMetrics := event.NewOutboxMetrics()
	var outboxWorker *event.OutboxWorker
	var outboxCleaner *event.OutboxCleaner
	var userExistsConsumer *event.UserExistsConsumer
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

		userExistsConsumer, err = event.NewUserExistsConsumer(cfg.RabbitURL, cfg.RabbitUserExistsQueue)
		if err != nil {
			log.Fatalf("rabbitmq user-exists consumer init failed: %v", err)
		}
		defer func() {
			if err := userExistsConsumer.Close(); err != nil {
				log.Printf("rabbitmq user-exists consumer close warning: %v", err)
			}
		}()
		go func() {
			err := userExistsConsumer.Run(ctx, func(_ context.Context, userID string) (bool, error) {
				userID = strings.TrimSpace(userID)
				if userID == "" {
					return false, nil
				}
				_, err := repo.FindByID(userID)
				if err != nil {
					if errors.Is(err, repository.ErrNotFound) {
						return false, nil
					}
					return false, err
				}
				return true, nil
			})
			if err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("rabbitmq user-exists consumer stopped: %v", err)
			}
		}()
		log.Printf("rabbitmq user-exists consumer enabled queue=%s", cfg.RabbitUserExistsQueue)

		if outboxRepo, ok := repo.(repository.OutboxRepository); ok {
			outboxWorker = event.NewOutboxWorker(outboxRepo, publisher, outboxMetrics, 2*time.Second, 100, cfg.OutboxMaxAttempts)
			go outboxWorker.Run(ctx)
			log.Printf("outbox worker started")
		} else {
			log.Printf("outbox worker not started: repository has no outbox support")
		}
	}

	if cfg.OutboxCleanerEnabled {
		if maintenanceRepo, ok := repo.(repository.OutboxMaintenanceRepository); ok {
			outboxCleaner = event.NewOutboxCleaner(
				maintenanceRepo,
				outboxMetrics,
				time.Duration(cfg.OutboxCleanupIntervalSeconds)*time.Second,
				time.Duration(cfg.OutboxRetentionDays)*24*time.Hour,
				cfg.OutboxCleanupBatchSize,
				cfg.OutboxArchiveEnabled,
			)
			go outboxCleaner.Run(ctx)
			log.Printf("outbox cleaner started retention_days=%d archive=%t", cfg.OutboxRetentionDays, cfg.OutboxArchiveEnabled)
		} else {
			log.Printf("outbox cleaner not started: repository has no outbox maintenance support")
		}
	}

	tokenManager := service.NewTokenManager(cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)
	emailSender := service.SMTPEmailSender{
		Host:     cfg.SMTPHost,
		Port:     cfg.SMTPPort,
		Username: cfg.SMTPUsername,
		Password: cfg.SMTPPassword,
		From:     cfg.SMTPFrom,
		FromName: cfg.SMTPFromName,
	}
	userService := service.NewUserServiceWithEmailSender(repo, tokenManager, emailSender)

	if cfg.BootstrapAdminEmail != "" && cfg.BootstrapAdminPassword != "" {
		admin, err := userService.BootstrapAdmin(cfg.BootstrapAdminEmail, cfg.BootstrapAdminPassword, cfg.BootstrapAdminName)
		if err != nil {
			log.Fatalf("bootstrap admin failed: %v", err)
		}
		log.Printf("bootstrap admin ready: id=%s email=%s", admin.ID, admin.Email)
	}

	h := handler.NewHTTPHandler(userService, repo.Ping)
	h.SetCORSAllowOrigin(cfg.CORSAllowOrigin)
	h.SetAdminOps(cfg.AdminOpsToken, handler.AdminOps{
		TriggerOutboxFlush: func(ctx context.Context) (int, error) {
			if outboxWorker == nil {
				return 0, nil
			}
			return outboxWorker.RunOnce(ctx)
		},
		TriggerOutboxClean: func(ctx context.Context) (int, int, error) {
			if outboxCleaner == nil {
				return 0, 0, nil
			}
			return outboxCleaner.RunOnce(ctx)
		},
	})

	log.Printf("user-service starting on %s", cfg.HTTPAddr)
	if err := h.Run(cfg.HTTPAddr); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
