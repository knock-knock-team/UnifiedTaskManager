package event

import "github.com/prometheus/client_golang/prometheus"

type OutboxMetrics struct {
	pendingCount          prometheus.Gauge
	pendingOldest         prometheus.Gauge
	retriesTotal          prometheus.Counter
	publishedTotal        prometheus.Counter
	deadLetterTotal       prometheus.Counter
	cleanerDeletedTotal   prometheus.Counter
	cleanerArchivedTotal  prometheus.Counter
	cleanerRunErrorsTotal prometheus.Counter
}

func NewOutboxMetrics() *OutboxMetrics {
	m := &OutboxMetrics{
		pendingCount: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "user_service",
			Subsystem: "outbox",
			Name:      "pending_count",
			Help:      "Current number of pending outbox events",
		}),
		pendingOldest: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "user_service",
			Subsystem: "outbox",
			Name:      "oldest_pending_age_seconds",
			Help:      "Age in seconds of the oldest pending outbox event",
		}),
		retriesTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "user_service",
			Subsystem: "outbox",
			Name:      "publish_retries_total",
			Help:      "Total number of outbox retry attempts",
		}),
		publishedTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "user_service",
			Subsystem: "outbox",
			Name:      "published_total",
			Help:      "Total number of outbox events published",
		}),
		deadLetterTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "user_service",
			Subsystem: "outbox",
			Name:      "dead_letter_total",
			Help:      "Total number of outbox events moved to dead-letter status",
		}),
		cleanerDeletedTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "user_service",
			Subsystem: "outbox_cleaner",
			Name:      "deleted_total",
			Help:      "Total number of published outbox rows deleted by cleaner",
		}),
		cleanerArchivedTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "user_service",
			Subsystem: "outbox_cleaner",
			Name:      "archived_total",
			Help:      "Total number of published outbox rows archived by cleaner",
		}),
		cleanerRunErrorsTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "user_service",
			Subsystem: "outbox_cleaner",
			Name:      "run_errors_total",
			Help:      "Total number of outbox cleaner run errors",
		}),
	}
	prometheus.MustRegister(
		m.pendingCount,
		m.pendingOldest,
		m.retriesTotal,
		m.publishedTotal,
		m.deadLetterTotal,
		m.cleanerDeletedTotal,
		m.cleanerArchivedTotal,
		m.cleanerRunErrorsTotal,
	)
	return m
}

func (m *OutboxMetrics) SetPendingStats(count int, oldestAgeSeconds float64) {
	m.pendingCount.Set(float64(count))
	if oldestAgeSeconds < 0 {
		oldestAgeSeconds = 0
	}
	m.pendingOldest.Set(oldestAgeSeconds)
}

func (m *OutboxMetrics) IncRetry() {
	m.retriesTotal.Inc()
}

func (m *OutboxMetrics) IncPublished() {
	m.publishedTotal.Inc()
}

func (m *OutboxMetrics) IncDeadLetter() {
	m.deadLetterTotal.Inc()
}

func (m *OutboxMetrics) AddCleanerDeleted(n int) {
	if n > 0 {
		m.cleanerDeletedTotal.Add(float64(n))
	}
}

func (m *OutboxMetrics) AddCleanerArchived(n int) {
	if n > 0 {
		m.cleanerArchivedTotal.Add(float64(n))
	}
}

func (m *OutboxMetrics) IncCleanerRunError() {
	m.cleanerRunErrorsTotal.Inc()
}
