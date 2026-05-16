package event

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"unified-task-manager/services/task-service/internal/model"
)

const (
	rabbitInitAttempts = 20
	rabbitInitDelay    = 2 * time.Second
)

type RabbitMQPublisher struct {
	conn     *amqp.Connection
	ch       *amqp.Channel
	exchange string
}

type taskEventPayload struct {
	EventType  string     `json:"eventType"`
	OccurredAt time.Time  `json:"occurredAt"`
	Task       model.Task `json:"task"`
}

func NewRabbitMQPublisher(url, exchange string) (*RabbitMQPublisher, error) {
	var lastErr error
	for attempt := 1; attempt <= rabbitInitAttempts; attempt++ {
		conn, err := amqp.Dial(url)
		if err == nil {
			ch, err := conn.Channel()
			if err == nil {
				exchangeErr := ch.ExchangeDeclare(exchange, "topic", true, false, false, false, nil)
				if exchangeErr == nil {
					return &RabbitMQPublisher{conn: conn, ch: ch, exchange: exchange}, nil
				}
				_ = ch.Close()
				_ = conn.Close()
				lastErr = exchangeErr
			} else {
				_ = conn.Close()
				lastErr = err
			}
		} else {
			lastErr = err
		}
		if attempt < rabbitInitAttempts {
			time.Sleep(rabbitInitDelay)
		}
	}
	return nil, fmt.Errorf("rabbitmq init failed after %d attempts: %w", rabbitInitAttempts, lastErr)
}

func (p *RabbitMQPublisher) PublishTaskCreated(ctx context.Context, task model.Task) error {
	return p.publish(ctx, "task.created", task)
}

func (p *RabbitMQPublisher) PublishTaskUpdated(ctx context.Context, task model.Task) error {
	return p.publish(ctx, "task.updated", task)
}

func (p *RabbitMQPublisher) PublishTaskDeleted(ctx context.Context, task model.Task) error {
	return p.publish(ctx, "task.deleted", task)
}

func (p *RabbitMQPublisher) publish(ctx context.Context, routingKey string, task model.Task) error {
	payload := taskEventPayload{
		EventType:  routingKey,
		OccurredAt: time.Now().UTC(),
		Task:       task,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return p.ch.PublishWithContext(ctx, p.exchange, routingKey, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Timestamp:    time.Now().UTC(),
		Body:         body,
	})
}

func (p *RabbitMQPublisher) Close() error {
	if p == nil {
		return nil
	}
	var firstErr error
	if p.ch != nil {
		if err := p.ch.Close(); err != nil {
			firstErr = err
		}
	}
	if p.conn != nil {
		if err := p.conn.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if firstErr != nil {
		return fmt.Errorf("rabbitmq close: %w", firstErr)
	}
	return nil
}
