package model

import "time"

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
	AssigneeUserID string       `json:"assigneeUserId,omitempty"`
	AssigneeName   string       `json:"assigneeName,omitempty"`
	TeamID         string       `json:"teamId,omitempty"`
	ProjectID      string       `json:"projectId,omitempty"`
	UnreadComments int          `json:"unreadComments,omitempty"`
	Version        int64        `json:"version"`
	CreatedAt      time.Time    `json:"createdAt"`
	UpdatedAt      time.Time    `json:"updatedAt"`
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
