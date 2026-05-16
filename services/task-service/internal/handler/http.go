package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	observability "observability-go"

	"unified-task-manager/services/task-service/internal/board"
	"unified-task-manager/services/task-service/internal/model"
	"unified-task-manager/services/task-service/internal/repository"
	"unified-task-manager/services/task-service/internal/service"
)

type contextKey string

const (
	ctxUserIDKey contextKey = "userID"
	ctxRoleKey   contextKey = "role"
	ctxTeamIDKey contextKey = "teamID"
	ctxTokenKey  contextKey = "token"
)

type HTTPHandler struct {
	svc         *service.TaskService
	boardHub    *board.DistributedHub
	ping        func(context.Context) error
	tokens      *service.TokenManager
	permissions *service.PermissionClient
	allowOrigin string
	logger      *slog.Logger
}

func NewHTTPHandler(svc *service.TaskService, boardHub *board.DistributedHub, ping func(context.Context) error, tokens *service.TokenManager, permissions *service.PermissionClient) *HTTPHandler {
	return &HTTPHandler{svc: svc, boardHub: boardHub, ping: ping, tokens: tokens, permissions: permissions, allowOrigin: "*", logger: observability.NewLogger("task-service")}
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
	mux.HandleFunc("/v1/task-columns", h.auth(h.taskColumns))
	mux.HandleFunc("/v1/task-columns/", h.auth(h.taskColumnByID))
	mux.HandleFunc("/v1/task-activity", h.auth(h.taskActivity))
	mux.HandleFunc("/v1/tasks", h.auth(h.tasks))
	mux.HandleFunc("/v1/tasks/", h.auth(h.taskByID))
	mux.HandleFunc("/v1/boards/stream", h.auth(h.boardStream))
	mux.Handle("/metrics", observability.MetricsHandler())
	return observability.NewHTTPMetrics("task-service").Middleware(h.logger, h.withCORS(mux))
}

func (h *HTTPHandler) Run(addr string) error {
	return http.ListenAndServe(addr, h.Routes())
}

func (h *HTTPHandler) audit(r *http.Request, event string, attrs ...any) {
	if h.logger == nil {
		return
	}
	base := []any{
		"event_type", event,
		"actor_user_id", currentUserID(r.Context()),
		"team_id", currentTeamID(r.Context()),
	}
	base = append(base, attrs...)
	h.logger.InfoContext(r.Context(), "audit_event", base...)
}

func (h *HTTPHandler) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *HTTPHandler) readyz(w http.ResponseWriter, r *http.Request) {
	if h.ping == nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := h.ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"message": "not ready"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (h *HTTPHandler) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})
}

