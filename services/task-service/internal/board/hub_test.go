package board

import (
	"encoding/json"
	"testing"
	"time"

	"UnifiedTaskManager/services/task-service/internal/model"
)

const testTimeout = 500 * time.Millisecond

func decodeEvent(t *testing.T, raw []byte) Event {
	t.Helper()
	var event Event
	if err := json.Unmarshal(raw, &event); err != nil {
		t.Fatalf("decode event: %v", err)
	}
	return event
}

func readEvent(t *testing.T, client *Client) Event {
	t.Helper()
	select {
	case raw := <-client.Send:
		return decodeEvent(t, raw)
	case <-time.After(testTimeout):
		t.Fatal("timed out waiting for board event")
		return Event{}
	}
}

func drainEvents(client *Client) {
	for {
		select {
		case <-client.Send:
		default:
			return
		}
	}
}

func TestRegisterBroadcastsPresence(t *testing.T) {
	hub := NewHub()
	client, unregister := hub.Register("team-1", "project-1", "user-a", "Alice")
	defer unregister()

	event := readEvent(t, client)
	if event.Type != "presence" {
		t.Fatalf("expected presence, got %s", event.Type)
	}
	if event.TeamID != "team-1" || event.ProjectID != "project-1" {
		t.Fatalf("unexpected routing: %+v", event)
	}
	users, ok := event.Users.([]interface{})
	if !ok || len(users) != 1 {
		t.Fatalf("expected one presence user, got %#v", event.Users)
	}
}

func TestSecondClientReceivesPresenceOnJoin(t *testing.T) {
	hub := NewHub()
	clientA, unregisterA := hub.Register("team-1", "project-1", "user-a", "Alice")
	defer unregisterA()
	drainEvents(clientA)

	clientB, unregisterB := hub.Register("team-1", "project-1", "user-b", "Bob")
	defer unregisterB()

	event := readEvent(t, clientA)
	if event.Type != "presence" {
		t.Fatalf("expected presence for existing client, got %s", event.Type)
	}

	drainEvents(clientB)
}

func TestUnregisterUpdatesPresence(t *testing.T) {
	hub := NewHub()
	_, unregisterA := hub.Register("team-1", "project-1", "user-a", "Alice")
	clientB, unregisterB := hub.Register("team-1", "project-1", "user-b", "Bob")
	drainEvents(clientB)

	unregisterA()

	event := readEvent(t, clientB)
	if event.Type != "presence" {
		t.Fatalf("expected presence after leave, got %s", event.Type)
	}
	users := event.Users.([]interface{})
	if len(users) != 1 {
		t.Fatalf("expected one user in presence, got %d", len(users))
	}

	unregisterB()
}

func TestPublishSkipsActor(t *testing.T) {
	hub := NewHub()
	clientA, unregisterA := hub.Register("team-1", "project-1", "user-a", "Alice")
	defer unregisterA()
	clientB, unregisterB := hub.Register("team-1", "project-1", "user-b", "Bob")
	defer unregisterB()
	drainEvents(clientA)
	drainEvents(clientB)

	task := model.Task{
		ID:        "task-1",
		Title:     "Demo",
		TeamID:    "team-1",
		ProjectID: "project-1",
		Version:   1,
	}
	hub.TaskUpdated("user-a", task)

	select {
	case <-clientA.Send:
		t.Fatal("actor should not receive own task.updated event")
	case <-time.After(100 * time.Millisecond):
	}

	event := readEvent(t, clientB)
	if event.Type != "task.updated" {
		t.Fatalf("expected task.updated, got %s", event.Type)
	}
	if event.ActorID != "user-a" {
		t.Fatalf("expected actor user-a, got %s", event.ActorID)
	}
}

