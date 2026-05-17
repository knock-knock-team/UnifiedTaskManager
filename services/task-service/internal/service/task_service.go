package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"unified-task-manager/services/task-service/internal/event"
	"unified-task-manager/services/task-service/internal/model"
	"unified-task-manager/services/task-service/internal/repository"
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
	Title            *string               `json:"title"`
	Description      *string               `json:"description"`
	Status           *string               `json:"status"`
	Priority         *string               `json:"priority"`
	DueAt            *time.Time            `json:"dueAt"`
	Assignees        *[]model.TaskAssignee `json:"assignees"`
	Tags             *[]string             `json:"tags"`
	AssigneeUserID   *string               `json:"assigneeUserId"`
	AssigneeName     *string               `json:"assigneeName"`
	Completed        *bool                 `json:"completed"`
	ActorUserID      string
	ExpectedVersion  *int64
	SkipVersionCheck bool
}

type CreateColumnInput struct {
	TeamID      string
	ProjectID   string
	Title       string
	ActorUserID string
}

type UpdateColumnInput struct {
	Title            *string `json:"title"`
	ActorUserID      string
	ExpectedVersion  *int64
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
		ID:          newID(),
		Title:       title,
		Description: strings.TrimSpace(input.Description),
		Status:      normalizeStatus(input.Status),
		Priority:    normalizePriority(input.Priority),
		DueAt:       input.DueAt,
		CreatedBy:   createdBy,
		Assignees:   assignees,
		Tags:        normalizeTaskTags(input.Tags),
		TeamID:      teamID,
		ProjectID:   projectID,
		CreatedAt:   now,
		UpdatedAt:   now,
		Version:     1,
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
	s.recordActivity("task.created", created.TeamID, created.ProjectID, createdBy, "task", created.ID, "Создана задача", map[string]any{
		"title":          created.Title,
		"status":         created.Status,
		"priority":       created.Priority,
		"assignee_count": len(created.Assignees),
		"tag_count":      len(created.Tags),
	})
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

func (s *TaskService) ListActivityByProject(projectID string, limit, offset int) ([]model.ActivityEvent, int, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, 0, ErrBadRequest
	}
	return s.listActivity(projectID, "", "", limit, offset)
}

func (s *TaskService) ListTaskHistory(taskID string, limit, offset int) ([]model.ActivityEvent, int, error) {
	task, err := s.repo.GetByID(strings.TrimSpace(taskID))
	if err != nil {
		return nil, 0, err
	}
	return s.listActivity(task.ProjectID, "task", task.ID, limit, offset)
}

func (s *TaskService) listActivity(projectID, entityType, entityID string, limit, offset int) ([]model.ActivityEvent, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.ListActivityEvents(projectID, entityType, entityID, limit, offset)
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
	if len(tasks) > 0 {
		s.recordActivity("tasks.reordered", tasks[0].TeamID, projectID, strings.TrimSpace(actorID), "column", columnStatus, "Изменён порядок задач", map[string]any{
			"status":     columnStatus,
			"task_count": len(tasks),
		})
	}
	return tasks, nil
}

