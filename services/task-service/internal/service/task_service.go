package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"UnifiedTaskManager/services/task-service/internal/event"
	"UnifiedTaskManager/services/task-service/internal/model"
	"UnifiedTaskManager/services/task-service/internal/repository"
)

var ErrBadRequest = errors.New("bad request")
var ErrForbidden = errors.New("forbidden")
var ErrUpstream = errors.New("upstream dependency failed")

type CreateTaskInput struct {
	Title       string
	Description string
	Status      string
	Priority    string
	DueAt       *time.Time
	CreatedBy   string
	TeamID      string
	ProjectID   string
}

type UpdateTaskInput struct {
	Title       *string    `json:"title"`
	Description *string    `json:"description"`
	Status      *string    `json:"status"`
	Priority    *string    `json:"priority"`
	DueAt       *time.Time `json:"dueAt"`
}

type CreateColumnInput struct {
	TeamID    string
	ProjectID string
	Title     string
}

type CreateCommentInput struct {
	TaskID     string
	UserID     string
	AuthorName string
	Body       string
}

type TaskService struct {
	repo      repository.TaskStore
	publisher event.TaskEventPublisher
}

func NewTaskService(repo repository.TaskStore, publisher event.TaskEventPublisher) *TaskService {
	return &TaskService{repo: repo, publisher: publisher}
}

func (s *TaskService) Create(input CreateTaskInput) (model.Task, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" {
		return model.Task{}, ErrBadRequest
	}
	teamID := strings.TrimSpace(input.TeamID)
	projectID := strings.TrimSpace(input.ProjectID)
	if teamID == "" || projectID == "" {
		return model.Task{}, ErrBadRequest
	}
	createdBy := strings.TrimSpace(input.CreatedBy)
	if createdBy == "" {
		createdBy = "anonymous"
	}

	now := time.Now().UTC()
	task := model.Task{
		ID:          newID(),
		Title:       title,
		Description: strings.TrimSpace(input.Description),
		Status:      normalizeStatus(input.Status),
		Priority:    normalizePriority(input.Priority),
		DueAt:       input.DueAt,
		CreatedBy:   createdBy,
		TeamID:      teamID,
		ProjectID:   projectID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	created, err := s.repo.Create(task)
	if err != nil {
		return model.Task{}, err
	}
	if s.publisher != nil {
		_ = s.publisher.PublishTaskCreated(context.Background(), created)
	}
	return created, nil
}

func (s *TaskService) GetByID(id string) (model.Task, error) {
	task, err := s.repo.GetByID(strings.TrimSpace(id))
	if err != nil {
		return model.Task{}, err
	}
	return task, nil
}

func (s *TaskService) ListByProject(projectID string, limit, offset int, search string) ([]model.Task, int, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, 0, ErrBadRequest
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.ListByProject(projectID, limit, offset, search)
}

func (s *TaskService) Update(id string, input UpdateTaskInput) (model.Task, error) {
	current, err := s.repo.GetByID(strings.TrimSpace(id))
	if err != nil {
		return model.Task{}, err
	}

	if input.Title != nil {
		title := strings.TrimSpace(*input.Title)
		if title == "" {
			return model.Task{}, ErrBadRequest
		}
		current.Title = title
	}
	if input.Description != nil {
		current.Description = strings.TrimSpace(*input.Description)
	}
	if input.Status != nil {
		current.Status = normalizeStatus(*input.Status)
	}
	if input.Priority != nil {
		current.Priority = normalizePriority(*input.Priority)
	}
	if input.DueAt != nil {
		current.DueAt = input.DueAt
	}
	current.UpdatedAt = time.Now().UTC()

	updated, err := s.repo.Update(current)
	if err != nil {
		return model.Task{}, err
	}
	if s.publisher != nil {
		_ = s.publisher.PublishTaskUpdated(context.Background(), updated)
	}
	return updated, nil
}

func (s *TaskService) Delete(id string) error {
	trimmedID := strings.TrimSpace(id)
	current, err := s.repo.GetByID(trimmedID)
	if err != nil {
		return err
	}
	if err := s.repo.Delete(trimmedID); err != nil {
		return err
	}
	if s.publisher != nil {
		_ = s.publisher.PublishTaskDeleted(context.Background(), current)
	}
	return nil
}

func (s *TaskService) ListComments(taskID string) ([]model.TaskComment, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil, ErrBadRequest
	}
	return s.repo.ListCommentsByTaskID(taskID)
}

