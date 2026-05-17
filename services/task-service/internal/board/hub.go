package board

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"unified-task-manager/services/task-service/internal/model"
)

type Event struct {
	Type      string `json:"type"`
	TeamID    string `json:"teamId,omitempty"`
	ProjectID string `json:"projectId,omitempty"`
	Task      any    `json:"task,omitempty"`
	Tasks     any    `json:"tasks,omitempty"`
	Column    any    `json:"column,omitempty"`
	Columns   any    `json:"columns,omitempty"`
	TaskID    string `json:"taskId,omitempty"`
	ColumnID  string `json:"columnId,omitempty"`
	Comment   any    `json:"comment,omitempty"`
	Users     any    `json:"users,omitempty"`
	ActorID   string `json:"actorId,omitempty"`
}

type PresenceUser struct {
	UserID   string `json:"userId"`
	Name     string `json:"name"`
	LastSeen int64  `json:"lastSeen"`
}

type Client struct {
	TeamID    string
	ProjectID string
	UserID    string
	UserName  string
	Send      chan []byte
}

type Hub struct {
	mu       sync.RWMutex
	rooms    map[string]map[*Client]struct{}
	presence map[string]map[string]PresenceUser
}

func NewHub() *Hub {
	return &Hub{
		rooms:    make(map[string]map[*Client]struct{}),
		presence: make(map[string]map[string]PresenceUser),
	}
}

func roomKey(teamID, projectID string) string {
	return teamID + ":" + projectID
}

func (h *Hub) Register(teamID, projectID, userID, userName string) (*Client, func()) {
	key := roomKey(teamID, projectID)
	c := &Client{
		TeamID:    teamID,
		ProjectID: projectID,
		UserID:    userID,
		UserName:  userName,
		Send:      make(chan []byte, 32),
	}

	h.mu.Lock()
	if h.rooms[key] == nil {
		h.rooms[key] = make(map[*Client]struct{})
	}
	h.rooms[key][c] = struct{}{}
	if h.presence[key] == nil {
		h.presence[key] = make(map[string]PresenceUser)
	}
	h.presence[key][userID] = PresenceUser{
		UserID:   userID,
		Name:     userName,
		LastSeen: time.Now().Unix(),
	}
	h.mu.Unlock()

	h.broadcastPresence(key, teamID, projectID)

	return c, func() {
		h.mu.Lock()
		if clients, ok := h.rooms[key]; ok {
			delete(clients, c)
			if len(clients) == 0 {
				delete(h.rooms, key)
			}
		}
		if users, ok := h.presence[key]; ok {
			delete(users, userID)
			if len(users) == 0 {
				delete(h.presence, key)
			}
		}
		h.mu.Unlock()
		close(c.Send)
		h.broadcastPresence(key, teamID, projectID)
	}
}

func (h *Hub) TouchPresence(teamID, projectID, userID, userName string) {
	key := roomKey(teamID, projectID)
	h.mu.Lock()
	if h.presence[key] == nil {
		h.presence[key] = make(map[string]PresenceUser)
	}
	h.presence[key][userID] = PresenceUser{
		UserID:   userID,
		Name:     userName,
		LastSeen: time.Now().Unix(),
	}
	h.mu.Unlock()
	h.broadcastPresence(key, teamID, projectID)
}

func (h *Hub) presenceSnapshot(key string) []PresenceUser {
	h.mu.RLock()
	defer h.mu.RUnlock()
	users := h.presence[key]
	if len(users) == 0 {
		return []PresenceUser{}
	}
	items := make([]PresenceUser, 0, len(users))
	for _, user := range users {
		items = append(items, user)
	}
	return items
}

func (h *Hub) broadcastPresence(key, teamID, projectID string) {
	users := h.presenceSnapshot(key)
	payload, err := json.Marshal(Event{
		Type:      "presence",
		TeamID:    teamID,
		ProjectID: projectID,
		Users:     users,
	})
	if err != nil {
		return
	}
	h.broadcastRaw(key, payload, "")
}

