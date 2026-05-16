package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"UnifiedTaskManager/services/task-service/internal/model"
)

type PostgresTaskRepository struct {
	db *pgxpool.Pool
}

func NewPostgresTaskRepository(ctx context.Context, databaseURL string) (*PostgresTaskRepository, error) {
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	return &PostgresTaskRepository{db: db}, nil
}

func (r *PostgresTaskRepository) EnsureSchema(ctx context.Context) error {
	const q = `
CREATE TABLE IF NOT EXISTS tasks (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL,
	priority TEXT NOT NULL,
	due_at TIMESTAMPTZ NULL,
	completed_at TIMESTAMPTZ NULL,
	completed_by TEXT NOT NULL DEFAULT '',
	created_by TEXT NOT NULL,
	assignee_user_id TEXT NOT NULL DEFAULT '',
	assignee_name TEXT NOT NULL DEFAULT '',
	team_id TEXT NOT NULL DEFAULT '',
	project_id TEXT NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL,
	version BIGINT NOT NULL DEFAULT 1,
	deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_team_id ON tasks(team_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id TEXT NOT NULL DEFAULT '';
	ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_user_id TEXT NOT NULL DEFAULT '';
	ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_name TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignees_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_position INTEGER NOT NULL DEFAULT 0;

UPDATE tasks
SET completed_at = COALESCE(completed_at, updated_at, created_at, NOW())
WHERE deleted_at IS NULL
	AND status = 'done'
	AND completed_at IS NULL;

CREATE TABLE IF NOT EXISTS task_columns (
	id TEXT PRIMARY KEY,
	team_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	title TEXT NOT NULL,
	position INTEGER NOT NULL DEFAULT 0,
	created_at TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL,
	version BIGINT NOT NULL DEFAULT 1,
	deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_task_columns_project_id ON task_columns(project_id);
ALTER TABLE task_columns ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_task_columns_team_id ON task_columns(team_id);
ALTER TABLE task_columns ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS task_comments (
	id TEXT PRIMARY KEY,
	task_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	author_name TEXT NOT NULL DEFAULT '',
	body TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task_comment_reads (
	task_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	last_read_at TIMESTAMPTZ NOT NULL,
	PRIMARY KEY (task_id, user_id)
);
`
	_, err := r.db.Exec(ctx, q)
	return err
}

func (r *PostgresTaskRepository) Create(task model.Task) (model.Task, error) {
	const q = `
INSERT INTO tasks (id, title, description, status, priority, due_at, completed_at, completed_by, created_by, assignee_user_id, assignee_name, assignees_json, tags_json, sort_position, team_id, project_id, created_at, updated_at, version, deleted_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NULL)`

	version := task.Version
	if version <= 0 {
		version = 1
	}
	assigneesJSON, tagsJSON := marshalTaskExtras(task)
	_, err := r.db.Exec(context.Background(), q,
		task.ID,
		task.Title,
		task.Description,
		string(task.Status),
		string(task.Priority),
		task.DueAt,
		task.CompletedAt,
		task.CompletedBy,
		task.CreatedBy,
		task.AssigneeUserID,
		task.AssigneeName,
		assigneesJSON,
		tagsJSON,
		task.SortPosition,
		task.TeamID,
		task.ProjectID,
		task.CreatedAt,
		task.UpdatedAt,
		version,
	)
	if err != nil {
		return model.Task{}, err
	}
	return task, nil
}

