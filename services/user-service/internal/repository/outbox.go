package repository

import (
	"context"
	"time"
)

type OutboxMessage struct {
	ID           string
	EventType    string
	Payload      []byte
	AttemptCount int
}

type OutboxRepository interface {
	FetchPendingOutbox(ctx context.Context, batchSize int) ([]OutboxMessage, error)
	MarkOutboxPublished(ctx context.Context, id string) error
	MarkOutboxFailed(ctx context.Context, id string, reason string, retryAfterSeconds int) error
	MarkOutboxDead(ctx context.Context, id string, reason string) error
	GetOutboxStats(ctx context.Context) (pendingCount int, oldestPendingAgeSeconds float64, err error)
}

type OutboxMaintenanceRepository interface {
	OutboxRepository
	CleanupPublishedOutbox(ctx context.Context, olderThan time.Duration, batchSize int, archive bool) (deletedCount int, archivedCount int, err error)
}