func (h *Hub) Publish(event Event) {
	h.publishLocal(event)
}

func (h *Hub) publishLocal(event Event) {
	payload, err := json.Marshal(event)
	if err != nil {
		log.Printf("board hub marshal failed: %v", err)
		return
	}
	key := roomKey(event.TeamID, event.ProjectID)
	h.broadcastRaw(key, payload, event.ActorID)
}

func (h *Hub) sendToClient(client *Client, payload []byte) {
	select {
	case client.Send <- payload:
	default:
		log.Printf("board hub: disconnecting slow client user=%s", client.UserID)
		go func(c *Client) {
			select {
			case <-c.Send:
			default:
			}
		}(client)
	}
}

func (h *Hub) SendSnapshot(client *Client, tasks []model.Task, columns []model.TaskColumn) {
	if client == nil {
		return
	}
	users := h.presenceSnapshot(roomKey(client.TeamID, client.ProjectID))
	payload, err := json.Marshal(Event{
		Type:      "board.snapshot",
		TeamID:    client.TeamID,
		ProjectID: client.ProjectID,
		Tasks:     tasks,
		Columns:   columns,
		Users:     users,
	})
	if err != nil {
		return
	}
	h.sendToClient(client, payload)
}

func (h *Hub) broadcastRaw(key string, payload []byte, exceptUserID string) {
	h.mu.RLock()
	clients := h.rooms[key]
	targets := make([]*Client, 0, len(clients))
	for client := range clients {
		if exceptUserID != "" && client.UserID == exceptUserID {
			continue
		}
		targets = append(targets, client)
	}
	h.mu.RUnlock()

	for _, client := range targets {
		h.sendToClient(client, payload)
	}
}

func (h *Hub) TaskCreated(actorID string, task model.Task) {
	h.Publish(Event{Type: "task.created", TeamID: task.TeamID, ProjectID: task.ProjectID, Task: task, ActorID: actorID})
}

func (h *Hub) TaskUpdated(actorID string, task model.Task) {
	h.Publish(Event{Type: "task.updated", TeamID: task.TeamID, ProjectID: task.ProjectID, Task: task, ActorID: actorID})
}

func (h *Hub) TasksReordered(actorID, teamID, projectID string, tasks []model.Task) {
	h.Publish(Event{Type: "tasks.reordered", TeamID: teamID, ProjectID: projectID, Tasks: tasks, ActorID: actorID})
}

func (h *Hub) TaskDeleted(actorID, teamID, projectID, taskID string) {
	h.Publish(Event{Type: "task.deleted", TeamID: teamID, ProjectID: projectID, TaskID: taskID, ActorID: actorID})
}

func (h *Hub) ColumnCreated(actorID string, column model.TaskColumn) {
	h.Publish(Event{Type: "column.created", TeamID: column.TeamID, ProjectID: column.ProjectID, Column: column, ActorID: actorID})
}

func (h *Hub) ColumnUpdated(actorID string, column model.TaskColumn) {
	h.Publish(Event{Type: "column.updated", TeamID: column.TeamID, ProjectID: column.ProjectID, Column: column, ActorID: actorID})
}

func (h *Hub) ColumnDeleted(actorID, teamID, projectID, columnID string) {
	h.Publish(Event{Type: "column.deleted", TeamID: teamID, ProjectID: projectID, ColumnID: columnID, ActorID: actorID})
}

func (h *Hub) ColumnsReordered(actorID, teamID, projectID string, columns []model.TaskColumn) {
	h.Publish(Event{Type: "columns.reordered", TeamID: teamID, ProjectID: projectID, Columns: columns, ActorID: actorID})
}

func (h *Hub) CommentAdded(actorID string, task model.Task, comment model.TaskComment) {
	h.Publish(Event{
		Type:      "task.comment.added",
		TeamID:    task.TeamID,
		ProjectID: task.ProjectID,
		TaskID:    task.ID,
		Task:      task,
		Comment:   comment,
		ActorID:   actorID,
	})
}
