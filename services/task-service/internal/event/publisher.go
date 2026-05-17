package event

import (
	"context"

	"unified-task-manager/services/task-service/internal/model"
)

type TaskEventPublisher interface {
	PublishTaskCreated(ctx context.Context, task model.Task) error
	PublishTaskUpdated(ctx context.Context, task model.Task) error
	PublishTaskDeleted(ctx context.Context, task model.Task) error
}

type NoopPublisher struct{}

func NewNoopPublisher() TaskEventPublisher {
	return NoopPublisher{}
}

func (NoopPublisher) PublishTaskCreated(context.Context, model.Task) error { return nil }
func (NoopPublisher) PublishTaskUpdated(context.Context, model.Task) error { return nil }
func (NoopPublisher) PublishTaskDeleted(context.Context, model.Task) error { return nil }