func (r *PostgresTaskRepository) GetByID(id string) (model.Task, error) {
	const q = `
SELECT id, title, description, status, priority, due_at, completed_at, completed_by, created_by, assignee_user_id, assignee_name, assignees_json, tags_json, sort_position, team_id, project_id, created_at, updated_at, version, deleted_at
FROM tasks
WHERE id = $1 AND deleted_at IS NULL`

	task, err := scanTask(r.db.QueryRow(context.Background(), q, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.Task{}, ErrNotFound
	}
	if err != nil {
		return model.Task{}, err
	}
	return task, nil
}

func (r *PostgresTaskRepository) List(limit, offset int, search string) ([]model.Task, int, error) {
	return r.listInternal("", "", "", limit, offset, search)
}

func (r *PostgresTaskRepository) ListByOwner(ownerID string, limit, offset int, search string) ([]model.Task, int, error) {
	return r.listInternal(strings.TrimSpace(ownerID), "", "", limit, offset, search)
}

func (r *PostgresTaskRepository) ListByTeam(teamID string, limit, offset int, search string) ([]model.Task, int, error) {
	return r.listInternal("", strings.TrimSpace(teamID), "", limit, offset, search)
}

func (r *PostgresTaskRepository) ListByProject(projectID string, limit, offset int, search string) ([]model.Task, int, error) {
	return r.listInternal("", "", strings.TrimSpace(projectID), limit, offset, search)
}

func (r *PostgresTaskRepository) listInternal(ownerID, teamID, projectID string, limit, offset int, search string) ([]model.Task, int, error) {
	like := "%" + strings.ToLower(strings.TrimSpace(search)) + "%"
	if strings.TrimSpace(search) == "" {
		like = "%"
	}

	const totalQ = `
SELECT COUNT(*)
FROM tasks
WHERE deleted_at IS NULL
  AND ($1 = '' OR created_by = $1)
	AND ($2 = '' OR team_id = $2)
	AND ($3 = '' OR project_id = $3)
	AND (LOWER(title) LIKE $4 OR LOWER(description) LIKE $4 OR LOWER(COALESCE(assignees_json,'')) LIKE $4 OR LOWER(COALESCE(tags_json,'')) LIKE $4)`

	orderClause := `ORDER BY created_at DESC`
	if projectID != "" {
		orderClause = `ORDER BY sort_position ASC, created_at DESC`
	}

	listQ := `
SELECT id, title, description, status, priority, due_at, completed_at, completed_by, created_by, assignee_user_id, assignee_name, assignees_json, tags_json, sort_position, team_id, project_id, created_at, updated_at, version, deleted_at
FROM tasks
WHERE deleted_at IS NULL
  AND ($1 = '' OR created_by = $1)
	AND ($2 = '' OR team_id = $2)
	AND ($3 = '' OR project_id = $3)
	AND (LOWER(title) LIKE $4 OR LOWER(description) LIKE $4 OR LOWER(COALESCE(assignees_json,'')) LIKE $4 OR LOWER(COALESCE(tags_json,'')) LIKE $4)
` + orderClause + `
LIMIT $5 OFFSET $6`

	var total int
	if err := r.db.QueryRow(context.Background(), totalQ, ownerID, teamID, projectID, like).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := r.db.Query(context.Background(), listQ, ownerID, teamID, projectID, like, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]model.Task, 0, limit)
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, task)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return items, total, nil
}

func (r *PostgresTaskRepository) Update(task model.Task) (model.Task, error) {
	const q = `
UPDATE tasks
SET title = $2,
	description = $3,
	status = $4,
	priority = $5,
	due_at = $6,
	completed_at = $7,
	completed_by = $8,
	assignee_user_id = $9,
	assignee_name = $10,
	assignees_json = $11,
	tags_json = $12,
	sort_position = $13,
	updated_at = $14,
	version = version + 1
WHERE id = $1 AND deleted_at IS NULL
RETURNING version`

	assigneesJSON, tagsJSON := marshalTaskExtras(task)
	var nextVersion int64
	err := r.db.QueryRow(context.Background(), q,
		task.ID,
		task.Title,
		task.Description,
		string(task.Status),
		string(task.Priority),
		task.DueAt,
		task.CompletedAt,
		task.CompletedBy,
		task.AssigneeUserID,
		task.AssigneeName,
		assigneesJSON,
		tagsJSON,
		task.SortPosition,
		task.UpdatedAt,
	).Scan(&nextVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Task{}, ErrNotFound
	}
	if err != nil {
		return model.Task{}, err
	}
	task.Version = nextVersion
	return task, nil
}

func (r *PostgresTaskRepository) UpdateIfVersion(task model.Task, expectedVersion int64) (model.Task, error) {
	const q = `
UPDATE tasks
SET title = $2,
	description = $3,
	status = $4,
	priority = $5,
	due_at = $6,
	completed_at = $7,
	completed_by = $8,
	assignee_user_id = $9,
	assignee_name = $10,
	assignees_json = $11,
	tags_json = $12,
	sort_position = $13,
	updated_at = $14,
	version = version + 1
WHERE id = $1 AND deleted_at IS NULL AND version = $15
RETURNING version`

	assigneesJSON, tagsJSON := marshalTaskExtras(task)
	var nextVersion int64
	err := r.db.QueryRow(context.Background(), q,
		task.ID,
		task.Title,
		task.Description,
		string(task.Status),
		string(task.Priority),
		task.DueAt,
		task.CompletedAt,
		task.CompletedBy,
		task.AssigneeUserID,
		task.AssigneeName,
		assigneesJSON,
		tagsJSON,
		task.SortPosition,
		task.UpdatedAt,
		expectedVersion,
	).Scan(&nextVersion)
	if errors.Is(err, sql.ErrNoRows) {
		_, getErr := r.GetByID(task.ID)
		if getErr != nil {
			return model.Task{}, ErrNotFound
		}
		return model.Task{}, ErrVersionConflict
	}
	if err != nil {
		return model.Task{}, err
	}
	task.Version = nextVersion
	return task, nil
}

