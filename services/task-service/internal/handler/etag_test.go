package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"unified-task-manager/services/task-service/internal/model"
	"unified-task-manager/services/task-service/internal/service"
)

func TestWriteTaskJSONSetsETag(t *testing.T) {
	rec := httptest.NewRecorder()
	task := model.Task{ID: "t1", Title: "Task", Version: 11}
	writeTaskJSON(rec, http.StatusOK, task)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d", rec.Code)
	}
	if rec.Header().Get("ETag") != service.TaskETag(11) {
		t.Fatalf("etag: got %s", rec.Header().Get("ETag"))
	}
	var body model.Task
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Version != 11 {
		t.Fatalf("version: got %d", body.Version)
	}
}

func TestWriteColumnJSONSetsETag(t *testing.T) {
	rec := httptest.NewRecorder()
	column := model.TaskColumn{ID: "c1", Title: "Col", Version: 4}
	writeColumnJSON(rec, http.StatusOK, column)

	if rec.Header().Get("ETag") != service.ColumnETag(4) {
		t.Fatalf("etag: got %s", rec.Header().Get("ETag"))
	}
}

func TestWriteVersionConflict(t *testing.T) {
	tests := []struct {
		name       string
		entityType string
		current    any
		wantKey    bool
	}{
		{
			name:       "task",
			entityType: "task",
			current:    model.Task{ID: "t1", Version: 2},
			wantKey:    true,
		},
		{
			name:       "column",
			entityType: "column",
			current:    model.TaskColumn{ID: "c1", Version: 3},
			wantKey:    true,
		},
		{
			name:       "columns list",
			entityType: "columns",
			current:    []model.TaskColumn{{ID: "c1"}, {ID: "c2"}},
			wantKey:    true,
		},
		{
			name:       "unknown entity omits current",
			entityType: "other",
			current:    model.Task{ID: "t1"},
			wantKey:    false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			conflict := &service.VersionConflictError{
				EntityType: tc.entityType,
				Current:    tc.current,
			}
			writeVersionConflict(rec, conflict)

			if rec.Code != http.StatusPreconditionFailed {
				t.Fatalf("status: got %d", rec.Code)
			}
			var payload map[string]any
			if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if payload["code"] != "VERSION_CONFLICT" {
				t.Fatalf("code: %#v", payload["code"])
			}
			if payload["message"] != "version conflict" {
				t.Fatalf("message: %#v", payload["message"])
			}
			_, hasCurrent := payload["current"]
			if hasCurrent != tc.wantKey {
				t.Fatalf("current present: got %v want %v", hasCurrent, tc.wantKey)
			}
		})
	}
}
