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
	Title          string
	Description    string
	Status         string
	Priority       string
	DueAt          *time.Time
	CreatedBy      string
	Assignees      []model.TaskAssignee
	Tags           []string
	AssigneeUserID string // legacy: used when Assignees is empty
	AssigneeName   string
	TeamID         string
	ProjectID      string
}

type UpdateTaskInput struct {
	Title            *string    `json:"title"`
	Description      *string    `json:"description"`
	Status           *string    `json:"status"`
	Priority         *string    `json:"priority"`
	DueAt            *time.Time `json:"dueAt"`
	Assignees        *[]model.TaskAssignee `json:"assignees"`
	Tags             *[]string  `json:"tags"`
	AssigneeUserID   *string    `json:"assigneeUserId"`
	AssigneeName     *string    `json:"assigneeName"`
	Completed        *bool      `json:"completed"`
	ActorUserID      string
	ExpectedVersion  *int64
	SkipVersionCheck bool
}

type CreateColumnInput struct {
	TeamID    string
	ProjectID string
	Title     string
}

type UpdateColumnInput struct {
	Title           *string `json:"title"`
	ExpectedVersion *int64
	SkipVersionCheck bool
}

type CreateCommentInput struct {
	TaskID     string
	UserID     string
	AuthorName string
	Body       string
}

type TaskService struct {
	repo          repository.TaskStore
	publisher     event.TaskEventPublisher
	userDirectory UserDirectory
	board         BoardNotifier
}

func NewTaskService(repo repository.TaskStore, publisher event.TaskEventPublisher, userDirectory UserDirectory) *TaskService {
	if userDirectory == nil {
		userDirectory = NewNoopUserDirectory()
	}
	return &TaskService{repo: repo, publisher: publisher, userDirectory: userDirectory}
}

