package event

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"UnifiedTaskManager/services/user-service/internal/model"
	"UnifiedTaskManager/services/user-service/internal/repository"
)

type OutboxWorker struct {
	repo        repository.OutboxRepository
	publisher   UserEventPublisher
	metrics     *OutboxMetrics
	interval    time.Duration
	batchSize   int
	maxAttempts int
}

func NewOutboxWorker(repo repository.OutboxRepository, publisher UserEventPublisher, metrics *OutboxMetrics, interval time.Duration, batchSize int, maxAttempts int) *OutboxWorker {
	if interval <= 0 {
		interval = 2 * time.Second
	}
	if batchSize <= 0 {
		batchSize = 100
	}
	if maxAttempts <= 0 {
		maxAttempts = 10
	}
	return &OutboxWorker{
		repo:        repo,
		publisher:   publisher,
		metrics:     metrics,
		interval:    interval,
		batchSize:   batchSize,
		maxAttempts: maxAttempts,
	}
}

func (w *OutboxWorker) Run(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		if _, err := w.RunOnce(ctx); err != nil {
			log.Printf("outbox flush error: %v", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *OutboxWorker) RunOnce(ctx context.Context) (int, error) {
	w.refreshMetrics(ctx)

	batch, err := w.repo.FetchPendingOutbox(ctx, w.batchSize)
	if err != nil {
		return 0, err
	}
	published := 0
	for _, msg := range batch {
		if err := w.publishMessage(ctx, msg); err != nil {
			if msg.AttemptCount+1 >= w.maxAttempts {
				_ = w.repo.MarkOutboxDead(ctx, msg.ID, err.Error())
				if w.metrics != nil {
					w.metrics.IncDeadLetter()
				}
				continue
			}
			retryAfter := calculateBackoff(msg.AttemptCount)
			_ = w.repo.MarkOutboxFailed(ctx, msg.ID, err.Error(), retryAfter)
			if w.metrics != nil {
				w.metrics.IncRetry()
			}
			continue
		}
		if err := w.repo.MarkOutboxPublished(ctx, msg.ID); err != nil {
			log.Printf("outbox mark published failed id=%s err=%v", msg.ID, err)
		} else if w.metrics != nil {
			w.metrics.IncPublished()
		}
		published++
	}
	return published, nil
}

func (w *OutboxWorker) refreshMetrics(ctx context.Context) {
	if w.metrics == nil {
		return
	}
	pending, oldestAge, err := w.repo.GetOutboxStats(ctx)
	if err != nil {
		log.Printf("outbox stats error: %v", err)
		return
	}
	w.metrics.SetPendingStats(pending, oldestAge)
}

func (w *OutboxWorker) publishMessage(ctx context.Context, msg repository.OutboxMessage) error {
	var payload struct {
		User model.User `json:"user"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}

	switch msg.EventType {
	case "user.created":
		return w.publisher.PublishUserCreated(ctx, payload.User)
	case "user.updated":
		return w.publisher.PublishUserUpdated(ctx, payload.User)
	default:
		return fmt.Errorf("unsupported event type: %s", msg.EventType)
	}
}

func calculateBackoff(attemptCount int) int {
	if attemptCount < 0 {
		attemptCount = 0
	}
	seconds := 1 << attemptCount
	if seconds > 60 {
		seconds = 60
	}
	return seconds
}
