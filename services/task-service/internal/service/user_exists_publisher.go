package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const DefaultUserExistsQueue = "user-service.user-exists"

const (
	rpcInitAttempts = 20
	rpcInitDelay    = 2 * time.Second
)

var rpcSeq uint64

type UserDirectory interface {
	UserExists(ctx context.Context, userID string) (bool, error)
	Close() error
}

type NoopUserDirectory struct{}

func NewNoopUserDirectory() UserDirectory {
	return NoopUserDirectory{}
}

func (NoopUserDirectory) UserExists(context.Context, string) (bool, error) {
	return true, nil
}

func (NoopUserDirectory) Close() error { return nil }

type RabbitUserDirectory struct {
	conn    *amqp.Connection
	queue   string
	timeout time.Duration
}

type userExistsRequest struct {
	UserID string `json:"user_id"`
}

type userExistsResponse struct {
	Exists bool `json:"exists"`
}

func NewRabbitUserDirectory(url, queue string, timeout time.Duration) (*RabbitUserDirectory, error) {
	queue = strings.TrimSpace(queue)
	if queue == "" {
		queue = DefaultUserExistsQueue
	}
	if timeout <= 0 {
		timeout = 3 * time.Second
	}

	var lastErr error
	for attempt := 1; attempt <= rpcInitAttempts; attempt++ {
		conn, err := amqp.Dial(url)
		if err == nil {
			return &RabbitUserDirectory{conn: conn, queue: queue, timeout: timeout}, nil
		}
		lastErr = err
		if attempt < rpcInitAttempts {
			time.Sleep(rpcInitDelay)
		}
	}

	return nil, fmt.Errorf("rabbitmq rpc init failed after %d attempts: %w", rpcInitAttempts, lastErr)
}

func (d *RabbitUserDirectory) UserExists(ctx context.Context, userID string) (bool, error) {
	if d == nil || d.conn == nil {
		return false, fmt.Errorf("rabbitmq rpc client is not configured")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	userID = strings.TrimSpace(userID)
	if userID == "" {
		return true, nil
	}

	ch, err := d.conn.Channel()
	if err != nil {
		return false, fmt.Errorf("open rpc channel: %w", err)
	}
	defer ch.Close()

	if _, err := ch.QueueDeclare(d.queue, true, false, false, false, nil); err != nil {
		return false, fmt.Errorf("declare rpc request queue: %w", err)
	}

	replyQueue, err := ch.QueueDeclare("", false, true, true, false, nil)
	if err != nil {
		return false, fmt.Errorf("declare rpc reply queue: %w", err)
	}

	consumerTag := nextRPCID("task-user-exists-reply")
	replies, err := ch.Consume(replyQueue.Name, consumerTag, true, true, false, false, nil)
	if err != nil {
		return false, fmt.Errorf("consume rpc reply queue: %w", err)
	}

	body, err := json.Marshal(userExistsRequest{UserID: userID})
	if err != nil {
		return false, fmt.Errorf("marshal rpc request: %w", err)
	}

	requestCtx := ctx
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		requestCtx, cancel = context.WithTimeout(ctx, d.timeout)
		defer cancel()
	}

	correlationID := nextRPCID("task-user-exists-corr")
	err = ch.PublishWithContext(requestCtx, "", d.queue, false, false, amqp.Publishing{
		ContentType:   "application/json",
		CorrelationId: correlationID,
		ReplyTo:       replyQueue.Name,
		Body:          body,
	})
	if err != nil {
		return false, fmt.Errorf("publish rpc request: %w", err)
	}

	for {
		select {
		case <-requestCtx.Done():
			return false, requestCtx.Err()
		case msg, ok := <-replies:
			if !ok {
				return false, fmt.Errorf("reply queue closed before response")
			}
			if msg.CorrelationId != correlationID {
				continue
			}
			var resp userExistsResponse
			if err := json.Unmarshal(msg.Body, &resp); err != nil {
				return false, fmt.Errorf("decode rpc response: %w", err)
			}
			return resp.Exists, nil
		}
	}
}

func (d *RabbitUserDirectory) Close() error {
	if d == nil || d.conn == nil {
		return nil
	}
	if err := d.conn.Close(); err != nil {
		return fmt.Errorf("close rabbitmq rpc connection: %w", err)
	}
	return nil
}

func nextRPCID(prefix string) string {
	return prefix + "-" + strconv.FormatInt(time.Now().UnixNano(), 10) + "-" + strconv.FormatUint(atomic.AddUint64(&rpcSeq, 1), 10)
}
