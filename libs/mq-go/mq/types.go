package mq

import "time"

// PublishOptions keeps the publishing API small and readable.
type PublishOptions struct {
	ContentType    string
	ContentEnc     string
	MessageType    string
	CorrelationID  string
	ReplyTo        string
	Persistent     bool
	Headers        map[string]any
	Timestamp      time.Time
}

// RequestOptions controls request/reply calls.
type RequestOptions struct {
	Timeout time.Duration
}
