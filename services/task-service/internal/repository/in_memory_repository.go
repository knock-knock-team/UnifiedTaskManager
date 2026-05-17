package repository

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"unified-task-manager/services/task-service/internal/model"
)

type TaskStore interface {
	Create(task model.Task) (model.Task, error)
	GetByID(id string) (model.Task, error)
	List(limit, offset int, search string) ([]model.Task, int, error)
	ListByOwner(ownerID string, limit, offset int, search string) ([]model.Task, int, error)
	ListByTeam(teamID string, limit, offset int, search string) ([]model.Task, int, error)
	ListByProject(projectID string, limit, offset int, search string) ([]model.Task, int, error)
	CreateColumn(column model.TaskColumn) (model.TaskColumn, error)
	GetColumnByID(id string) (model.TaskColumn, error)
	ListColumnsByProject(projectID string) ([]model.TaskColumn, error)
	GetMaxColumnPosition(projectID string) (int, error)
	UpdateColumn(column model.TaskColumn) (model.TaskColumn, error)
	UpdateColumnIfVersion(column model.TaskColumn, expectedVersion int64) (model.TaskColumn, error)
	UpdateColumnPosition(id string, position int) error
	DeleteColumn(id string) error
	CountByProjectAndStatus(projectID, status string) (int, error)
	MaxSortPosition(projectID, columnStatus string) (int, error)
	ReorderTasksInColumn(projectID, columnStatus string, orderedIDs []string) ([]model.Task, error)
	CreateActivityEvent(event model.ActivityEvent) (model.ActivityEvent, error)
	ListActivityEvents(projectID, entityType, entityID string, limit, offset int) ([]model.ActivityEvent, int, error)
	CreateComment(comment model.TaskComment) (model.TaskComment, error)
	ListCommentsByTaskID(taskID string) ([]model.TaskComment, error)
	GetCommentByID(commentID string) (model.TaskComment, error)
	DeleteComment(commentID string) error
	MarkTaskCommentsRead(taskID, userID string, readAt time.Time) error
	ListUnreadCommentCounts(taskIDs []string, userID string) (map[string]int, error)
	Update(task model.Task) (model.Task, error)
	UpdateIfVersion(task model.Task, expectedVersion int64) (model.Task, error)
	Delete(id string) error
	Ping(ctx context.Context) error
}

type InMemoryTaskRepository struct {
	mu           sync.RWMutex
	tasks        map[string]model.Task
	columns      map[string]model.TaskColumn
	activities   []model.ActivityEvent
	comments     map[string][]model.TaskComment
	commentReads map[string]map[string]time.Time
}

func NewInMemoryTaskRepository() *InMemoryTaskRepository {
	return &InMemoryTaskRepository{
		tasks:        make(map[string]model.Task),
		columns:      make(map[string]model.TaskColumn),
		activities:   make([]model.ActivityEvent, 0),
		comments:     make(map[string][]model.TaskComment),
		commentReads: make(map[string]map[string]time.Time),
	}
}

func (r *InMemoryTaskRepository) Create(task model.Task) (model.Task, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if task.Version <= 0 {
		task.Version = 1
	}
	r.tasks[task.ID] = task
	return task, nil
}

func (r *InMemoryTaskRepository) GetByID(id string) (model.Task, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	task, ok := r.tasks[id]
	if !ok {
		return model.Task{}, ErrNotFound
	}
	return task, nil
}

func (r *InMemoryTaskRepository) List(limit, offset int, search string) ([]model.Task, int, error) {
	return r.listInternal("", "", "", limit, offset, search)
}

func (r *InMemoryTaskRepository) ListByOwner(ownerID string, limit, offset int, search string) ([]model.Task, int, error) {
	return r.listInternal(strings.TrimSpace(ownerID), "", "", limit, offset, search)
}

func (r *InMemoryTaskRepository) ListByTeam(teamID string, limit, offset int, search string) ([]model.Task, int, error) {
	return r.listInternal("", strings.TrimSpace(teamID), "", limit, offset, search)
}

func (r *InMemoryTaskRepository) ListByProject(projectID string, limit, offset int, search string) ([]model.Task, int, error) {
	return r.listInternal("", "", strings.TrimSpace(projectID), limit, offset, search)
}

func (r *InMemoryTaskRepository) listInternal(ownerID, teamID, projectID string, limit, offset int, search string) ([]model.Task, int, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]model.Task, 0, len(r.tasks))
	needle := strings.ToLower(strings.TrimSpace(search))
	for _, item := range r.tasks {
		if ownerID != "" && item.CreatedBy != ownerID {
			continue
		}
		if teamID != "" && item.TeamID != teamID {
			continue
		}
		if projectID != "" && item.ProjectID != projectID {
			continue
		}
		if needle != "" {
			candidate := strings.ToLower(item.Title + " " + item.Description)
			if !strings.Contains(candidate, needle) {
				continue
			}
		}
		items = append(items, item)
	}

	sort.Slice(items, func(i, j int) bool {
		if projectID != "" {
			si := items[i].SortPosition
			sj := items[j].SortPosition
			if si != sj {
				return si < sj
			}
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})

	total := len(items)
	if offset >= total {
		return []model.Task{}, total, nil
	}

	end := offset + limit
	if end > total {
		end = total
	}

	return items[offset:end], total, nil
}