func (s *TaskService) AddComment(input CreateCommentInput) (model.TaskComment, error) {
	taskID := strings.TrimSpace(input.TaskID)
	userID := strings.TrimSpace(input.UserID)
	body := strings.TrimSpace(input.Body)
	authorName := strings.TrimSpace(input.AuthorName)
	if taskID == "" || userID == "" || body == "" {
		return model.TaskComment{}, ErrBadRequest
	}
	if authorName == "" {
		authorName = "Anonymous"
	}
	if _, err := s.repo.GetByID(taskID); err != nil {
		return model.TaskComment{}, err
	}
	comment := model.TaskComment{
		ID:         newID(),
		TaskID:     taskID,
		UserID:     userID,
		AuthorName: authorName,
		Body:       body,
		CreatedAt:  time.Now().UTC(),
	}
	created, err := s.repo.CreateComment(comment)
	if err != nil {
		return model.TaskComment{}, err
	}
	if err := s.repo.MarkTaskCommentsRead(taskID, userID, created.CreatedAt); err != nil {
		return model.TaskComment{}, err
	}
	return created, nil
}

func (s *TaskService) MarkCommentsRead(taskID, userID string) error {
	taskID = strings.TrimSpace(taskID)
	userID = strings.TrimSpace(userID)
	if taskID == "" || userID == "" {
		return ErrBadRequest
	}
	return s.repo.MarkTaskCommentsRead(taskID, userID, time.Now().UTC())
}

func (s *TaskService) ListUnreadCommentCounts(taskIDs []string, userID string) (map[string]int, error) {
	if len(taskIDs) == 0 {
		return map[string]int{}, nil
	}
	return s.repo.ListUnreadCommentCounts(taskIDs, userID)
}

func (s *TaskService) CreateColumn(input CreateColumnInput) (model.TaskColumn, error) {
	teamID := strings.TrimSpace(input.TeamID)
	projectID := strings.TrimSpace(input.ProjectID)
	title := strings.TrimSpace(input.Title)
	if teamID == "" || projectID == "" || title == "" {
		return model.TaskColumn{}, ErrBadRequest
	}
	maxPosition, err := s.repo.GetMaxColumnPosition(projectID)
	if err != nil {
		return model.TaskColumn{}, err
	}

	now := time.Now().UTC()
	column := model.TaskColumn{
		ID:        newID(),
		TeamID:    teamID,
		ProjectID: projectID,
		Title:     title,
		Position:  maxPosition + 1,
		CreatedAt: now,
		UpdatedAt: now,
	}
	created, err := s.repo.CreateColumn(column)
	if err != nil {
		return model.TaskColumn{}, err
	}
	return created, nil
}

func (s *TaskService) ListColumnsByProject(projectID string) ([]model.TaskColumn, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, ErrBadRequest
	}
	return s.repo.ListColumnsByProject(projectID)
}

func (s *TaskService) GetColumnByID(id string) (model.TaskColumn, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return model.TaskColumn{}, ErrBadRequest
	}
	return s.repo.GetColumnByID(id)
}

func (s *TaskService) DeleteColumn(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return ErrBadRequest
	}
	column, err := s.repo.GetColumnByID(id)
	if err != nil {
		return err
	}
	count, err := s.repo.CountByProjectAndStatus(column.ProjectID, column.ID)
	if err != nil {
		return err
	}
	if count > 0 {
		return ErrBadRequest
	}
	return s.repo.DeleteColumn(id)
}

func (s *TaskService) ReorderColumns(projectID string, orderedIDs []string) error {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return ErrBadRequest
	}
	columns, err := s.repo.ListColumnsByProject(projectID)
	if err != nil {
		return err
	}
	if len(columns) == 0 {
		return nil
	}

	indexByID := make(map[string]int, len(columns))
	for index, item := range columns {
		indexByID[item.ID] = index
	}
	used := make(map[string]struct{}, len(orderedIDs))
	finalOrder := make([]string, 0, len(columns))
	for _, raw := range orderedIDs {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if _, ok := indexByID[id]; !ok {
			continue
		}
		if _, exists := used[id]; exists {
			continue
		}
		used[id] = struct{}{}
		finalOrder = append(finalOrder, id)
	}
	for _, column := range columns {
		if _, exists := used[column.ID]; exists {
			continue
		}
		finalOrder = append(finalOrder, column.ID)
	}
	for index, id := range finalOrder {
		if err := s.repo.UpdateColumnPosition(id, index); err != nil {
			return err
		}
	}
	return nil
}

func normalizeStatus(value string) model.TaskStatus {
	normalized := strings.TrimSpace(strings.ToLower(value))
	if normalized == "" {
		return model.TaskStatusTodo
	}
	return model.TaskStatus(normalized)
}

func normalizePriority(value string) model.TaskPriority {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case string(model.TaskPriorityLow):
		return model.TaskPriorityLow
	case string(model.TaskPriorityHigh):
		return model.TaskPriorityHigh
	default:
		return model.TaskPriorityMedium
	}
}
