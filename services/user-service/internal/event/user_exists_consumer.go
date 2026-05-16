package event

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const DefaultUserExistsQueue = "user-service.user-exists"

type UserExistsConsumer struct {
	conn  *amqp.Connection
	ch    *amqp.Channel
	queue string
}

type userExistsRequest struct {
	UserID string `json:"user_id"`
}

type userExistsResponse struct {
	Exists bool `json:"exists"`
}

func NewUserExistsConsumer(url, queue string) (*UserExistsConsumer, error) {
	queue = strings.TrimSpace(queue)
	if queue == "" {
		queue = DefaultUserExistsQueue
	}

	var lastErr error
	for attempt := 1; attempt <= rabbitInitAttempts; attempt++ {
		conn, err := amqp.Dial(url)
		if err == nil {
			ch, err := conn.Channel()
			if err == nil {
				if _, err := ch.QueueDeclare(queue, true, false, false, false, nil); err == nil {
					return &UserExistsConsumer{conn: conn, ch: ch, queue: queue}, nil
				}
				lastErr = err
				_ = ch.Close()
				_ = conn.Close()
			} else {
				lastErr = err
				_ = conn.Close()
			}
		} else {
			lastErr = err
		}

		if attempt < rabbitInitAttempts {
			time.Sleep(rabbitInitDelay)
		}
	}

	return nil, fmt.Errorf("rabbitmq user-exists consumer init failed after %d attempts: %w", rabbitInitAttempts, lastErr)
}

func (c *UserExistsConsumer) Run(ctx context.Context, userLookup func(context.Context, string) (bool, error)) error {
	if c == nil || c.ch == nil {
		return fmt.Errorf("user-exists consumer is not configured")
	}
	if userLookup == nil {
		return fmt.Errorf("user lookup callback is required")
	}

	msgs, err := c.ch.Consume(c.queue, "", false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("consume user-exists queue: %w", err)
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-msgs:
			if !ok {
				return nil
			}

			var req userExistsRequest
			if err := json.Unmarshal(msg.Body, &req); err != nil {
				_ = msg.Nack(false, false)
				continue
			}

			exists, err := userLookup(ctx, req.UserID)
			if err != nil {
				_ = msg.Nack(false, true)
				continue
			}

			if msg.ReplyTo != "" {
				body, err := json.Marshal(userExistsResponse{Exists: exists})
				if err != nil {
					_ = msg.Nack(false, false)
					continue
				}
				if err := c.ch.PublishWithContext(ctx, "", msg.ReplyTo, false, false, amqp.Publishing{
					ContentType:   "application/json",
					CorrelationId: msg.CorrelationId,
					Body:          body,
				}); err != nil {
					_ = msg.Nack(false, true)
					continue
				}
			}

			if err := msg.Ack(false); err != nil {
				return fmt.Errorf("ack user-exists request: %w", err)
			}
		}
	}
}

func (c *UserExistsConsumer) Close() error {
	if c == nil {
		return nil
	}
	var firstErr error
	if c.ch != nil {
		if err := c.ch.Close(); err != nil {
			firstErr = err
		}
	}
	if c.conn != nil {
		if err := c.conn.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if firstErr != nil {
		return fmt.Errorf("user-exists consumer close: %w", firstErr)
	}
	return nil
}
