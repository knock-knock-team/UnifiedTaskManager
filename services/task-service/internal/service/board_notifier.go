package service

import "unified-task-manager/services/task-service/internal/model"

type BoardNotifier interface {
	TaskCreated(actorID string, task model.Task)
	TaskUpdated(actorID string, task model.Task)
	TaskDeleted(actorID, teamID, projectID, taskID string)
	TasksReordered(actorID, teamID, projectID string, tasks []model.Task)
	ColumnCreated(actorID string, column model.TaskColumn)
	ColumnUpdated(actorID string, column model.TaskColumn)
	ColumnDeleted(actorID, teamID, projectID, columnID string)
	ColumnsReordered(actorID, teamID, projectID string, columns []model.TaskColumn)
	CommentAdded(actorID string, task model.Task, comment model.TaskComment)
}