func (r *PostgresTaskRepository) CreateColumn(column model.TaskColumn) (model.TaskColumn, error) {
	const q = `
INSERT INTO task_columns (id, team_id, project_id, title, position, created_at, updated_at, version, deleted_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)`

	version := column.Version
	if version <= 0 {
		version = 1
	}
	_, err := r.db.Exec(context.Background(), q,
		column.ID,
		column.TeamID,
		column.ProjectID,
		column.Title,
		column.Position,
		column.CreatedAt,
		column.UpdatedAt,
		version,
	)
	if err != nil {
		return model.TaskColumn{}, err
	}
	return column, nil
}

func (r *PostgresTaskRepository) GetColumnByID(id string) (model.TaskColumn, error) {
	const q = `
SELECT id, team_id, project_id, title, position, created_at, updated_at, version
FROM task_columns
WHERE id = $1 AND deleted_at IS NULL`

	var column model.TaskColumn
	err := r.db.QueryRow(context.Background(), q, id).Scan(
		&column.ID,
		&column.TeamID,
		&column.ProjectID,
		&column.Title,
		&column.Position,
		&column.CreatedAt,
		&column.UpdatedAt,
		&column.Version,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return model.TaskColumn{}, ErrNotFound
	}
	if err != nil {
		return model.TaskColumn{}, err
	}
	return column, nil
}

