package consumer

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	mq "mq-go/mq"
	"UnifiedTaskManager/services/task-service/internal/repository"
	"UnifiedTaskManager/services/task-service/internal/service"
)

type AgentCommandsConsumer struct {
	client      *mq.Client
	queue       string
	svc         *service.TaskService
	tokens      *service.TokenManager
	permissions *service.PermissionClient
}

type AgentCommandRequest struct {
	RequestID   string          `json:"request_id"`
	Command     string          `json:"command"`
	TeamID      string          `json:"team_id"`
	ProjectID   string          `json:"project_id"`
	AccessToken string          `json:"access_token"`
	ActorUserID string          `json:"actor_user_id,omitempty"`
	Payload     json.RawMessage `json:"payload"`
}

type AgentCommandError struct {
	Service    string         `json:"service"`
	Operation  string         `json:"operation"`
	Message    string         `json:"message"`
	StatusCode int            `json:"status_code,omitempty"`
	Code       string         `json:"code,omitempty"`
	Retryable  bool           `json:"retryable"`
	Details    map[string]any `json:"details,omitempty"`
}

type AgentCommandResponse struct {
	Success bool               `json:"success"`
	Message string             `json:"message"`
	Data    map[string]any     `json:"data,omitempty"`
	Error   *AgentCommandError `json:"error,omitempty"`
}

func NewAgentCommandsConsumer(
	url string,
	queue string,
	svc *service.TaskService,
	tokens *service.TokenManager,
	permissions *service.PermissionClient,
) (*AgentCommandsConsumer, error) {
	client, err := mq.Connect(url)
	if err != nil {
		return nil, err
	}
	return &AgentCommandsConsumer{
		client:      client,
		queue:       strings.TrimSpace(queue),
		svc:         svc,
		tokens:      tokens,
		permissions: permissions,
	}, nil
}

func (c *AgentCommandsConsumer) Close() error {
	if c == nil || c.client == nil {
		return nil
	}
	return c.client.Close()
}

func (c *AgentCommandsConsumer) Run(ctx context.Context) error {
	if c == nil || c.client == nil {
		return nil
	}
	return c.client.WithChannel(func(ch *amqp.Channel) error {
		if _, err := mq.DeclareQueue(ch, c.queue, true); err != nil {
			return err
		}
		return mq.ServeRPCJSON(ctx, ch, c.queue, c.handle)
	})
}

