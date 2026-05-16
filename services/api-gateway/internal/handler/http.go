package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	observability "observability-go"

	"unified-task-manager/services/api-gateway/internal/service"
)

type HTTPHandler struct {
	tokens            *service.TokenManager
	userProxy         *httputil.ReverseProxy
	taskProxy         *httputil.ReverseProxy
	chatProxy         *httputil.ReverseProxy
	callProxy         *httputil.ReverseProxy
	fileProxy         *httputil.ReverseProxy
	mlProxy           *httputil.ReverseProxy
	notificationProxy *httputil.ReverseProxy
	userURL           *url.URL
	taskURL           *url.URL
	chatURL           *url.URL
	callURL           *url.URL
	fileURL           *url.URL
	mlURL             *url.URL
	notificationURL   *url.URL
	allowOrigin       string
	logger            *slog.Logger
}

func NewHTTPHandler(userServiceURL, taskServiceURL, chatServiceURL, callServiceURL, fileServiceURL, mlServiceURL, notificationServiceURL string, tokens *service.TokenManager) (*HTTPHandler, error) {
	userURL, err := url.Parse(strings.TrimSpace(userServiceURL))
	if err != nil {
		return nil, err
	}
	taskURL, err := url.Parse(strings.TrimSpace(taskServiceURL))
	if err != nil {
		return nil, err
	}
	chatURL, err := url.Parse(strings.TrimSpace(chatServiceURL))
	if err != nil {
		return nil, err
	}
	callURL, err := url.Parse(strings.TrimSpace(callServiceURL))
	if err != nil {
		return nil, err
	}
	fileURL, err := url.Parse(strings.TrimSpace(fileServiceURL))
	if err != nil {
		return nil, err
	}
	mlURL, err := url.Parse(strings.TrimSpace(mlServiceURL))
	if err != nil {
		return nil, err
	}
	notificationURL, err := url.Parse(strings.TrimSpace(notificationServiceURL))
	if err != nil {
		return nil, err
	}

	return &HTTPHandler{
		tokens:            tokens,
		userProxy:         newProxy(userURL),
		taskProxy:         newProxy(taskURL),
		chatProxy:         newProxy(chatURL),
		callProxy:         newCallProxy(callURL),
		fileProxy:         newProxy(fileURL),
		mlProxy:           newProxy(mlURL),
		notificationProxy: newProxy(notificationURL),
		userURL:           userURL,
		taskURL:           taskURL,
		chatURL:           chatURL,
		callURL:           callURL,
		fileURL:           fileURL,
		mlURL:             mlURL,
		notificationURL:   notificationURL,
		allowOrigin:       "*",
		logger:            observability.NewLogger("api-gateway"),
	}, nil
}

func (h *HTTPHandler) SetCORSAllowOrigin(origin string) {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		origin = "*"
	}
	h.allowOrigin = origin
}

func (h *HTTPHandler) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", h.healthz)
	mux.HandleFunc("/readyz", h.readyz)
	mux.Handle("/metrics", observability.MetricsHandler())
	mux.HandleFunc("/v1/client-events", h.withCORS(h.clientEvents))
	mux.HandleFunc("/", h.withCORS(h.route))
	return observability.NewHTTPMetrics("api-gateway").Middleware(h.logger, mux)
}

func (h *HTTPHandler) Run(addr string) error {
	return http.ListenAndServe(addr, h.Routes())
}

func (h *HTTPHandler) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *HTTPHandler) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := pingUpstream(ctx, h.userURL); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"message": "user-service not ready"})
		return
	}
	if err := pingUpstream(ctx, h.taskURL); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"message": "task-service not ready"})
		return
	}
	if err := pingUpstream(ctx, h.chatURL); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"message": "chat-service not ready"})
		return
	}
	if err := pingUpstream(ctx, h.callURL); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"message": "call-service not ready"})
		return
	}
	if err := pingUpstream(ctx, h.fileURL); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"message": "file-service not ready"})
		return
	}
	if err := pingUpstream(ctx, h.mlURL); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"message": "ml-service not ready"})
		return
	}
	if err := pingUpstream(ctx, h.notificationURL); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"message": "notification-service not ready"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (h *HTTPHandler) withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := h.allowOrigin
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Team-Id, If-Match")
		w.Header().Set("Access-Control-Expose-Headers", "ETag")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	}
}