func (s *TaskService) SetBoardNotifier(board BoardNotifier) {
	s.board = board
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

	assignees, err := s.resolveAssignees(input.Assignees, input.AssigneeUserID, input.AssigneeName)
	if err != nil {
		return model.Task{}, err
	}

	now := time.Now().UTC()
	task := model.Task{
		ID:             newID(),
		Title:          title,
		Description:    strings.TrimSpace(input.Description),
		Status:         normalizeStatus(input.Status),
		Priority:       normalizePriority(input.Priority),
		DueAt:          input.DueAt,
		CreatedBy:      createdBy,
		Assignees:      assignees,
		Tags:           normalizeTaskTags(input.Tags),
		TeamID:         teamID,
		ProjectID:      projectID,
		CreatedAt:      now,
		UpdatedAt:      now,
		Version:        1,
	}
	task.SyncPrimaryAssigneeFromAssignees()
	if task.Status == model.TaskStatusDone {
		task.CompletedAt = &now
		task.CompletedBy = createdBy
	}
	maxPos, err := s.repo.MaxSortPosition(projectID, string(task.Status))
	if err != nil {
		return model.Task{}, err
	}
	task.SortPosition = maxPos + 1
	created, err := s.repo.Create(task)
	if err != nil {
		return model.Task{}, err
	}
	if s.publisher != nil {
		_ = s.publisher.PublishTaskCreated(context.Background(), created)
	}
	if s.board != nil {
		s.board.TaskCreated(createdBy, created)
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

func (s *TaskService) ReorderTasksInColumn(projectID, actorID, columnStatus string, orderedIDs []string) ([]model.Task, error) {
	projectID = strings.TrimSpace(projectID)
	columnStatus = strings.TrimSpace(columnStatus)
	if projectID == "" || columnStatus == "" || len(orderedIDs) == 0 {
		return nil, ErrBadRequest
	}
	tasks, err := s.repo.ReorderTasksInColumn(projectID, columnStatus, orderedIDs)
	if err != nil {
		if errors.Is(err, repository.ErrInvalidReorder) {
			return nil, ErrBadRequest
		}
		return nil, err
	}
	if s.board != nil && len(tasks) > 0 {
		tm := strings.TrimSpace(tasks[0].TeamID)
		s.board.TasksReordered(strings.TrimSpace(actorID), tm, projectID, tasks)
	}
	return tasks, nil
}

func (s *TaskService) Update(id string, input UpdateTaskInput) (model.Task, error) {
	current, err := s.repo.GetByID(strings.TrimSpace(id))
	if err != nil {
		return model.Task{}, err
	}

	completionExplicitlyUpdated := false

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
		nextStatus := normalizeStatus(*input.Status)
		if nextStatus != current.Status {
			maxPos, err := s.repo.MaxSortPosition(strings.TrimSpace(current.ProjectID), string(nextStatus))
			if err != nil {
				return model.Task{}, err
			}
			current.SortPosition = maxPos + 1
		}
		current.Status = nextStatus
		if current.Status == model.TaskStatusDone && current.CompletedAt == nil {
			now := time.Now().UTC()
			current.CompletedAt = &now
			current.CompletedBy = strings.TrimSpace(input.ActorUserID)
			completionExplicitlyUpdated = true
		}
	}
	if input.Priority != nil {
		current.Priority = normalizePriority(*input.Priority)
	}
	if input.DueAt != nil {
		current.DueAt = input.DueAt
	}

	legacyName := ""
	if input.AssigneeName != nil {
		legacyName = strings.TrimSpace(*input.AssigneeName)
	}
	if input.Assignees != nil {
		list, err := s.resolveAssignees(*input.Assignees, "", "")
		if err != nil {
			return model.Task{}, err
		}
		current.Assignees = list
		current.SyncPrimaryAssigneeFromAssignees()
	} else if input.AssigneeUserID != nil {
		assigneeUserID := strings.TrimSpace(*input.AssigneeUserID)
		list, err := s.resolveAssignees(nil, assigneeUserID, legacyName)
		if err != nil {
			return model.Task{}, err
		}
		current.Assignees = list
		current.SyncPrimaryAssigneeFromAssignees()
	}

	if input.Tags != nil {
		current.Tags = normalizeTaskTags(*input.Tags)
	}
	if input.Completed != nil {
		completionExplicitlyUpdated = true
		if *input.Completed {
			if current.CompletedAt == nil {
				now := time.Now().UTC()
				current.CompletedAt = &now
			}
			current.CompletedBy = strings.TrimSpace(input.ActorUserID)
		} else {
			current.CompletedAt = nil
			current.CompletedBy = ""
		}
	}
	if !completionExplicitlyUpdated && current.CompletedAt == nil && current.Status == model.TaskStatusDone {
		now := time.Now().UTC()
		current.CompletedAt = &now
		current.CompletedBy = strings.TrimSpace(input.ActorUserID)
	}
	current.UpdatedAt = time.Now().UTC()

	var updated model.Task
	var updateErr error
	switch {
	case input.SkipVersionCheck || input.ExpectedVersion == nil:
		updated, updateErr = s.repo.Update(current)
	default:
		updated, updateErr = s.repo.UpdateIfVersion(current, *input.ExpectedVersion)
	}
	if errors.Is(updateErr, repository.ErrVersionConflict) {
		latest, getErr := s.repo.GetByID(strings.TrimSpace(id))
		if getErr != nil {
			return model.Task{}, getErr
		}
		return model.Task{}, NewTaskVersionConflict(latest)
	}
	if updateErr != nil {
		return model.Task{}, updateErr
	}
	if s.publisher != nil {
		_ = s.publisher.PublishTaskUpdated(context.Background(), updated)
	}
	if s.board != nil {
		s.board.TaskUpdated(strings.TrimSpace(input.ActorUserID), updated)
	}
	return updated, nil
}

func (s *TaskService) Delete(id, actorID string) error {
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
	if s.board != nil {
		s.board.TaskDeleted(strings.TrimSpace(actorID), current.TeamID, current.ProjectID, current.ID)
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
	if s.board != nil {
		if task, err := s.repo.GetByID(taskID); err == nil {
			s.board.CommentAdded(userID, task, created)
		}
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

func (s *TaskService) DeleteComment(taskID, commentID, userID string) error {
	taskID = strings.TrimSpace(taskID)
	commentID = strings.TrimSpace(commentID)
	userID = strings.TrimSpace(userID)
	if taskID == "" || commentID == "" || userID == "" {
		return ErrBadRequest
	}
	comment, err := s.repo.GetCommentByID(commentID)
	if err != nil {
		return err
	}
	if comment.TaskID != taskID {
		return ErrBadRequest
	}
	if comment.UserID != userID {
		return ErrForbidden
	}
	return s.repo.DeleteComment(commentID)
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
		Version:   1,
	}
	created, err := s.repo.CreateColumn(column)
	if err != nil {
		return model.TaskColumn{}, err
	}
	if s.board != nil {
		s.board.ColumnCreated("", created)
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

func (s *TaskService) DeleteColumn(id, actorID string) error {
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
	if err := s.repo.DeleteColumn(id); err != nil {
		return err
	}
	if s.board != nil {
		s.board.ColumnDeleted(strings.TrimSpace(actorID), column.TeamID, column.ProjectID, column.ID)
	}
	return nil
}

func (s *TaskService) UpdateColumn(id string, input UpdateColumnInput) (model.TaskColumn, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return model.TaskColumn{}, ErrBadRequest
	}
	current, err := s.repo.GetColumnByID(id)
	if err != nil {
		return model.TaskColumn{}, err
	}
	if input.Title != nil {
		title := strings.TrimSpace(*input.Title)
		if title == "" {
			return model.TaskColumn{}, ErrBadRequest
		}
		current.Title = title
	}
	current.UpdatedAt = time.Now().UTC()

	var updated model.TaskColumn
	var updateErr error
	switch {
	case input.SkipVersionCheck || input.ExpectedVersion == nil:
		updated, updateErr = s.repo.UpdateColumn(current)
	default:
		updated, updateErr = s.repo.UpdateColumnIfVersion(current, *input.ExpectedVersion)
	}
	if errors.Is(updateErr, repository.ErrVersionConflict) {
		latest, getErr := s.repo.GetColumnByID(id)
		if getErr != nil {
			return model.TaskColumn{}, getErr
		}
		return model.TaskColumn{}, NewColumnVersionConflict(latest)
	}
	if updateErr != nil {
		return model.TaskColumn{}, updateErr
	}
	if s.board != nil {
		s.board.ColumnUpdated("", updated)
	}
	return updated, nil
}

func (s *TaskService) ReorderColumns(projectID, actorID string, orderedIDs []string, expectedVersions map[string]int64) error {
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
	if len(expectedVersions) > 0 {
		for _, column := range columns {
			expected, ok := expectedVersions[column.ID]
			if !ok {
				continue
			}
			if column.Version != expected {
				return &VersionConflictError{EntityType: "columns", Current: columns}
			}
		}
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
	if s.board != nil {
		items, err := s.repo.ListColumnsByProject(projectID)
		if err == nil && len(items) > 0 {
			teamID := items[0].TeamID
			s.board.ColumnsReordered(strings.TrimSpace(actorID), teamID, projectID, items)
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

func normalizeTaskTags(in []string) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0, len(in))
	for _, raw := range in {
		t := strings.TrimSpace(raw)
		if t == "" {
			continue
		}
		key := strings.ToLower(t)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, t)
		if len(out) >= 24 {
			break
		}
	}
	return out
}

// resolveAssignees normalizes assignee list. When explicit is empty, legacy single assignee is applied.
func (s *TaskService) resolveAssignees(explicit []model.TaskAssignee, legacyUserID, legacyName string) ([]model.TaskAssignee, error) {
	if len(explicit) == 0 {
		id := strings.TrimSpace(legacyUserID)
		if id == "" {
			return nil, nil
		}
		ok, err := s.userDirectory.UserExists(context.Background(), id)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, ErrBadRequest
		}
		name := strings.TrimSpace(legacyName)
		return []model.TaskAssignee{{UserID: id, DisplayName: name}}, nil
	}
	seen := make(map[string]struct{})
	out := make([]model.TaskAssignee, 0, len(explicit))
	for _, a := range explicit {
		id := strings.TrimSpace(a.UserID)
		if id == "" {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		ok, err := s.userDirectory.UserExists(context.Background(), id)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, ErrBadRequest
		}
		out = append(out, model.TaskAssignee{UserID: id, DisplayName: strings.TrimSpace(a.DisplayName)})
	}
	return out, nil
}
