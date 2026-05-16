package mq

import (
	"context"
	"errors"
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Client owns a RabbitMQ connection.
type Client struct {
	conn *amqp.Connection
}

// Connect opens a RabbitMQ connection.
func Connect(url string) (*Client, error) {
	conn, err := amqp.Dial(url)
	if err != nil {
		return nil, fmt.Errorf("connect to rabbitmq: %w", err)
	}
	return &Client{conn: conn}, nil
}

// Close closes the underlying connection.
func (c *Client) Close() error {
	if c == nil || c.conn == nil {
		return nil
	}
	return c.conn.Close()
}

// Channel opens a new AMQP channel.
func (c *Client) Channel() (*amqp.Channel, error) {
	if c == nil || c.conn == nil {
		return nil, errors.New("mq client is nil")
	}
	return c.conn.Channel()
}

// WithChannel is a small helper that opens a channel and closes it after use.
func (c *Client) WithChannel(fn func(*amqp.Channel) error) error {
	ch, err := c.Channel()
	if err != nil {
		return err
	}
	defer ch.Close()

	return fn(ch)
}

// DeclareQueue creates a queue if it does not exist.
func DeclareQueue(ch *amqp.Channel, name string, durable bool) (amqp.Queue, error) {
	return ch.QueueDeclare(name, durable, false, false, false, nil)
}

// DeclareExchange creates an exchange if it does not exist.
func DeclareExchange(ch *amqp.Channel, name, kind string, durable bool) error {
	return ch.ExchangeDeclare(name, kind, durable, false, false, false, nil)
}

// BindQueue binds a queue to an exchange with a routing key.
func BindQueue(ch *amqp.Channel, queue, routingKey, exchange string) error {
	return ch.QueueBind(queue, routingKey, exchange, false, nil)
}

// Publish publishes raw bytes.
func Publish(ctx context.Context, ch *amqp.Channel, exchange, routingKey string, body []byte, opts PublishOptions) error {
	msg := amqp.Publishing{
		ContentType:     opts.ContentType,
		ContentEncoding:  opts.ContentEnc,
		CorrelationId:    opts.CorrelationID,
		ReplyTo:          opts.ReplyTo,
		Type:             opts.MessageType,
		Body:             body,
		Timestamp:        opts.Timestamp,
		Headers:          amqp.Table{},
		DeliveryMode:     amqp.Transient,
	}
	if msg.ContentType == "" {
		msg.ContentType = "application/json"
	}
	if opts.Persistent {
		msg.DeliveryMode = amqp.Persistent
	}
	for k, v := range opts.Headers {
		msg.Headers[k] = v
	}

	return ch.PublishWithContext(ctx, exchange, routingKey, false, false, msg)
}