func (s *TaskService) Update(id string, input UpdateTaskInput) (model.Task, error) {
	current, err := s.repo.GetByID(strings.TrimSpace(id))
	if err != nil {
		return model.Task{}, err
	}
	before := current

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
	s.recordTaskUpdateActivity(before, updated, strings.TrimSpace(input.ActorUserID))
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
	s.recordActivity("task.deleted", current.TeamID, current.ProjectID, strings.TrimSpace(actorID), "task", current.ID, "Удалена задача", map[string]any{
		"title":  current.Title,
		"status": current.Status,
	})
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
	task, err := s.repo.GetByID(taskID)
	if err != nil {
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
		s.board.CommentAdded(userID, task, created)
	}
	s.recordActivity("task.comment.created", task.TeamID, task.ProjectID, userID, "task", task.ID, "Добавлен комментарий", map[string]any{
		"comment_id": created.ID,
	})
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
	task, err := s.repo.GetByID(taskID)
	if err != nil {
		return err
	}
	if err := s.repo.DeleteComment(commentID); err != nil {
		return err
	}
	s.recordActivity("task.comment.deleted", task.TeamID, task.ProjectID, userID, "task", task.ID, "Удалён комментарий", map[string]any{
		"comment_id": commentID,
	})
	return nil
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
		s.board.ColumnCreated(strings.TrimSpace(input.ActorUserID), created)
	}
	s.recordActivity("column.created", created.TeamID, created.ProjectID, strings.TrimSpace(input.ActorUserID), "column", created.ID, "Создана колонка", map[string]any{
		"title": created.Title,
	})
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
	s.recordActivity("column.deleted", column.TeamID, column.ProjectID, strings.TrimSpace(actorID), "column", column.ID, "Удалена колонка", map[string]any{
		"title": column.Title,
	})
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
		s.board.ColumnUpdated(strings.TrimSpace(input.ActorUserID), updated)
	}
	s.recordActivity("column.updated", updated.TeamID, updated.ProjectID, strings.TrimSpace(input.ActorUserID), "column", updated.ID, "Изменена колонка", map[string]any{
		"title": updated.Title,
	})
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
	teamID := ""
	if len(columns) > 0 {
		teamID = columns[0].TeamID
	}
	s.recordActivity("columns.reordered", teamID, projectID, strings.TrimSpace(actorID), "project", projectID, "Изменён порядок колонок", map[string]any{
		"column_count": len(finalOrder),
	})
	return nil
}

func (s *TaskService) recordActivity(eventType, teamID, projectID, actorID, entityType, entityID, summary string, metadata map[string]any) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return
	}
	event := model.ActivityEvent{
		ID:          newID(),
		TeamID:      strings.TrimSpace(teamID),
		ProjectID:   projectID,
		ActorUserID: strings.TrimSpace(actorID),
		EntityType:  strings.TrimSpace(entityType),
		EntityID:    strings.TrimSpace(entityID),
		EventType:   strings.TrimSpace(eventType),
		Summary:     strings.TrimSpace(summary),
		Metadata:    metadata,
		CreatedAt:   time.Now().UTC(),
	}
	if event.Metadata == nil {
		event.Metadata = map[string]any{}
	}
	_, _ = s.repo.CreateActivityEvent(event)
}

func (s *TaskService) recordTaskUpdateActivity(before, after model.Task, actorID string) {
	changes := make(map[string]any)
	addChange := func(field string, from any, to any) {
		changes[field] = map[string]any{"from": from, "to": to}
	}
	if before.Title != after.Title {
		addChange("title", before.Title, after.Title)
	}
	if before.Description != after.Description {
		addChange("description", before.Description, after.Description)
	}
	if before.Status != after.Status {
		addChange("status", before.Status, after.Status)
	}
	if before.Priority != after.Priority {
		addChange("priority", before.Priority, after.Priority)
	}
	if !timePtrEqual(before.DueAt, after.DueAt) {
		addChange("dueAt", before.DueAt, after.DueAt)
	}
	if !assigneesEqual(before.Assignees, after.Assignees) {
		addChange("assignees", before.Assignees, after.Assignees)
	}
	if !stringSlicesEqual(before.Tags, after.Tags) {
		addChange("tags", before.Tags, after.Tags)
	}
	if !timePtrEqual(before.CompletedAt, after.CompletedAt) {
		addChange("completed", before.CompletedAt != nil, after.CompletedAt != nil)
	}
	if len(changes) == 0 {
		return
	}
	summary := "Изменена задача"
	if _, ok := changes["status"]; ok {
		summary = "Изменён статус задачи"
	}
	if _, ok := changes["completed"]; ok && after.CompletedAt != nil {
		summary = "Задача завершена"
	}
	if _, ok := changes["completed"]; ok && after.CompletedAt == nil {
		summary = "Задача снова открыта"
	}
	s.recordActivity("task.updated", after.TeamID, after.ProjectID, actorID, "task", after.ID, summary, map[string]any{
		"title":   after.Title,
		"changes": changes,
	})
}

func timePtrEqual(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

func assigneesEqual(a, b []model.TaskAssignee) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func stringSlicesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
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