func (h *HTTPHandler) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := strings.TrimSpace(r.Header.Get("Authorization"))
		token := ""
		if strings.HasPrefix(strings.ToLower(header), "bearer ") {
			token = strings.TrimSpace(header[len("Bearer "):])
		}
		if token == "" {
			token = strings.TrimSpace(r.URL.Query().Get("token"))
		}
		if token == "" {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		claims, err := h.tokens.Parse(token, "access")
		if err != nil || claims.Subject == "" {
			writeError(w, http.StatusUnauthorized, "Invalid token")
			return
		}

		availableTeams := normalizeTeamIDs(claims.TeamIDs)
		if strings.TrimSpace(claims.TeamID) != "" {
			availableTeams = appendIfMissing(availableTeams, strings.TrimSpace(claims.TeamID))
		}

		requestedTeamID := strings.TrimSpace(r.Header.Get("X-Team-Id"))
		activeTeamID := strings.TrimSpace(claims.TeamID)
		if len(availableTeams) == 1 && activeTeamID == "" {
			activeTeamID = availableTeams[0]
		}
		if requestedTeamID != "" {
			// Team membership is validated by user-service permissions check.
			// This keeps access working right after creating a new team before token refresh.
			activeTeamID = requestedTeamID
		}
		ctx := context.WithValue(r.Context(), ctxUserIDKey, claims.Subject)
		ctx = context.WithValue(ctx, ctxRoleKey, claims.Role)
		ctx = context.WithValue(ctx, ctxTeamIDKey, activeTeamID)
		ctx = context.WithValue(ctx, ctxTokenKey, token)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

func (h *HTTPHandler) tasks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.listTasks(w, r)
	case http.MethodPost:
		if strings.TrimSpace(r.URL.Query().Get("action")) == "reorder" {
			h.reorderTasksInColumn(w, r)
			return
		}
		h.createTask(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *HTTPHandler) taskColumns(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(r.URL.Query().Get("action")) == "reorder" {
		h.reorderTaskColumns(w, r)
		return
	}
	projectID := strings.TrimSpace(r.URL.Query().Get("projectId"))
	teamID := strings.TrimSpace(currentTeamID(r.Context()))
	if teamID == "" || projectID == "" {
		writeError(w, http.StatusBadRequest, "teamId and projectId are required")
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !h.ensureProjectPermission(w, r, teamID, projectID, "tasks.read") {
			return
		}
		items, err := h.svc.ListColumnsByProject(projectID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	case http.MethodPost:
		if !h.ensureProjectPermission(w, r, teamID, projectID, "tasks.write") {
			return
		}
		var req struct {
			Title string `json:"title"`
		}
		if !decodeJSON(w, r, &req) {
			return
		}
		item, err := h.svc.CreateColumn(service.CreateColumnInput{TeamID: teamID, ProjectID: projectID, Title: req.Title, ActorUserID: currentUserID(r.Context())})
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		h.audit(r, "task_column_created", "project_id", projectID, "column_id", item.ID)
		writeJSON(w, http.StatusCreated, item)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *HTTPHandler) reorderTaskColumns(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	projectID := strings.TrimSpace(r.URL.Query().Get("projectId"))
	teamID := strings.TrimSpace(currentTeamID(r.Context()))
	if teamID == "" || projectID == "" {
		writeError(w, http.StatusBadRequest, "teamId and projectId are required")
		return
	}
	if !h.ensureProjectPermission(w, r, teamID, projectID, "tasks.write") {
		return
	}

	var req struct {
		IDs      []string         `json:"ids"`
		Versions map[string]int64 `json:"versions"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := h.svc.ReorderColumns(projectID, currentUserID(r.Context()), req.IDs, req.Versions); err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.audit(r, "task_columns_reordered", "project_id", projectID, "column_count", len(req.IDs))
	items, err := h.svc.ListColumnsByProject(projectID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *HTTPHandler) taskColumnByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/v1/task-columns/")
	id = strings.TrimSpace(id)
	if id == "" {
		writeError(w, http.StatusBadRequest, "column id is required")
		return
	}
	column, err := h.svc.GetColumnByID(id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	if !h.ensureProjectPermission(w, r, column.TeamID, column.ProjectID, "tasks.write") {
		return
	}
	switch r.Method {
	case http.MethodPatch:
		var req struct {
			Title *string `json:"title"`
		}
		if !decodeJSON(w, r, &req) {
			return
		}
		input := service.UpdateColumnInput{Title: req.Title, ActorUserID: currentUserID(r.Context())}
		if version, ok := service.ParseIfMatchHeader(r.Header.Get("If-Match")); ok {
			input.ExpectedVersion = &version
		}
		updated, err := h.svc.UpdateColumn(id, input)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		h.audit(r, "task_column_updated", "project_id", column.ProjectID, "column_id", id)
		writeColumnJSON(w, http.StatusOK, updated)
	case http.MethodDelete:
		if err := h.svc.DeleteColumn(id, currentUserID(r.Context())); err != nil {
			h.writeServiceError(w, err)
			return
		}
		h.audit(r, "task_column_deleted", "project_id", column.ProjectID, "column_id", id)
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *HTTPHandler) taskActivity(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	projectID := strings.TrimSpace(r.URL.Query().Get("projectId"))
	teamID := strings.TrimSpace(currentTeamID(r.Context()))
	if teamID == "" || projectID == "" {
		writeError(w, http.StatusBadRequest, "teamId and projectId are required")
		return
	}
	if !h.ensureProjectPermission(w, r, teamID, projectID, "tasks.read") {
		return
	}
	limit := parseInt(r.URL.Query().Get("limit"), 30)
	offset := parseInt(r.URL.Query().Get("offset"), 0)
	items, total, err := h.svc.ListActivityByProject(projectID, limit, offset)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *HTTPHandler) taskByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/tasks/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	id := strings.TrimSpace(parts[0])
	if id == "" {
		writeError(w, http.StatusBadRequest, "task id is required")
		return
	}
	if len(parts) >= 2 {
		switch parts[1] {
		case "comments":
			if len(parts) == 2 {
				h.taskComments(w, r, id)
				return
			}
			if len(parts) == 3 && parts[2] == "read" {
				h.taskCommentsRead(w, r, id)
				return
			}
			if len(parts) == 3 && r.Method == http.MethodDelete {
				h.taskCommentByID(w, r, id, strings.TrimSpace(parts[2]))
				return
			}
		case "history":
			if len(parts) == 2 {
				h.taskHistory(w, r, id)
				return
			}
		}
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		task, err := h.svc.GetByID(id)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		if comments, err := h.svc.ListUnreadCommentCounts([]string{task.ID}, currentUserID(r.Context())); err == nil {
			task.UnreadComments = comments[task.ID]
		}
		if !h.ensureProjectPermission(w, r, task.TeamID, task.ProjectID, "tasks.read") {
			return
		}
		writeTaskJSON(w, http.StatusOK, task)
	case http.MethodPatch:
		task, err := h.svc.GetByID(id)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		if !h.ensureProjectPermission(w, r, task.TeamID, task.ProjectID, "tasks.write") {
			return
		}
		h.updateTask(w, r, id)
	case http.MethodDelete:
		task, err := h.svc.GetByID(id)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		if !h.ensureProjectPermission(w, r, task.TeamID, task.ProjectID, "tasks.write") {
			return
		}
		if err := h.svc.Delete(id, currentUserID(r.Context())); err != nil {
			h.writeServiceError(w, err)
			return
		}
		h.audit(r, "task_deleted", "project_id", task.ProjectID, "task_id", id, "status", task.Status)
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *HTTPHandler) createTask(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title          string               `json:"title"`
		Description    string               `json:"description"`
		Status         string               `json:"status"`
		Priority       string               `json:"priority"`
		DueAt          *time.Time           `json:"dueAt"`
		Assignees      []model.TaskAssignee `json:"assignees"`
		Tags           []string             `json:"tags"`
		AssigneeUserID string               `json:"assigneeUserId"`
		AssigneeName   string               `json:"assigneeName"`
		ProjectID      string               `json:"projectId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	teamID := strings.TrimSpace(currentTeamID(r.Context()))
	if teamID == "" {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	if strings.TrimSpace(req.ProjectID) == "" {
		writeError(w, http.StatusBadRequest, "projectId is required")
		return
	}
	if !h.ensureProjectPermission(w, r, teamID, req.ProjectID, "tasks.write") {
		return
	}

	task, err := h.svc.Create(service.CreateTaskInput{
		Title:          req.Title,
		Description:    req.Description,
		Status:         req.Status,
		Priority:       req.Priority,
		DueAt:          req.DueAt,
		CreatedBy:      currentUserID(r.Context()),
		Assignees:      req.Assignees,
		Tags:           req.Tags,
		AssigneeUserID: req.AssigneeUserID,
		AssigneeName:   req.AssigneeName,
		TeamID:         teamID,
		ProjectID:      req.ProjectID,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.audit(r, "task_created", "project_id", task.ProjectID, "task_id", task.ID, "status", task.Status, "priority", task.Priority, "assignee_count", len(task.Assignees), "tag_count", len(task.Tags))
	writeTaskJSON(w, http.StatusCreated, task)
}

func (h *HTTPHandler) reorderTasksInColumn(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	projectID := strings.TrimSpace(r.URL.Query().Get("projectId"))
	teamID := strings.TrimSpace(currentTeamID(r.Context()))
	if teamID == "" || projectID == "" {
		writeError(w, http.StatusBadRequest, "teamId and projectId are required")
		return
	}
	if !h.ensureProjectPermission(w, r, teamID, projectID, "tasks.write") {
		return
	}

	var req struct {
		Status string   `json:"status"`
		IDs    []string `json:"ids"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	tasks, err := h.svc.ReorderTasksInColumn(projectID, currentUserID(r.Context()), strings.TrimSpace(req.Status), req.IDs)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.audit(r, "tasks_reordered", "project_id", projectID, "status", strings.TrimSpace(req.Status), "task_count", len(req.IDs))
	writeJSON(w, http.StatusOK, map[string]any{"items": tasks})
}

func (h *HTTPHandler) listTasks(w http.ResponseWriter, r *http.Request) {
	limit := parseInt(r.URL.Query().Get("limit"), 20)
	offset := parseInt(r.URL.Query().Get("offset"), 0)
	search := r.URL.Query().Get("search")
	projectID := strings.TrimSpace(r.URL.Query().Get("projectId"))
	teamID := strings.TrimSpace(currentTeamID(r.Context()))
	if teamID == "" {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	if projectID == "" {
		writeError(w, http.StatusBadRequest, "projectId is required")
		return
	}
	if !h.ensureProjectPermission(w, r, teamID, projectID, "tasks.read") {
		return
	}

	items, total, err := h.svc.ListByProject(projectID, limit, offset, search)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	if len(items) > 0 {
		taskIDs := make([]string, 0, len(items))
		for _, item := range items {
			taskIDs = append(taskIDs, item.ID)
		}
		if counts, err := h.svc.ListUnreadCommentCounts(taskIDs, currentUserID(r.Context())); err == nil {
			for index := range items {
				items[index].UnreadComments = counts[items[index].ID]
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *HTTPHandler) updateTask(w http.ResponseWriter, r *http.Request, id string) {
	var req struct {
		Title          *string               `json:"title"`
		Description    *string               `json:"description"`
		Status         *string               `json:"status"`
		Priority       *string               `json:"priority"`
		DueAt          *time.Time            `json:"dueAt"`
		Assignees      *[]model.TaskAssignee `json:"assignees"`
		Tags           *[]string             `json:"tags"`
		AssigneeUserID *string               `json:"assigneeUserId"`
		AssigneeName   *string               `json:"assigneeName"`
		Completed      *bool                 `json:"completed"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	input := service.UpdateTaskInput{
		Title:          req.Title,
		Description:    req.Description,
		Status:         req.Status,
		Priority:       req.Priority,
		DueAt:          req.DueAt,
		Assignees:      req.Assignees,
		Tags:           req.Tags,
		AssigneeUserID: req.AssigneeUserID,
		AssigneeName:   req.AssigneeName,
		Completed:      req.Completed,
		ActorUserID:    currentUserID(r.Context()),
	}
	if version, ok := service.ParseIfMatchHeader(r.Header.Get("If-Match")); ok {
		input.ExpectedVersion = &version
	}
	updated, err := h.svc.Update(id, input)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.audit(r, "task_updated", "project_id", updated.ProjectID, "task_id", updated.ID, "status", updated.Status, "priority", updated.Priority, "completed", updated.CompletedAt != nil)
	writeTaskJSON(w, http.StatusOK, updated)
}

func (h *HTTPHandler) taskHistory(w http.ResponseWriter, r *http.Request, taskID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	task, err := h.svc.GetByID(taskID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	if !h.ensureProjectPermission(w, r, task.TeamID, task.ProjectID, "tasks.read") {
		return
	}
	limit := parseInt(r.URL.Query().Get("limit"), 30)
	offset := parseInt(r.URL.Query().Get("offset"), 0)
	items, total, err := h.svc.ListTaskHistory(taskID, limit, offset)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *HTTPHandler) taskComments(w http.ResponseWriter, r *http.Request, taskID string) {
	task, err := h.svc.GetByID(taskID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	if !h.ensureProjectPermission(w, r, task.TeamID, task.ProjectID, "tasks.read") {
		return
	}

	switch r.Method {
	case http.MethodGet:
		items, err := h.svc.ListComments(taskID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	case http.MethodPost:
		if !h.ensureProjectPermission(w, r, task.TeamID, task.ProjectID, "tasks.write") {
			return
		}
		var req struct {
			Body       string `json:"body"`
			AuthorName string `json:"authorName"`
		}
		if !decodeJSON(w, r, &req) {
			return
		}
		comment, err := h.svc.AddComment(service.CreateCommentInput{
			TaskID:     taskID,
			UserID:     currentUserID(r.Context()),
			AuthorName: req.AuthorName,
			Body:       req.Body,
		})
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		h.audit(r, "task_comment_created", "project_id", task.ProjectID, "task_id", taskID, "comment_id", comment.ID)
		writeJSON(w, http.StatusCreated, comment)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *HTTPHandler) taskCommentsRead(w http.ResponseWriter, r *http.Request, taskID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	task, err := h.svc.GetByID(taskID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	if !h.ensureProjectPermission(w, r, task.TeamID, task.ProjectID, "tasks.read") {
		return
	}
	if err := h.svc.MarkCommentsRead(taskID, currentUserID(r.Context())); err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.audit(r, "task_comments_read", "project_id", task.ProjectID, "task_id", taskID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *HTTPHandler) taskCommentByID(w http.ResponseWriter, r *http.Request, taskID, commentID string) {
	if strings.TrimSpace(commentID) == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	task, err := h.svc.GetByID(taskID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	if !h.ensureProjectPermission(w, r, task.TeamID, task.ProjectID, "tasks.write") {
		return
	}
	if err := h.svc.DeleteComment(taskID, commentID, currentUserID(r.Context())); err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.audit(r, "task_comment_deleted", "project_id", task.ProjectID, "task_id", taskID, "comment_id", commentID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *HTTPHandler) writeServiceError(w http.ResponseWriter, err error) {
	var conflict *service.VersionConflictError
	if errors.As(err, &conflict) {
		writeVersionConflict(w, conflict)
		return
	}
	switch {
	case errors.Is(err, service.ErrBadRequest):
		writeError(w, http.StatusBadRequest, "bad request")
	case errors.Is(err, service.ErrUpstream):
		writeError(w, http.StatusBadGateway, "dependency unavailable")
	case errors.Is(err, service.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, repository.ErrInvalidReorder):
		writeError(w, http.StatusBadRequest, "bad request")
	case errors.Is(err, repository.ErrNotFound):
		writeError(w, http.StatusNotFound, "task not found")
	default:
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}

func parseInt(value string, fallback int) int {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	v, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return v
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return false
	}
	return true
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"message": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func currentUserID(ctx context.Context) string {
	value, _ := ctx.Value(ctxUserIDKey).(string)
	return value
}

func currentRole(ctx context.Context) string {
	value, _ := ctx.Value(ctxRoleKey).(string)
	return value
}

func currentTeamID(ctx context.Context) string {
	value, _ := ctx.Value(ctxTeamIDKey).(string)
	return value
}

func currentAccessToken(ctx context.Context) string {
	value, _ := ctx.Value(ctxTokenKey).(string)
	return value
}

func (h *HTTPHandler) ensureProjectPermission(w http.ResponseWriter, r *http.Request, teamID, projectID, permission string) bool {
	if h.permissions == nil {
		writeError(w, http.StatusBadGateway, "dependency unavailable")
		return false
	}
	allowed, err := h.permissions.CheckProjectPermission(r.Context(), currentAccessToken(r.Context()), teamID, projectID, permission)
	if err != nil {
		writeError(w, http.StatusBadGateway, "dependency unavailable")
		return false
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "forbidden")
		return false
	}
	return true
}

func normalizeTeamIDs(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, raw := range values {
		v := strings.TrimSpace(raw)
		if v == "" {
			continue
		}
		result = appendIfMissing(result, v)
	}
	return result
}

func appendIfMissing(values []string, value string) []string {
	if containsString(values, value) {
		return values
	}
	return append(values, value)
}

func containsString(values []string, target string) bool {
	for _, v := range values {
		if v == target {
			return true
		}
	}
	return false
}
