package handler

import (
	"encoding/json"
	"net/http"

	"UnifiedTaskManager/services/task-service/internal/model"
	"UnifiedTaskManager/services/task-service/internal/service"
)

func writeTaskJSON(w http.ResponseWriter, status int, task model.Task) {
	w.Header().Set("ETag", service.TaskETag(task.Version))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(task)
}

func writeColumnJSON(w http.ResponseWriter, status int, column model.TaskColumn) {
	w.Header().Set("ETag", service.ColumnETag(column.Version))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(column)
}

func writeVersionConflict(w http.ResponseWriter, conflict *service.VersionConflictError) {
	payload := map[string]any{
		"message": "version conflict",
		"code":    "VERSION_CONFLICT",
	}
	switch conflict.EntityType {
	case "task", "column", "columns":
		payload["current"] = conflict.Current
	}
	writeJSON(w, http.StatusPreconditionFailed, payload)
}