func TestPublishDeliveredToPeerInOtherRoomNotReceiving(t *testing.T) {
	hub := NewHub()
	clientA, unregisterA := hub.Register("team-1", "project-1", "user-a", "Alice")
	defer unregisterA()
	clientOther, unregisterOther := hub.Register("team-1", "project-2", "user-b", "Bob")
	defer unregisterOther()
	drainEvents(clientA)
	drainEvents(clientOther)

	hub.TaskUpdated("user-a", model.Task{
		ID:        "task-1",
		TeamID:    "team-1",
		ProjectID: "project-1",
	})

	// Actor and other project must not receive the event.
	select {
	case raw := <-clientA.Send:
		t.Fatalf("actor should not receive event: %s", string(raw))
	case <-time.After(100 * time.Millisecond):
	}

	// clientOther is a different project — no event.
	select {
	case raw := <-clientOther.Send:
		t.Fatalf("other project should not receive event: %s", string(raw))
	case <-time.After(100 * time.Millisecond):
	}

	// peer in same room should receive
	clientPeer, unregisterPeer := hub.Register("team-1", "project-1", "user-c", "Carol")
	defer unregisterPeer()
	drainEvents(clientPeer)

	hub.TaskUpdated("user-a", model.Task{
		ID:        "task-2",
		TeamID:    "team-1",
		ProjectID: "project-1",
	})
	event := readEvent(t, clientPeer)
	if event.Type != "task.updated" {
		t.Fatalf("expected task.updated, got %s", event.Type)
	}
}

func TestTouchPresenceBroadcasts(t *testing.T) {
	hub := NewHub()
	clientA, unregisterA := hub.Register("team-1", "project-1", "user-a", "Alice")
	defer unregisterA()
	clientB, unregisterB := hub.Register("team-1", "project-1", "user-b", "Bob")
	defer unregisterB()
	drainEvents(clientA)
	drainEvents(clientB)

	hub.TouchPresence("team-1", "project-1", "user-a", "Alice Renamed")

	event := readEvent(t, clientB)
	if event.Type != "presence" {
		t.Fatalf("expected presence, got %s", event.Type)
	}
}

func TestSendSnapshot(t *testing.T) {
	hub := NewHub()
	client, unregister := hub.Register("team-1", "project-1", "user-a", "Alice")
	defer unregister()
	drainEvents(client)

	tasks := []model.Task{
		{ID: "task-1", Title: "One", TeamID: "team-1", ProjectID: "project-1", Version: 1},
	}
	columns := []model.TaskColumn{
		{ID: "col-1", Title: "Todo", TeamID: "team-1", ProjectID: "project-1", Version: 1},
	}
	hub.SendSnapshot(client, tasks, columns)

	event := readEvent(t, client)
	if event.Type != "board.snapshot" {
		t.Fatalf("expected board.snapshot, got %s", event.Type)
	}
	if event.TeamID != "team-1" || event.ProjectID != "project-1" {
		t.Fatalf("unexpected ids: %+v", event)
	}
	if event.Tasks == nil || event.Columns == nil {
		t.Fatal("expected tasks and columns in snapshot")
	}
	if event.Users == nil {
		t.Fatal("expected presence users in snapshot")
	}
}

func TestCommentAddedEventShape(t *testing.T) {
	hub := NewHub()
	_, unregisterA := hub.Register("team-1", "project-1", "user-a", "Alice")
	clientB, unregisterB := hub.Register("team-1", "project-1", "user-b", "Bob")
	defer unregisterA()
	defer unregisterB()
	drainEvents(clientB)

	task := model.Task{ID: "task-1", TeamID: "team-1", ProjectID: "project-1"}
	comment := model.TaskComment{ID: "c1", TaskID: "task-1", Body: "hi"}
	hub.CommentAdded("user-a", task, comment)

	event := readEvent(t, clientB)
	if event.Type != "task.comment.added" {
		t.Fatalf("expected task.comment.added, got %s", event.Type)
	}
	if event.TaskID != "task-1" {
		t.Fatalf("expected task id, got %s", event.TaskID)
	}
}