func (c *AgentCommandsConsumer) handle(ctx context.Context, req AgentCommandRequest) (AgentCommandResponse, error) {
	claims, err := c.tokens.Parse(strings.TrimSpace(req.AccessToken), "access")
	if err != nil {
		return errorResponse(req.Command, "Unauthorized", http.StatusUnauthorized, "unauthorized", false), nil
	}
	actorUserID := strings.TrimSpace(claims.Subject)
	if actorUserID == "" {
		actorUserID = strings.TrimSpace(req.ActorUserID)
	}

	switch req.Command {
	case "list_task_columns":
		if response, ok := c.ensurePermission(ctx, req.Command, req.AccessToken, req.TeamID, req.ProjectID, "tasks.read"); ok {
			return response, nil
		}
		items, err := c.svc.ListColumnsByProject(req.ProjectID)
		if err != nil {
			return mapTaskError(req.Command, err), nil
		}
		return successResponse("Columns listed", map[string]any{"columns": items}), nil
	case "create_task_column":
		var payload struct {
			Title string `json:"title"`
		}
		if err := json.Unmarshal(req.Payload, &payload); err != nil {
			return errorResponse(req.Command, "invalid payload", http.StatusBadRequest, "invalid_payload", false), nil
		}
		if response, ok := c.ensurePermission(ctx, req.Command, req.AccessToken, req.TeamID, req.ProjectID, "tasks.write"); ok {
			return response, nil
		}
		item, err := c.svc.CreateColumn(service.CreateColumnInput{
			TeamID:    req.TeamID,
			ProjectID: req.ProjectID,
			Title:     payload.Title,
		})
		if err != nil {
			return mapTaskError(req.Command, err), nil
		}
		return successResponse("Column created", map[string]any{"column": item}), nil
	case "update_task_column":
		var payload struct {
			ColumnID string `json:"column_id"`
			Title    string `json:"title"`
		}
		if err := json.Unmarshal(req.Payload, &payload); err != nil {
			return errorResponse(req.Command, "invalid payload", http.StatusBadRequest, "invalid_payload", false), nil
		}
		column, err := c.svc.GetColumnByID(payload.ColumnID)
		if err != nil {
			return mapTaskError(req.Command, err), nil
		}
		if response, ok := c.ensurePermission(ctx, req.Command, req.AccessToken, column.TeamID, column.ProjectID, "tasks.write"); ok {
			return response, nil
		}
		updated, err := c.svc.UpdateColumn(payload.ColumnID, service.UpdateColumnInput{
			Title:            &payload.Title,
			SkipVersionCheck: true,
		})
		if err != nil {
			return mapTaskError(req.Command, err), nil
		}
		return successResponse("Column updated", map[string]any{"column": updated}), nil
	case "delete_task_column":
		var payload struct {
			ColumnID string `json:"column_id"`
		}
		if err := json.Unmarshal(req.Payload, &payload); err != nil {
			return errorResponse(req.Command, "invalid payload", http.StatusBadRequest, "invalid_payload", false), nil
		}
		column, err := c.svc.GetColumnByID(payload.ColumnID)
		if err != nil {
			return mapTaskError(req.Command, err), nil
		}
		if response, ok := c.ensurePermission(ctx, req.Command, req.AccessToken, column.TeamID, column.ProjectID, "tasks.write"); ok {
			return response, nil
		}
		if err := c.svc.DeleteColumn(payload.ColumnID, actorUserID); err != nil {
			return mapTaskError(req.Command, err), nil
		}
		return successResponse("Column deleted", map[string]any{}), nil
	case "list_tasks":
		var payload struct {
			Search string `json:"search"`
			Limit  int    `json:"limit"`
			Offset int    `json:"offset"`
		}
		_ = json.Unmarshal(req.Payload, &payload)
		if response, ok := c.ensurePermission(ctx, req.Command, req.AccessToken, req.TeamID, req.ProjectID, "tasks.read"); ok {
			return response, nil
		}
		items, _, err := c.svc.ListByProject(req.ProjectID, payload.Limit, payload.Offset, payload.Search)
		if err != nil {
			return mapTaskError(req.Command, err), nil
		}
		return successResponse("Tasks listed", map[string]any{"tasks": items}), nil
	case "get_task_details":
		var payload struct {
			TaskID string `json:"task_id"`
		}
		if err := json.Unmarshal(req.Payload, &payload); err != nil {
			return errorResponse(req.Command, "invalid payload", http.StatusBadRequest, "invalid_payload", false), nil
		}
		task, err := c.svc.GetByID(payload.TaskID)
		if err != nil {
			return mapTaskError(req.Command, err), nil
		}
		if response, ok := c.ensurePermission(ctx, req.Command, req.AccessToken, task.TeamID, task.ProjectID, "tasks.read"); ok {
			return response, nil
		}
		return successResponse("Task details loaded", map[string]any{"task": task}), nil
	case "create_task":
		var payload struct {
			Title          string     `json:"title"`
			Description    string     `json:"description"`
			Status         string     `json:"status"`
			Priority       string     `json:"priority"`
			DueAt          *time.Time `json:"dueAt"`
			AssigneeUserID string     `json:"assigneeUserId"`
			AssigneeName   string     `json:"assigneeName"`
		}
		if err := json.Unmarshal(req.Payload, &payload); err != nil {
			return errorResponse(req.Command, "invalid payload", http.StatusBadRequest, "invalid_payload", false), nil
		}
		if response, ok := c.ensurePermission(ctx, req.Command, req.AccessToken, req.TeamID, req.ProjectID, "tasks.write"); ok {
			return response, nil
		}
		task, err := c.svc.Create(service.CreateTaskInput{
			Title:          payload.Title,
			Description:    payload.Description,
			Status:         payload.Status,
			Priority:       payload.Priority,
			DueAt:          payload.DueAt,
			CreatedBy:      actorUserID,
			AssigneeUserID: payload.AssigneeUserID,
			AssigneeName:   payload.AssigneeName,
			TeamID:         req.TeamID,
			ProjectID:      req.ProjectID,
		})
		if err != nil {
			return mapTaskError(req.Command, err), nil
		}
		return successResponse("Task created", map[string]any{"task": task}), nil
	case "update_task":
		var payload struct {
			TaskID         string     `json:"task_id"`
			Title          *string    `json:"title"`
			Description    *string    `json:"description"`
			Status         *string    `json:"status"`
			Priority       *string    `json:"priority"`
			DueAt          *time.Time `json:"dueAt"`
			AssigneeUserID *string    `json:"assigneeUserId"`
			AssigneeName   *string    `json:"assigneeName"`
			Completed      *bool      `json:"completed"`
		}
		if err := json.Unmarshal(req.Payload, &payload); err != nil {
			return errorResponse(req.Command, "invalid payload", http.StatusBadRequest, "invalid_payload", false), nil
		}
		current, err := c.svc.GetByID(payload.TaskID)
		if err != nil {
			return mapTaskError(req.Command, err), nil
		}
		if response, ok := c.ensurePermission(ctx, req.Command, req.AccessToken, current.TeamID, current.ProjectID, "tasks.write"); ok {
			return response, nil
		}
		updated, err := c.svc.Update(payload.TaskID, service.UpdateTaskInput{
			Title:            payload.Title,
			Description:      payload.Description,
			Status:           payload.Status,
			Priority:         payload.Priority,
			DueAt:            payload.DueAt,
			AssigneeUserID:   payload.AssigneeUserID,
			AssigneeName:     payload.AssigneeName,
			Completed:        payload.Completed,
			ActorUserID:      actorUserID,
			SkipVersionCheck: true,
		})
		if err != nil {
			return mapTaskError(req.Command, err), nil
		}
		return successResponse("Task updated", map[string]any{"task": updated}), nil
	case "delete_task":
		var payload struct {
			TaskID string `json:"task_id"`
		}
		if err := json.Unmarshal(req.Payload, &payload); err != nil {
			return errorResponse(req.Command, "invalid payload", http.StatusBadRequest, "invalid_payload", false), nil
		}
		current, err := c.svc.GetByID(payload.TaskID)
		if err != nil {
			return mapTaskError(req.Command, err), nil
		}
		if response, ok := c.ensurePermission(ctx, req.Command, req.AccessToken, current.TeamID, current.ProjectID, "tasks.write"); ok {
			return response, nil
		}
		if err := c.svc.Delete(payload.TaskID, actorUserID); err != nil {
			return mapTaskError(req.Command, err), nil
		}
		return successResponse("Task deleted", map[string]any{}), nil
	default:
		return errorResponse(req.Command, "unknown command", http.StatusBadRequest, "unknown_command", false), nil
	}
}

