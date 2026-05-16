package event

import (
	"context"
	"log"
	"time"

	"UnifiedTaskManager/services/user-service/internal/repository"
)

type OutboxCleaner struct {
	repo       repository.OutboxMaintenanceRepository
	metrics    *OutboxMetrics
	interval   time.Duration
	retention  time.Duration
	batchSize  int
	archive    bool
	maxPerTick int
}

func NewOutboxCleaner(repo repository.OutboxMaintenanceRepository, metrics *OutboxMetrics, interval, retention time.Duration, batchSize int, archive bool) *OutboxCleaner {
	if interval <= 0 {
		interval = 1 * time.Minute
	}
	if retention <= 0 {
		retention = 7 * 24 * time.Hour
	}
	if batchSize <= 0 {
		batchSize = 500
	}
	return &OutboxCleaner{
		repo:       repo,
		metrics:    metrics,
		interval:   interval,
		retention:  retention,
		batchSize:  batchSize,
		archive:    archive,
		maxPerTick: 20,
	}
}

func (c *OutboxCleaner) Run(ctx context.Context) {
	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()

	for {
		_, _, _ = c.RunOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (c *OutboxCleaner) RunOnce(ctx context.Context) (int, int, error) {
	totalDeleted := 0
	totalArchived := 0

	for i := 0; i < c.maxPerTick; i++ {
		deleted, archived, err := c.repo.CleanupPublishedOutbox(ctx, c.retention, c.batchSize, c.archive)
		if err != nil {
			log.Printf("outbox cleaner error: %v", err)
			if c.metrics != nil {
				c.metrics.IncCleanerRunError()
			}
			return totalDeleted, totalArchived, err
		}
		if deleted == 0 {
			break
		}
		totalDeleted += deleted
		totalArchived += archived
		log.Printf("outbox cleaner deleted=%d", deleted)
	}

	if c.metrics != nil {
		c.metrics.AddCleanerDeleted(totalDeleted)
		c.metrics.AddCleanerArchived(totalArchived)
	}

	return totalDeleted, totalArchived, nil
}