func (h *HTTPHandler) route(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSpace(r.URL.Path)
	log.Printf("Routing request: %s %s", r.Method, path)
	if path == "" || path == "/" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "gateway"})
		return
	}

	if isPublicRoute(path) {
		log.Printf("Public route: %s", path)
		h.userProxy.ServeHTTP(w, r)
		return
	}

	claims, err := h.requireAccessToken(r)
	if err != nil {
		log.Printf("Auth failed for %s: %v", path, err)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Unauthorized"})
		return
	}
	if strings.HasPrefix(path, "/v1/boards/") {
		if teamID := strings.TrimSpace(r.URL.Query().Get("teamId")); teamID != "" {
			r.Header.Set("X-Team-Id", teamID)
		}
	}
	h.injectIdentityHeaders(r, claims)

	switch {
	case isUserRoute(path):
		log.Printf("User route: %s", path)
		h.userProxy.ServeHTTP(w, r)
	case isNotificationRoute(path):
		log.Printf("Notification route: %s", path)
		h.notificationProxy.ServeHTTP(w, r)
	case isTaskRoute(path):
		log.Printf("Task route: %s", path)
		h.taskProxy.ServeHTTP(w, r)
	case isChatRoute(path):
		log.Printf("Chat route: %s", path)
		h.chatProxy.ServeHTTP(w, r)
	case isCallRoute(path):
		log.Printf("Call route: %s", path)
		h.callProxy.ServeHTTP(w, r)
	case isFileRoute(path):
		log.Printf("File route: %s", path)
		h.fileProxy.ServeHTTP(w, r)
	case isMlRoute(path):
		log.Printf("ML route: %s", path)
		h.mlProxy.ServeHTTP(w, r)
	default:
		log.Printf("No route found for: %s", path)
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Not found"})
	}
}