func (r *PostgresTaskRepository) ListColumnsByProject(projectID string) ([]model.TaskColumn, error) {
	const q = `
SELECT id, team_id, project_id, title, position, created_at, updated_at, version
FROM task_columns
WHERE project_id = $1 AND deleted_at IS NULL
ORDER BY position ASC, created_at ASC`

	rows, err := r.db.Query(context.Background(), q, strings.TrimSpace(projectID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.TaskColumn, 0)
	for rows.Next() {
		var column model.TaskColumn
		if err := rows.Scan(
			&column.ID,
			&column.TeamID,
			&column.ProjectID,
			&column.Title,
			&column.Position,
			&column.CreatedAt,
			&column.UpdatedAt,
			&column.Version,
		); err != nil {
			return nil, err
		}
		items = append(items, column)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresTaskRepository) GetMaxColumnPosition(projectID string) (int, error) {
	const q = `
SELECT COALESCE(MAX(position), -1)
FROM task_columns
WHERE project_id = $1 AND deleted_at IS NULL`
	var max int
	err := r.db.QueryRow(context.Background(), q, strings.TrimSpace(projectID)).Scan(&max)
	if err != nil {
		return 0, err
	}
	return max, nil
}

func (r *PostgresTaskRepository) UpdateColumn(column model.TaskColumn) (model.TaskColumn, error) {
	const q = `
UPDATE task_columns
SET title = $2, updated_at = $3, version = version + 1
WHERE id = $1 AND deleted_at IS NULL
RETURNING version`
	err := r.db.QueryRow(
		context.Background(),
		q,
		strings.TrimSpace(column.ID),
		column.Title,
		column.UpdatedAt,
	).Scan(&column.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return model.TaskColumn{}, ErrNotFound
	}
	if err != nil {
		return model.TaskColumn{}, err
	}
	return column, nil
}

func (r *PostgresTaskRepository) UpdateColumnIfVersion(column model.TaskColumn, expectedVersion int64) (model.TaskColumn, error) {
	const q = `
UPDATE task_columns
SET title = $2, updated_at = $3, version = version + 1
WHERE id = $1 AND deleted_at IS NULL AND version = $4
RETURNING version`
	err := r.db.QueryRow(
		context.Background(),
		q,
		strings.TrimSpace(column.ID),
		column.Title,
		column.UpdatedAt,
		expectedVersion,
	).Scan(&column.Version)
	if errors.Is(err, sql.ErrNoRows) {
		_, getErr := r.GetColumnByID(column.ID)
		if getErr != nil {
			return model.TaskColumn{}, ErrNotFound
		}
		return model.TaskColumn{}, ErrVersionConflict
	}
	if err != nil {
		return model.TaskColumn{}, err
	}
	return column, nil
}

func (r *PostgresTaskRepository) UpdateColumnPosition(id string, position int) error {
	const q = `
UPDATE task_columns
SET position = $2, updated_at = $3, version = version + 1
WHERE id = $1 AND deleted_at IS NULL`
	res, err := r.db.Exec(context.Background(), q, strings.TrimSpace(id), position, time.Now().UTC())
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresTaskRepository) DeleteColumn(id string) error {
	const q = `
UPDATE task_columns
SET deleted_at = $2, updated_at = $2
WHERE id = $1 AND deleted_at IS NULL`
	now := time.Now().UTC()
	res, err := r.db.Exec(context.Background(), q, id, now)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresTaskRepository) CountByProjectAndStatus(projectID, status string) (int, error) {
	const q = `
SELECT COUNT(*)
FROM tasks
WHERE project_id = $1 AND status = $2 AND deleted_at IS NULL`
	var count int
	err := r.db.QueryRow(context.Background(), q, strings.TrimSpace(projectID), strings.TrimSpace(status)).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

func (r *PostgresTaskRepository) MaxSortPosition(projectID, columnStatus string) (int, error) {
	projectID = strings.TrimSpace(projectID)
	columnStatus = strings.TrimSpace(columnStatus)
	if projectID == "" || columnStatus == "" {
		return -1, nil
	}
	const q = `
SELECT COALESCE(MAX(sort_position), -1)
FROM tasks
WHERE project_id = $1 AND status = $2 AND deleted_at IS NULL`
	var max int
	err := r.db.QueryRow(context.Background(), q, projectID, columnStatus).Scan(&max)
	if err != nil {
		return 0, err
	}
	return max, nil
}

func (r *PostgresTaskRepository) ReorderTasksInColumn(projectID, columnStatus string, orderedIDs []string) ([]model.Task, error) {
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

	ctx := context.Background()
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	const listQ = `
SELECT id
FROM tasks
WHERE project_id = $1 AND status = $2 AND deleted_at IS NULL
ORDER BY sort_position ASC, created_at DESC`

	rows, err := tx.Query(ctx, listQ, projectID, columnStatus)
	if err != nil {
		return nil, err
	}
	current := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		current = append(current, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

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
	const upQ = `
UPDATE tasks
SET sort_position = $1, updated_at = $2, version = version + 1
WHERE id = $3 AND project_id = $4 AND status = $5 AND deleted_at IS NULL`
	for i, id := range cleaned {
		tag, err := tx.Exec(ctx, upQ, i, now, id, projectID, columnStatus)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() == 0 {
			return nil, ErrInvalidReorder
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	out := make([]model.Task, 0, len(cleaned))
	for _, id := range cleaned {
		task, err := r.GetByID(id)
		if err != nil {
			return nil, err
		}
		out = append(out, task)
	}
	return out, nil
}

func (r *PostgresTaskRepository) CreateComment(comment model.TaskComment) (model.TaskComment, error) {
	const q = `
INSERT INTO task_comments (id, task_id, user_id, author_name, body, created_at)
VALUES ($1, $2, $3, $4, $5, $6)`
	_, err := r.db.Exec(context.Background(), q,
		comment.ID,
		comment.TaskID,
		comment.UserID,
		comment.AuthorName,
		comment.Body,
		comment.CreatedAt,
	)
	if err != nil {
		return model.TaskComment{}, err
	}
	return comment, nil
}

func (r *PostgresTaskRepository) ListCommentsByTaskID(taskID string) ([]model.TaskComment, error) {
	const q = `
SELECT id, task_id, user_id, author_name, body, created_at
FROM task_comments
WHERE task_id = $1
ORDER BY created_at ASC`

	rows, err := r.db.Query(context.Background(), q, strings.TrimSpace(taskID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.TaskComment, 0)
	for rows.Next() {
		var item model.TaskComment
		if err := rows.Scan(&item.ID, &item.TaskID, &item.UserID, &item.AuthorName, &item.Body, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresTaskRepository) GetCommentByID(commentID string) (model.TaskComment, error) {
	const q = `
SELECT id, task_id, user_id, author_name, body, created_at
FROM task_comments
WHERE id = $1`

	var item model.TaskComment
	err := r.db.QueryRow(context.Background(), q, strings.TrimSpace(commentID)).Scan(
		&item.ID,
		&item.TaskID,
		&item.UserID,
		&item.AuthorName,
		&item.Body,
		&item.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.TaskComment{}, ErrNotFound
		}
		return model.TaskComment{}, err
	}
	return item, nil
}

func (r *PostgresTaskRepository) DeleteComment(commentID string) error {
	const q = `
DELETE FROM task_comments
WHERE id = $1`

	res, err := r.db.Exec(context.Background(), q, strings.TrimSpace(commentID))
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresTaskRepository) MarkTaskCommentsRead(taskID, userID string, readAt time.Time) error {
	const q = `
INSERT INTO task_comment_reads (task_id, user_id, last_read_at)
VALUES ($1, $2, $3)
ON CONFLICT (task_id, user_id) DO UPDATE
SET last_read_at = EXCLUDED.last_read_at`
	_, err := r.db.Exec(context.Background(), q, strings.TrimSpace(taskID), strings.TrimSpace(userID), readAt)
	return err
}

func (r *PostgresTaskRepository) ListUnreadCommentCounts(taskIDs []string, userID string) (map[string]int, error) {
	result := make(map[string]int, len(taskIDs))
	cleaned := make([]string, 0, len(taskIDs))
	for _, raw := range taskIDs {
		id := strings.TrimSpace(raw)
		if id != "" {
			cleaned = append(cleaned, id)
		}
	}
	if len(cleaned) == 0 {
		return result, nil
	}

	const q = `
SELECT c.task_id, COUNT(*)
FROM task_comments c
LEFT JOIN task_comment_reads r
	ON r.task_id = c.task_id AND r.user_id = $2
WHERE c.task_id = ANY($1)
	AND c.user_id <> $2
	AND c.created_at > COALESCE(r.last_read_at, to_timestamp(0))
GROUP BY c.task_id`

	rows, err := r.db.Query(context.Background(), q, cleaned, strings.TrimSpace(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var taskID string
		var count int
		if err := rows.Scan(&taskID, &count); err != nil {
			return nil, err
		}
		if count > 0 {
			result[taskID] = count
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *PostgresTaskRepository) Delete(id string) error {
	const q = `
UPDATE tasks
SET deleted_at = $2, updated_at = $2
WHERE id = $1 AND deleted_at IS NULL`
	now := time.Now().UTC()
	res, err := r.db.Exec(context.Background(), q, id, now)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresTaskRepository) Ping(ctx context.Context) error {
	return r.db.Ping(ctx)
}

type scanner interface {
	Scan(dest ...any) error
}

func marshalTaskExtras(task model.Task) (assigneesJSON, tagsJSON string) {
	aBytes, err := json.Marshal(task.Assignees)
	if err != nil || len(aBytes) == 0 || string(aBytes) == "null" {
		aBytes = []byte("[]")
	}
	tBytes, err := json.Marshal(task.Tags)
	if err != nil || len(tBytes) == 0 || string(tBytes) == "null" {
		tBytes = []byte("[]")
	}
	return string(aBytes), string(tBytes)
}

func scanTask(row scanner) (model.Task, error) {
	var task model.Task
	var status string
	var priority string
	var completedBy string
	var deletedAt *time.Time
	var assigneesJSON, tagsJSON string

	err := row.Scan(
		&task.ID,
		&task.Title,
		&task.Description,
		&status,
		&priority,
		&task.DueAt,
		&task.CompletedAt,
		&completedBy,
		&task.CreatedBy,
		&task.AssigneeUserID,
		&task.AssigneeName,
		&assigneesJSON,
		&tagsJSON,
		&task.SortPosition,
		&task.TeamID,
		&task.ProjectID,
		&task.CreatedAt,
		&task.UpdatedAt,
		&task.Version,
		&deletedAt,
	)
	if err != nil {
		return model.Task{}, err
	}
	_ = json.Unmarshal([]byte(assigneesJSON), &task.Assignees)
	_ = json.Unmarshal([]byte(tagsJSON), &task.Tags)
	if task.Tags == nil {
		task.Tags = []string{}
	}
	if task.Assignees == nil {
		task.Assignees = []model.TaskAssignee{}
	}
	task.Status = model.TaskStatus(status)
	task.Priority = model.TaskPriority(priority)
	task.CompletedBy = strings.TrimSpace(completedBy)
	task.HydrateAssigneesFromLegacy()
	return task, nil
}
