package board

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"UnifiedTaskManager/services/task-service/internal/model"
)

const redisChannel = "utm:board:events"

type redisEnvelope struct {
	NodeID string `json:"nodeId"`
	Event  Event  `json:"event"`
}

// DistributedHub broadcasts to local websocket clients and other task-service instances via Redis.
type DistributedHub struct {
	*Hub
	redis  *redis.Client
	nodeID string
	cancel context.CancelFunc
}

func NewDistributedHub(redisURL string) *DistributedHub {
	d := &DistributedHub{Hub: NewHub(), nodeID: strings.TrimSpace(os.Getenv("HOSTNAME"))}
	if d.nodeID == "" {
		d.nodeID = uuid.NewString()
	}
	redisURL = strings.TrimSpace(redisURL)
	if redisURL == "" {
		log.Printf("board hub: local-only mode node=%s", d.nodeID)
		return d
	}
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Printf("board hub: invalid TASK_BOARD_REDIS_URL: %v", err)
		return d
	}
	client := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		log.Printf("board hub: redis unavailable, local-only: %v", err)
		_ = client.Close()
		return d
	}
	d.redis = client
	runCtx, runCancel := context.WithCancel(context.Background())
	d.cancel = runCancel
	go d.subscribeLoop(runCtx)
	log.Printf("board hub: redis enabled node=%s", d.nodeID)
	return d
}

func (d *DistributedHub) Close() {
	if d.cancel != nil {
		d.cancel()
	}
	if d.redis != nil {
		_ = d.redis.Close()
	}
}

func (d *DistributedHub) subscribeLoop(ctx context.Context) {
	pubsub := d.redis.Subscribe(ctx, redisChannel)
	defer pubsub.Close()
	for {
		msg, err := pubsub.ReceiveMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			time.Sleep(time.Second)
			continue
		}
		var envelope redisEnvelope
		if err := json.Unmarshal([]byte(msg.Payload), &envelope); err != nil {
			continue
		}
		if envelope.NodeID == d.nodeID {
			continue
		}
		d.Hub.publishLocal(envelope.Event)
	}
}

func (d *DistributedHub) Publish(event Event) {
	d.Hub.publishLocal(event)
	if d.redis == nil {
		return
	}
	payload, err := json.Marshal(redisEnvelope{NodeID: d.nodeID, Event: event})
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := d.redis.Publish(ctx, redisChannel, payload).Err(); err != nil {
		log.Printf("board hub: redis publish error: %v", err)
	}
}

func (d *DistributedHub) TouchPresence(teamID, projectID, userID, userName string) {
	d.Hub.TouchPresence(teamID, projectID, userID, userName)
}

func (d *DistributedHub) SendSnapshot(client *Client, tasks []model.Task, columns []model.TaskColumn) {
	d.Hub.SendSnapshot(client, tasks, columns)
}

func (d *DistributedHub) TaskCreated(actorID string, task model.Task) {
	d.Publish(Event{Type: "task.created", TeamID: task.TeamID, ProjectID: task.ProjectID, Task: task, ActorID: actorID})
}

func (d *DistributedHub) TaskUpdated(actorID string, task model.Task) {
	d.Publish(Event{Type: "task.updated", TeamID: task.TeamID, ProjectID: task.ProjectID, Task: task, ActorID: actorID})
}

func (d *DistributedHub) TasksReordered(actorID, teamID, projectID string, tasks []model.Task) {
	d.Publish(Event{Type: "tasks.reordered", TeamID: teamID, ProjectID: projectID, Tasks: tasks, ActorID: actorID})
}

func (d *DistributedHub) TaskDeleted(actorID, teamID, projectID, taskID string) {
	d.Publish(Event{Type: "task.deleted", TeamID: teamID, ProjectID: projectID, TaskID: taskID, ActorID: actorID})
}

func (d *DistributedHub) ColumnCreated(actorID string, column model.TaskColumn) {
	d.Publish(Event{Type: "column.created", TeamID: column.TeamID, ProjectID: column.ProjectID, Column: column, ActorID: actorID})
}

func (d *DistributedHub) ColumnUpdated(actorID string, column model.TaskColumn) {
	d.Publish(Event{Type: "column.updated", TeamID: column.TeamID, ProjectID: column.ProjectID, Column: column, ActorID: actorID})
}

func (d *DistributedHub) ColumnDeleted(actorID, teamID, projectID, columnID string) {
	d.Publish(Event{Type: "column.deleted", TeamID: teamID, ProjectID: projectID, ColumnID: columnID, ActorID: actorID})
}

func (d *DistributedHub) ColumnsReordered(actorID, teamID, projectID string, columns []model.TaskColumn) {
	d.Publish(Event{Type: "columns.reordered", TeamID: teamID, ProjectID: projectID, Columns: columns, ActorID: actorID})
}

func (d *DistributedHub) CommentAdded(actorID string, task model.Task, comment model.TaskComment) {
	d.Publish(Event{
		Type:      "task.comment.added",
		TeamID:    task.TeamID,
		ProjectID: task.ProjectID,
		TaskID:    task.ID,
		Task:      task,
		Comment:   comment,
		ActorID:   actorID,
	})
}
