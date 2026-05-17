package service

import "unified-task-manager/services/task-service/internal/model"

type VersionConflictError struct {
	EntityType string
	Current    any
}

func (e *VersionConflictError) Error() string {
	return "version conflict"
}

func NewTaskVersionConflict(current model.Task) *VersionConflictError {
	return &VersionConflictError{EntityType: "task", Current: current}
}

func NewColumnVersionConflict(current model.TaskColumn) *VersionConflictError {
	return &VersionConflictError{EntityType: "column", Current: current}
}
