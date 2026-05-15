package event

import (
	"context"

	"vg-task-system/services/user-service/internal/model"
)

type UserEventPublisher interface {
	PublishUserCreated(ctx context.Context, user model.User) error
	PublishUserUpdated(ctx context.Context, user model.User) error
}

type NoopPublisher struct{}

func NewNoopPublisher() UserEventPublisher {
	return NoopPublisher{}
}

func (NoopPublisher) PublishUserCreated(context.Context, model.User) error {
	return nil
}

func (NoopPublisher) PublishUserUpdated(context.Context, model.User) error {
	return nil
}