func (h *HTTPHandler) clientEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"message": "method not allowed"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	defer r.Body.Close()

	var req struct {
		Type      string            `json:"type"`
		Route     string            `json:"route"`
		Status    int               `json:"status"`
		Duration  float64           `json:"durationMs"`
		Message   string            `json:"message"`
		Browser   string            `json:"browser"`
		Timestamp string            `json:"timestamp"`
		Meta      map[string]string `json:"meta"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid event"})
		return
	}

	eventType := sanitizeLogValue(req.Type, 48)
	if eventType == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "event type is required"})
		return
	}

	h.logger.WarnContext(r.Context(), "client_event",
		"event_type", eventType,
		"route", sanitizeLogValue(req.Route, 180),
		"status", req.Status,
		"duration_ms", req.Duration,
		"message", sanitizeLogValue(req.Message, 300),
		"browser", sanitizeLogValue(req.Browser, 160),
		"timestamp", sanitizeLogValue(req.Timestamp, 80),
		"meta", sanitizeMeta(req.Meta),
	)
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func sanitizeLogValue(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit]
}

func sanitizeMeta(meta map[string]string) map[string]string {
	if len(meta) == 0 {
		return nil
	}
	out := make(map[string]string, min(len(meta), 12))
	count := 0
	for key, value := range meta {
		if count >= 12 {
			break
		}
		key = sanitizeLogValue(key, 48)
		if key == "" {
			continue
		}
		out[key] = sanitizeLogValue(value, 120)
		count++
	}
	return out
}

func (h *HTTPHandler) requireAccessToken(r *http.Request) (*service.Claims, error) {
	token := extractBearerToken(r)
	if token == "" {
		return nil, errors.New("missing token")
	}
	return h.tokens.Parse(token, "access")
}

func extractBearerToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return strings.TrimSpace(header[len("Bearer "):])
	}
	return strings.TrimSpace(r.URL.Query().Get("token"))
}

func (h *HTTPHandler) injectIdentityHeaders(r *http.Request, claims *service.Claims) {
	if claims == nil {
		return
	}
	r.Header.Del("X-Gateway-User-Id")
	r.Header.Del("X-Gateway-Role")
	r.Header.Del("X-Gateway-Team-Id")
	r.Header.Del("X-Gateway-Team-Ids")
	r.Header.Del("X-User-Id")
	r.Header.Del("X-User-Role")
	r.Header.Set("X-Gateway-User-Id", claims.Subject)
	r.Header.Set("X-Gateway-Role", claims.Role)
	r.Header.Set("X-User-Id", claims.Subject)
	r.Header.Set("X-User-Role", claims.Role)
	if claims.TeamID != "" {
		r.Header.Set("X-Gateway-Team-Id", claims.TeamID)
	}
	if teamID := strings.TrimSpace(r.Header.Get("X-Team-Id")); teamID != "" {
		r.Header.Set("X-Gateway-Team-Id", teamID)
	}
	if len(claims.TeamIDs) > 0 {
		r.Header.Set("X-Gateway-Team-Ids", strings.Join(claims.TeamIDs, ","))
	}
}

func isPublicRoute(path string) bool {
	switch {
	case path == "/v1/auth/register":
		return true
	case path == "/v1/auth/login":
		return true
	case path == "/v1/auth/refresh":
		return true
	default:
		return false
	}
}

func isUserRoute(path string) bool {
	return strings.HasPrefix(path, "/v1/users") || strings.HasPrefix(path, "/v1/teams") || strings.HasPrefix(path, "/v1/permissions/check") || strings.HasPrefix(path, "/v1/auth")
}

func isTaskRoute(path string) bool {
	return strings.HasPrefix(path, "/v1/tasks") ||
		strings.HasPrefix(path, "/v1/task-columns") ||
		strings.HasPrefix(path, "/v1/task-activity") ||
		strings.HasPrefix(path, "/v1/boards")
}

func isChatRoute(path string) bool {
	return strings.HasPrefix(path, "/v1/chats")
}

func isCallRoute(path string) bool {
	return strings.HasPrefix(path, "/v1/calls") || strings.HasPrefix(path, "/api/calls") || strings.HasPrefix(path, "/calls")
}

func isFileRoute(path string) bool {
	return strings.HasPrefix(path, "/v1/file-environments")
}

func isMlRoute(path string) bool {
	return strings.HasPrefix(path, "/task_name_description") || strings.HasPrefix(path, "/api/tasks/assistant")
}

func isNotificationRoute(path string) bool {
	return (strings.HasPrefix(path, "/v1/tasks/") && strings.HasSuffix(path, "/deadline-notification")) ||
		(strings.HasPrefix(path, "/v1/projects/") && strings.HasSuffix(path, "/notification-settings"))
}

func newProxy(target *url.URL) *httputil.ReverseProxy {
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
		req.Header.Set("X-Forwarded-Host", req.Host)
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("upstream unavailable for %s %s: %v", r.Method, r.URL.Path, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"message": "upstream unavailable"})
	}
	return proxy
}

func newCallProxy(target *url.URL) *httputil.ReverseProxy {
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
		req.Header.Set("X-Forwarded-Host", req.Host)
		// Remove /api prefix for call-service
		if strings.HasPrefix(req.URL.Path, "/api/calls") {
			req.URL.Path = strings.Replace(req.URL.Path, "/api/calls", "/calls", 1)
		}
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("call upstream unavailable for %s %s: %v", r.Method, r.URL.Path, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"message": "upstream unavailable"})
	}
	return proxy
}

func pingUpstream(ctx context.Context, target *url.URL) error {
	client := &http.Client{Timeout: 2 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String()+"/readyz", nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return errors.New("upstream not ready")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