func (c *AgentCommandsConsumer) ensurePermission(
	ctx context.Context,
	operation string,
	accessToken string,
	teamID string,
	projectID string,
	permission string,
) (AgentCommandResponse, bool) {
	allowed, err := c.permissions.CheckProjectPermission(ctx, accessToken, teamID, projectID, permission)
	if err != nil {
		return errorResponse(operation, "dependency unavailable", http.StatusBadGateway, "dependency_unavailable", true), true
	}
	if !allowed {
		return errorResponse(operation, "forbidden", http.StatusForbidden, "forbidden", false), true
	}
	return AgentCommandResponse{}, false
}

func successResponse(message string, data map[string]any) AgentCommandResponse {
	return AgentCommandResponse{
		Success: true,
		Message: message,
		Data:    data,
	}
}

func errorResponse(operation, message string, statusCode int, code string, retryable bool) AgentCommandResponse {
	return AgentCommandResponse{
		Success: false,
		Message: message,
		Error: &AgentCommandError{
			Service:    "task_service",
			Operation:  operation,
			Message:    message,
			StatusCode: statusCode,
			Code:       code,
			Retryable:  retryable,
		},
	}
}

func mapTaskError(operation string, err error) AgentCommandResponse {
	switch {
	case err == nil:
		return successResponse("ok", map[string]any{})
	case err == service.ErrBadRequest:
		return errorResponse(operation, "bad request", http.StatusBadRequest, "bad_request", false)
	case err == service.ErrForbidden:
		return errorResponse(operation, "forbidden", http.StatusForbidden, "forbidden", false)
	case err == service.ErrUpstream:
		return errorResponse(operation, "dependency unavailable", http.StatusBadGateway, "dependency_unavailable", true)
	case err == repository.ErrNotFound:
		return errorResponse(operation, "task not found", http.StatusNotFound, "not_found", false)
	default:
		return errorResponse(operation, err.Error(), http.StatusInternalServerError, "internal_error", true)
	}
}