func (r *InMemoryTaskRepository) Update(task model.Task) (model.Task, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	existing, ok := r.tasks[task.ID]
	if !ok {
		return model.Task{}, ErrNotFound
	}
	task.Version = existing.Version + 1
	r.tasks[task.ID] = task
	return task, nil
}

func (r *InMemoryTaskRepository) UpdateIfVersion(task model.Task, expectedVersion int64) (model.Task, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	existing, ok := r.tasks[task.ID]
	if !ok {
		return model.Task{}, ErrNotFound
	}
	if existing.Version != expectedVersion {
		return model.Task{}, ErrVersionConflict
	}
	task.Version = existing.Version + 1
	r.tasks[task.ID] = task
	return task, nil
}

func (r *InMemoryTaskRepository) CreateColumn(column model.TaskColumn) (model.TaskColumn, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if column.Version <= 0 {
		column.Version = 1
	}
	r.columns[column.ID] = column
	return column, nil
}

func (r *InMemoryTaskRepository) GetColumnByID(id string) (model.TaskColumn, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	column, ok := r.columns[id]
	if !ok {
		return model.TaskColumn{}, ErrNotFound
	}
	return column, nil
}

func (r *InMemoryTaskRepository) ListColumnsByProject(projectID string) ([]model.TaskColumn, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	projectID = strings.TrimSpace(projectID)
	items := make([]model.TaskColumn, 0)
	for _, item := range r.columns {
		if item.ProjectID == projectID {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position == items[j].Position {
			return items[i].CreatedAt.Before(items[j].CreatedAt)
		}
		return items[i].Position < items[j].Position
	})
	return items, nil
}

func (r *InMemoryTaskRepository) GetMaxColumnPosition(projectID string) (int, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	projectID = strings.TrimSpace(projectID)
	max := -1
	for _, item := range r.columns {
		if item.ProjectID == projectID && item.Position > max {
			max = item.Position
		}
	}
	return max, nil
}

func (r *InMemoryTaskRepository) UpdateColumn(column model.TaskColumn) (model.TaskColumn, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	existing, ok := r.columns[column.ID]
	if !ok {
		return model.TaskColumn{}, ErrNotFound
	}
	column.Version = existing.Version + 1
	r.columns[column.ID] = column
	return column, nil
}

func (r *InMemoryTaskRepository) UpdateColumnIfVersion(column model.TaskColumn, expectedVersion int64) (model.TaskColumn, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	existing, ok := r.columns[column.ID]
	if !ok {
		return model.TaskColumn{}, ErrNotFound
	}
	if existing.Version != expectedVersion {
		return model.TaskColumn{}, ErrVersionConflict
	}
	column.Version = existing.Version + 1
	r.columns[column.ID] = column
	return column, nil
}

func (r *InMemoryTaskRepository) UpdateColumnPosition(id string, position int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.columns[id]
	if !ok {
		return ErrNotFound
	}
	item.Position = position
	item.UpdatedAt = time.Now().UTC()
	item.Version++
	r.columns[id] = item
	return nil
}

func (r *InMemoryTaskRepository) DeleteColumn(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.columns[id]; !ok {
		return ErrNotFound
	}
	delete(r.columns, id)
	return nil
}

func (r *InMemoryTaskRepository) CountByProjectAndStatus(projectID, status string) (int, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	projectID = strings.TrimSpace(projectID)
	status = strings.TrimSpace(status)
	count := 0
	for _, task := range r.tasks {
		if task.ProjectID == projectID && string(task.Status) == status {
			count++
		}
	}
	return count, nil
}

func (r *InMemoryTaskRepository) MaxSortPosition(projectID, columnStatus string) (int, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	projectID = strings.TrimSpace(projectID)
	columnStatus = strings.TrimSpace(columnStatus)
	if projectID == "" || columnStatus == "" {
		return -1, nil
	}
	max := -1
	for _, task := range r.tasks {
		if task.ProjectID == projectID && string(task.Status) == columnStatus {
			if task.SortPosition > max {
				max = task.SortPosition
			}
		}
	}
	return max, nil
}

