package mq

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

var rpcSeq uint64

func nextID(prefix string) string {
	return fmt.Sprintf("%s-%d-%d", prefix, time.Now().UnixNano(), atomic.AddUint64(&rpcSeq, 1))
}

func publishReply(ctx context.Context, ch *amqp.Channel, replyTo, correlationID string, payload any) error {
	return PublishJSON(ctx, ch, "", replyTo, payload, PublishOptions{
		ContentType:   "application/json",
		CorrelationID: correlationID,
	})
}

// RequestJSON sends a request and waits for a single JSON response.
func RequestJSON[Req any, Resp any](ctx context.Context, ch *amqp.Channel, queue string, req Req) (Resp, error) {
	var zero Resp

	replyQueueName := nextID("reply")
	replyQueue, err := ch.QueueDeclare(replyQueueName, false, true, true, false, nil)
	if err != nil {
		return zero, fmt.Errorf("declare reply queue: %w", err)
	}

	consumerTag := nextID("rpc-reply")
	replies, err := ch.Consume(replyQueue.Name, consumerTag, true, true, false, false, nil)
	if err != nil {
		return zero, fmt.Errorf("consume reply queue: %w", err)
	}

	correlationID := nextID("corr")
	if err := PublishJSON(ctx, ch, "", queue, req, PublishOptions{
		ReplyTo:       replyQueue.Name,
		CorrelationID: correlationID,
		ContentType:   "application/json",
	}); err != nil {
		return zero, fmt.Errorf("publish rpc request: %w", err)
	}

	for {
		select {
		case <-ctx.Done():
			return zero, ctx.Err()
		case msg, ok := <-replies:
			if !ok {
				return zero, fmt.Errorf("reply queue closed before response")
			}
			if msg.CorrelationId != correlationID {
				continue
			}
			var resp Resp
			if err := json.Unmarshal(msg.Body, &resp); err != nil {
				return zero, fmt.Errorf("decode rpc response: %w", err)
			}
			return resp, nil
		}
	}
}

// ServeRPCJSON consumes request messages and answers them on reply_to.
func ServeRPCJSON[Req any, Resp any](
	ctx context.Context,
	ch *amqp.Channel,
	queue string,
	handler func(context.Context, Req) (Resp, error),
) error {
	consumerTag := nextID("rpc-server")
	msgs, err := ch.Consume(queue, consumerTag, false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("consume rpc queue: %w", err)
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-msgs:
			if !ok {
				return nil
			}

			var req Req
			if err := json.Unmarshal(msg.Body, &req); err != nil {
				_ = msg.Nack(false, false)
				continue
			}

			resp, err := handler(ctx, req)
			if err != nil {
				_ = msg.Nack(false, true)
				continue
			}

			if msg.ReplyTo == "" {
				_ = msg.Ack(false)
				continue
			}

			if err := publishReply(ctx, ch, msg.ReplyTo, msg.CorrelationId, resp); err != nil {
				_ = msg.Nack(false, true)
				continue
			}

			if err := msg.Ack(false); err != nil {
				return fmt.Errorf("ack rpc request: %w", err)
			}
		}
	}
}
