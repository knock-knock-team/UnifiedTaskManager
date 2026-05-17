package observability

import (
	"bufio"
	"log/slog"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var idSegmentPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9]+$`)

type responseRecorder struct {
	http.ResponseWriter
	status int
	size   int
}

func (r *responseRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *responseRecorder) Write(body []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(body)
	r.size += n
	return n, err
}

func (r *responseRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (r *responseRecorder) Hijack() (netConn net.Conn, rw *bufio.ReadWriter, err error) {
	hijacker, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}

type HTTPMetrics struct {
	requestsTotal *prometheus.CounterVec
	duration      *prometheus.HistogramVec
	inFlight      *prometheus.GaugeVec
	responseSize  *prometheus.HistogramVec
	service       string
	slowThreshold time.Duration
}

func NewLogger(service string) *slog.Logger {
	level := slog.LevelInfo
	switch strings.ToLower(strings.TrimSpace(os.Getenv("LOG_LEVEL"))) {
	case "debug":
		level = slog.LevelDebug
	case "warn", "warning":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}

	opts := &slog.HandlerOptions{Level: level}
	var handler slog.Handler
	if strings.EqualFold(os.Getenv("ENV"), "production") {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}
	return slog.New(handler).With("service", service)
}

func NewHTTPMetrics(service string) *HTTPMetrics {
	m := &HTTPMetrics{
		service:       service,
		slowThreshold: slowRequestThreshold(),
		requestsTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests.",
		}, []string{"service", "method", "route", "status"}),
		duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request duration in seconds.",
			Buckets: prometheus.DefBuckets,
		}, []string{"service", "method", "route", "status"}),
		inFlight: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "http_requests_in_flight",
			Help: "Current number of in-flight HTTP requests.",
		}, []string{"service", "method", "route"}),
		responseSize: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "http_response_size_bytes",
			Help:    "HTTP response size in bytes.",
			Buckets: []float64{128, 512, 1024, 4096, 16384, 65536, 262144, 1048576},
		}, []string{"service", "method", "route", "status"}),
	}
	register(m.requestsTotal, m.duration, m.inFlight, m.responseSize)
	return m
}

func register(collectors ...prometheus.Collector) {
	for _, collector := range collectors {
		if err := prometheus.Register(collector); err != nil {
			if already, ok := err.(prometheus.AlreadyRegisteredError); ok {
				_ = already
				continue
			}
		}
	}
}

func MetricsHandler() http.Handler {
	return promhttp.Handler()
}

func (m *HTTPMetrics) Middleware(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}

		route := normalizeRoute(r.URL.Path)
		method := r.Method
		started := time.Now()
		rec := &responseRecorder{ResponseWriter: w}

		m.inFlight.WithLabelValues(m.service, method, route).Inc()
		defer m.inFlight.WithLabelValues(m.service, method, route).Dec()

		next.ServeHTTP(rec, r)

		status := rec.status
		if status == 0 {
			status = http.StatusOK
		}
		statusLabel := strconv.Itoa(status)
		elapsed := time.Since(started)

		m.requestsTotal.WithLabelValues(m.service, method, route, statusLabel).Inc()
		m.duration.WithLabelValues(m.service, method, route, statusLabel).Observe(elapsed.Seconds())
		m.responseSize.WithLabelValues(m.service, method, route, statusLabel).Observe(float64(rec.size))

		if logger != nil {
			logger.InfoContext(r.Context(), "http_request",
				"method", method,
				"route", route,
				"status", status,
				"duration_ms", elapsed.Milliseconds(),
				"remote_addr", clientIP(r),
			)
			if m.slowThreshold > 0 && elapsed >= m.slowThreshold {
				logger.WarnContext(r.Context(), "slow_http_request",
					"method", method,
					"route", route,
					"status", status,
					"duration_ms", elapsed.Milliseconds(),
					"threshold_ms", m.slowThreshold.Milliseconds(),
					"remote_addr", clientIP(r),
				)
			}
		}
	})
}

func slowRequestThreshold() time.Duration {
	raw := strings.TrimSpace(os.Getenv("SLOW_REQUEST_MS"))
	if raw == "" {
		return 750 * time.Millisecond
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 0
	}
	return time.Duration(value) * time.Millisecond
}

func normalizeRoute(path string) string {
	if path == "" {
		return "/"
	}
	parts := strings.Split(path, "/")
	for i, part := range parts {
		if idSegmentPattern.MatchString(part) {
			parts[i] = ":id"
		}
	}
	return strings.Join(parts, "/")
}

func clientIP(r *http.Request) string {
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
		if idx := strings.IndexByte(forwarded, ','); idx >= 0 {
			return strings.TrimSpace(forwarded[:idx])
		}
		return forwarded
	}
	return r.RemoteAddr
}
