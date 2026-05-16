package model

import (
	"strings"
	"time"
)

// TaskAssignee is one person responsible for the task (multi-assignee supported).
type TaskAssignee struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName,omitempty"`
}

type TaskStatus string

type TaskPriority string

const (
	TaskStatusTodo       TaskStatus = "todo"
	TaskStatusInProgress TaskStatus = "in_progress"
	TaskStatusDone       TaskStatus = "done"
)

const (
	TaskPriorityLow    TaskPriority = "low"
	TaskPriorityMedium TaskPriority = "medium"
	TaskPriorityHigh   TaskPriority = "high"
)

type Task struct {
	ID             string       `json:"id"`
	Title          string       `json:"title"`
	Description    string       `json:"description,omitempty"`
	Status         TaskStatus   `json:"status"`
	Priority       TaskPriority `json:"priority"`
	DueAt          *time.Time   `json:"dueAt,omitempty"`
	CompletedAt    *time.Time   `json:"completedAt,omitempty"`
	CompletedBy    string       `json:"completedBy,omitempty"`
	CreatedBy      string       `json:"createdBy"`
	Assignees      []TaskAssignee `json:"assignees,omitempty"`
	Tags           []string       `json:"tags,omitempty"`
	AssigneeUserID string         `json:"assigneeUserId,omitempty"`
	AssigneeName   string         `json:"assigneeName,omitempty"`
	TeamID         string       `json:"teamId,omitempty"`
	ProjectID      string       `json:"projectId,omitempty"`
	SortPosition   int          `json:"sortPosition"`
	UnreadComments int          `json:"unreadComments,omitempty"`
	Version        int64        `json:"version"`
	CreatedAt      time.Time    `json:"createdAt"`
	UpdatedAt      time.Time    `json:"updatedAt"`
}

// HydrateAssignees fills assignees slice from legacy single-assignee columns when JSON is empty.
func (t *Task) HydrateAssigneesFromLegacy() {
	if t == nil {
		return
	}
	if len(t.Assignees) > 0 {
		return
	}
	id := strings.TrimSpace(t.AssigneeUserID)
	if id == "" {
		return
	}
	name := strings.TrimSpace(t.AssigneeName)
	t.Assignees = []TaskAssignee{{UserID: id, DisplayName: name}}
}

// SyncPrimaryAssignee updates legacy assignee_* from the first entry in Assignees for notification consumers.
func (t *Task) SyncPrimaryAssigneeFromAssignees() {
	if t == nil {
		return
	}
	if len(t.Assignees) == 0 {
		t.AssigneeUserID = ""
		t.AssigneeName = ""
		return
	}
	first := t.Assignees[0]
	t.AssigneeUserID = strings.TrimSpace(first.UserID)
	t.AssigneeName = strings.TrimSpace(first.DisplayName)
}

type TaskComment struct {
	ID         string    `json:"id"`
	TaskID     string    `json:"taskId"`
	UserID     string    `json:"userId"`
	AuthorName string    `json:"authorName"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"createdAt"`
}

type TaskColumn struct {
	ID        string    `json:"id"`
	TeamID    string    `json:"teamId"`
	ProjectID string    `json:"projectId"`
	Title     string    `json:"title"`
	Position  int       `json:"position"`
	Version   int64     `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
