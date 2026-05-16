package mq

import (
	"context"
	"encoding/json"
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
)

// PublishJSON marshals payload as JSON and publishes it.
func PublishJSON(ctx context.Context, ch *amqp.Channel, exchange, routingKey string, payload any, opts PublishOptions) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal json payload: %w", err)
	}
	if opts.ContentType == "" {
		opts.ContentType = "application/json"
	}
	return Publish(ctx, ch, exchange, routingKey, body, opts)
}

// DecodeJSON decodes a delivery body into T.
func DecodeJSON[T any](body []byte) (T, error) {
	var out T
	if err := json.Unmarshal(body, &out); err != nil {
		return out, err
	}
	return out, nil
}

// EncodeJSON is a small helper for tests and custom handlers.
func EncodeJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}