func (r *InMemoryTaskRepository) ReorderTasksInColumn(projectID, columnStatus string, orderedIDs []string) ([]model.Task, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	projectID = strings.TrimSpace(projectID)
	columnStatus = strings.TrimSpace(columnStatus)
	if projectID == "" || columnStatus == "" || len(orderedIDs) == 0 {
		return nil, ErrInvalidReorder
	}
	cleaned := make([]string, 0, len(orderedIDs))
	seen := make(map[string]struct{}, len(orderedIDs))
	for _, raw := range orderedIDs {
		id := strings.TrimSpace(raw)
		if id == "" {
			return nil, ErrInvalidReorder
		}
		if _, ok := seen[id]; ok {
			return nil, ErrInvalidReorder
		}
		seen[id] = struct{}{}
		cleaned = append(cleaned, id)
	}

	current := make([]string, 0)
	for _, t := range r.tasks {
		if t.ProjectID != projectID || string(t.Status) != columnStatus {
			continue
		}
		current = append(current, t.ID)
	}
	sort.Slice(current, func(i, j int) bool {
		ti := r.tasks[current[i]]
		tj := r.tasks[current[j]]
		if ti.SortPosition != tj.SortPosition {
			return ti.SortPosition < tj.SortPosition
		}
		return ti.CreatedAt.After(tj.CreatedAt)
	})

	if len(current) != len(cleaned) {
		return nil, ErrInvalidReorder
	}
	curSet := make(map[string]struct{}, len(current))
	for _, id := range current {
		curSet[id] = struct{}{}
	}
	for _, id := range cleaned {
		if _, ok := curSet[id]; !ok {
			return nil, ErrInvalidReorder
		}
	}

	now := time.Now().UTC()
	out := make([]model.Task, 0, len(cleaned))
	for i, id := range cleaned {
		t, ok := r.tasks[id]
		if !ok {
			return nil, ErrInvalidReorder
		}
		t.SortPosition = i
		t.UpdatedAt = now
		t.Version++
		r.tasks[id] = t
		out = append(out, t)
	}
	return out, nil
}

func (r *InMemoryTaskRepository) CreateActivityEvent(event model.ActivityEvent) (model.ActivityEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.activities = append(r.activities, event)
	return event, nil
}

func (r *InMemoryTaskRepository) ListActivityEvents(projectID, entityType, entityID string, limit, offset int) ([]model.ActivityEvent, int, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	projectID = strings.TrimSpace(projectID)
	entityType = strings.TrimSpace(entityType)
	entityID = strings.TrimSpace(entityID)
	items := make([]model.ActivityEvent, 0, len(r.activities))
	for _, item := range r.activities {
		if projectID != "" && item.ProjectID != projectID {
			continue
		}
		if entityType != "" && item.EntityType != entityType {
			continue
		}
		if entityID != "" && item.EntityID != entityID {
			continue
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	total := len(items)
	if offset >= total {
		return []model.ActivityEvent{}, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return append([]model.ActivityEvent(nil), items[offset:end]...), total, nil
}

func (r *InMemoryTaskRepository) CreateComment(comment model.TaskComment) (model.TaskComment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.tasks[comment.TaskID]; !ok {
		return model.TaskComment{}, ErrNotFound
	}
	r.comments[comment.TaskID] = append(r.comments[comment.TaskID], comment)
	return comment, nil
}

func (r *InMemoryTaskRepository) ListCommentsByTaskID(taskID string) ([]model.TaskComment, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := append([]model.TaskComment(nil), r.comments[strings.TrimSpace(taskID)]...)
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt.Before(items[j].CreatedAt)
	})
	return items, nil
}

func (r *InMemoryTaskRepository) GetCommentByID(commentID string) (model.TaskComment, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	commentID = strings.TrimSpace(commentID)
	for _, items := range r.comments {
		for _, item := range items {
			if item.ID == commentID {
				return item, nil
			}
		}
	}
	return model.TaskComment{}, ErrNotFound
}

func (r *InMemoryTaskRepository) DeleteComment(commentID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	commentID = strings.TrimSpace(commentID)
	for taskID, items := range r.comments {
		for index := range items {
			if items[index].ID != commentID {
				continue
			}
			r.comments[taskID] = append(items[:index], items[index+1:]...)
			return nil
		}
	}
	return ErrNotFound
}

func (r *InMemoryTaskRepository) MarkTaskCommentsRead(taskID, userID string, readAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	taskID = strings.TrimSpace(taskID)
	userID = strings.TrimSpace(userID)
	if taskID == "" || userID == "" {
		return ErrNotFound
	}
	if _, ok := r.commentReads[taskID]; !ok {
		r.commentReads[taskID] = make(map[string]time.Time)
	}
	r.commentReads[taskID][userID] = readAt
	return nil
}

func (r *InMemoryTaskRepository) ListUnreadCommentCounts(taskIDs []string, userID string) (map[string]int, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make(map[string]int, len(taskIDs))
	userID = strings.TrimSpace(userID)
	for _, rawTaskID := range taskIDs {
		taskID := strings.TrimSpace(rawTaskID)
		if taskID == "" {
			continue
		}
		var readAt time.Time
		if reads := r.commentReads[taskID]; reads != nil {
			readAt = reads[userID]
		}
		count := 0
		for _, comment := range r.comments[taskID] {
			if comment.UserID == userID {
				continue
			}
			if !readAt.IsZero() && !comment.CreatedAt.After(readAt) {
				continue
			}
			if readAt.IsZero() && !comment.CreatedAt.IsZero() {
				count++
				continue
			}
			count++
		}
		if count > 0 {
			result[taskID] = count
		}
	}
	return result, nil
}

func (r *InMemoryTaskRepository) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.tasks[id]; !ok {
		return ErrNotFound
	}
	delete(r.tasks, id)
	return nil
}

func (r *InMemoryTaskRepository) Ping(_ context.Context) error {
	return nil
}
