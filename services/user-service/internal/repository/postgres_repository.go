package repository

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"

	"unified-task-manager/services/user-service/internal/model"
)

type PostgresUserRepository struct {
	db *sql.DB
}

func (r *PostgresUserRepository) Ping(ctx context.Context) error {
	return r.db.PingContext(ctx)
}

func NewPostgresUserRepository(ctx context.Context, databaseURL string) (*PostgresUserRepository, error) {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}
	if err := db.PingContext(ctx); err != nil {
		return nil, err
	}
	return &PostgresUserRepository{db: db}, nil
}

func (r *PostgresUserRepository) EnsureSchema(ctx context.Context) error {
	const schema = `
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
	tag TEXT NOT NULL DEFAULT '',
	bio TEXT NOT NULL DEFAULT '',
	github_url TEXT NOT NULL DEFAULT '',
	linkedin_url TEXT NOT NULL DEFAULT '',
	telegram TEXT NOT NULL DEFAULT '',
	website_url TEXT NOT NULL DEFAULT '',
	secondary_email TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tag TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_url TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS linkedin_url TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS website_url TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS secondary_email TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tag_unique ON users(tag) WHERE tag <> '';
CREATE TABLE IF NOT EXISTS outbox_events (
	id UUID PRIMARY KEY,
	event_type TEXT NOT NULL,
	aggregate_type TEXT NOT NULL,
	aggregate_id TEXT NOT NULL,
	payload JSONB NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	attempt_count INT NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	dead_letter_reason TEXT NULL,
	next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	created_at TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL,
	published_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events(status);
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT NULL;

CREATE TABLE IF NOT EXISTS refresh_tokens (
	token_hash TEXT PRIMARY KEY,
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at TIMESTAMPTZ NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS user_teams (
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	team_id TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	PRIMARY KEY (user_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_user_teams_user_id ON user_teams(user_id);
CREATE INDEX IF NOT EXISTS idx_user_teams_team_id ON user_teams(team_id);

CREATE TABLE IF NOT EXISTS teams (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL,
	deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_teams_created_by ON teams(created_by);

CREATE TABLE IF NOT EXISTS team_roles (
	team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
	role_key TEXT NOT NULL,
	name TEXT NOT NULL,
	permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
	is_system BOOLEAN NOT NULL DEFAULT false,
	created_at TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL,
	PRIMARY KEY (team_id, role_key)
);
CREATE INDEX IF NOT EXISTS idx_team_roles_team_id ON team_roles(team_id);

CREATE TABLE IF NOT EXISTS team_members (
	team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role_key TEXT NOT NULL,
	invited_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
	joined_at TIMESTAMPTZ NOT NULL,
	created_at TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL,
	PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);

CREATE TABLE IF NOT EXISTS team_invites (
	id TEXT PRIMARY KEY,
	team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
	email TEXT NOT NULL,
	role_key TEXT NOT NULL,
	token_hash TEXT NOT NULL UNIQUE,
	status TEXT NOT NULL,
	invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	accepted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
	expires_at TIMESTAMPTZ NOT NULL,
	created_at TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_invites_team_id ON team_invites(team_id);
CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites(email);

CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL,
	deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_team_id ON projects(team_id);

CREATE TABLE IF NOT EXISTS project_roles (
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	role_key TEXT NOT NULL,
	name TEXT NOT NULL,
	permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
	inherit_team_role_key TEXT NOT NULL DEFAULT '',
	is_system BOOLEAN NOT NULL DEFAULT false,
	created_at TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL,
	PRIMARY KEY (project_id, role_key)
);
CREATE INDEX IF NOT EXISTS idx_project_roles_project_id ON project_roles(project_id);

CREATE TABLE IF NOT EXISTS project_members (
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role_key TEXT NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL,
	PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);
`
	_, err := r.db.ExecContext(ctx, schema)
	return err
}

func (r *PostgresUserRepository) Create(user model.User) (model.User, error) {
	const q = `
INSERT INTO users (id, email, password_hash, name, tag, bio, github_url, linkedin_url, telegram, website_url, secondary_email, role, status, created_at, updated_at, deleted_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`

	tx, err := r.db.BeginTx(context.Background(), nil)
	if err != nil {
		return model.User{}, err
	}
	defer func() { _ = tx.Rollback() }()

	_, err = tx.ExecContext(context.Background(), q,
		user.ID,
		strings.ToLower(user.Email),
		user.PasswordHash,
		user.Name,
		strings.ToLower(strings.TrimSpace(user.Tag)),
		user.Bio,
		user.GitHubURL,
		user.LinkedInURL,
		user.Telegram,
		user.WebsiteURL,
		strings.ToLower(strings.TrimSpace(user.SecondaryEmail)),
		string(user.Role),
		string(user.Status),
		user.CreatedAt,
		user.UpdatedAt,
		user.DeletedAt,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return model.User{}, ErrEmailConflict
		}
		return model.User{}, err
	}
	if err := insertOutboxEventTx(tx, "user.created", user); err != nil {
		return model.User{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.User{}, err
	}
	return user, nil
}

func (r *PostgresUserRepository) FindByID(id string) (model.User, error) {
	const q = `
SELECT id, email, password_hash, name, tag, bio, github_url, linkedin_url, telegram, website_url, secondary_email, role, status, created_at, updated_at, deleted_at
FROM users
WHERE id = $1 AND deleted_at IS NULL`

	user, err := scanUser(r.db.QueryRowContext(context.Background(), q, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	return user, nil
}

func (r *PostgresUserRepository) FindByEmail(email string) (model.User, error) {
	const q = `
SELECT id, email, password_hash, name, tag, bio, github_url, linkedin_url, telegram, website_url, secondary_email, role, status, created_at, updated_at, deleted_at
FROM users
WHERE email = $1 AND deleted_at IS NULL`

	user, err := scanUser(r.db.QueryRowContext(context.Background(), q, strings.ToLower(email)))
	if errors.Is(err, sql.ErrNoRows) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	return user, nil
}

func (r *PostgresUserRepository) FindByTag(tag string) (model.User, error) {
	const q = `
SELECT id, email, password_hash, name, tag, bio, github_url, linkedin_url, telegram, website_url, secondary_email, role, status, created_at, updated_at, deleted_at
FROM users
WHERE tag = $1 AND deleted_at IS NULL`

	user, err := scanUser(r.db.QueryRowContext(context.Background(), q, strings.ToLower(strings.TrimSpace(strings.TrimPrefix(tag, "@")))))
	if errors.Is(err, sql.ErrNoRows) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	return user, nil
}

func (r *PostgresUserRepository) Update(user model.User) (model.User, error) {
	const q = `
UPDATE users
SET email = $2,
    password_hash = $3,
    name = $4,
	tag = $5,
	bio = $6,
	github_url = $7,
	linkedin_url = $8,
	telegram = $9,
	website_url = $10,
	secondary_email = $11,
	role = $12,
	status = $13,
	updated_at = $14,
	deleted_at = $15
WHERE id = $1 AND deleted_at IS NULL`

	tx, err := r.db.BeginTx(context.Background(), nil)
	if err != nil {
		return model.User{}, err
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.ExecContext(context.Background(), q,
		user.ID,
		strings.ToLower(user.Email),
		user.PasswordHash,
		user.Name,
		strings.ToLower(strings.TrimSpace(user.Tag)),
		user.Bio,
		user.GitHubURL,
		user.LinkedInURL,
		user.Telegram,
		user.WebsiteURL,
		strings.ToLower(strings.TrimSpace(user.SecondaryEmail)),
		string(user.Role),
		string(user.Status),
		user.UpdatedAt,
		user.DeletedAt,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return model.User{}, ErrEmailConflict
		}
		return model.User{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return model.User{}, err
	}
	if affected == 0 {
		return model.User{}, ErrNotFound
	}
	if err := insertOutboxEventTx(tx, "user.updated", user); err != nil {
		return model.User{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.User{}, err
	}
	return user, nil
}

func (r *PostgresUserRepository) List(limit, offset int, search string) ([]model.User, int, error) {
	like := "%" + strings.ToLower(strings.TrimSpace(search)) + "%"
	if strings.TrimSpace(search) == "" {
		like = "%"
	}

	const totalQ = `
SELECT COUNT(*)
FROM users
WHERE deleted_at IS NULL AND (LOWER(name) LIKE $1 OR LOWER(email) LIKE $1 OR LOWER(tag) LIKE $1)`

	const listQ = `
SELECT id, email, password_hash, name, tag, bio, github_url, linkedin_url, telegram, website_url, secondary_email, role, status, created_at, updated_at, deleted_at
FROM users
WHERE deleted_at IS NULL AND (LOWER(name) LIKE $1 OR LOWER(email) LIKE $1 OR LOWER(tag) LIKE $1)
ORDER BY created_at DESC
LIMIT $2 OFFSET $3`

	var total int
	if err := r.db.QueryRowContext(context.Background(), totalQ, like).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := r.db.QueryContext(context.Background(), listQ, like, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]model.User, 0, limit)
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, user)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return items, total, nil
}

func (r *PostgresUserRepository) Delete(id string) error {
	const q = `
UPDATE users
SET deleted_at = NOW(), updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL`

	result, err := r.db.ExecContext(context.Background(), q, id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresUserRepository) FetchPendingOutbox(ctx context.Context, batchSize int) ([]OutboxMessage, error) {
	if batchSize <= 0 {
		batchSize = 100
	}

	const q = `
WITH candidate AS (
    SELECT id
    FROM outbox_events
    WHERE status = 'pending' AND next_attempt_at <= NOW()
    ORDER BY created_at
    LIMIT $1
    FOR UPDATE SKIP LOCKED
)
UPDATE outbox_events e
SET status = 'processing', updated_at = NOW()
FROM candidate c
WHERE e.id = c.id
RETURNING e.id, e.event_type, e.payload, e.attempt_count`

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, q, batchSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]OutboxMessage, 0, batchSize)
	for rows.Next() {
		var msg OutboxMessage
		if err := rows.Scan(&msg.ID, &msg.EventType, &msg.Payload, &msg.AttemptCount); err != nil {
			return nil, err
		}
		result = append(result, msg)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *PostgresUserRepository) MarkOutboxPublished(ctx context.Context, id string) error {
	const q = `
UPDATE outbox_events
SET status = 'published', published_at = NOW(), updated_at = NOW(), last_error = NULL
WHERE id = $1`

	_, err := r.db.ExecContext(ctx, q, id)
	return err
}

func (r *PostgresUserRepository) MarkOutboxFailed(ctx context.Context, id string, reason string, retryAfterSeconds int) error {
	if retryAfterSeconds < 1 {
		retryAfterSeconds = 1
	}

	const q = `
UPDATE outbox_events
SET status = 'pending',
    attempt_count = attempt_count + 1,
    last_error = $2,
    next_attempt_at = NOW() + ($3 * INTERVAL '1 second'),
    updated_at = NOW()
WHERE id = $1`

	_, err := r.db.ExecContext(ctx, q, id, reason, retryAfterSeconds)
	return err
}

func (r *PostgresUserRepository) MarkOutboxDead(ctx context.Context, id string, reason string) error {
	const q = `
UPDATE outbox_events
SET status = 'dead',
    dead_letter_reason = $2,
    last_error = $2,
    updated_at = NOW()
WHERE id = $1`

	_, err := r.db.ExecContext(ctx, q, id, reason)
	return err
}

func (r *PostgresUserRepository) GetOutboxStats(ctx context.Context) (pendingCount int, oldestPendingAgeSeconds float64, err error) {
	const q = `
SELECT
    COUNT(*) AS pending_count,
    COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))), 0) AS oldest_age_seconds
FROM outbox_events
WHERE status = 'pending'`

	err = r.db.QueryRowContext(ctx, q).Scan(&pendingCount, &oldestPendingAgeSeconds)
	return pendingCount, oldestPendingAgeSeconds, err
}

func (r *PostgresUserRepository) CleanupPublishedOutbox(ctx context.Context, olderThan time.Duration, batchSize int, archive bool) (int, int, error) {
	if olderThan <= 0 {
		olderThan = 7 * 24 * time.Hour
	}
	if batchSize <= 0 {
		batchSize = 500
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = tx.Rollback() }()

	if archive {
		const createArchive = `
CREATE TABLE IF NOT EXISTS outbox_events_archive (
	id UUID PRIMARY KEY,
	event_type TEXT NOT NULL,
	aggregate_type TEXT NOT NULL,
	aggregate_id TEXT NOT NULL,
	payload JSONB NOT NULL,
	status TEXT NOT NULL,
	attempt_count INT NOT NULL,
	last_error TEXT NULL,
	next_attempt_at TIMESTAMPTZ NOT NULL,
	created_at TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL,
	published_at TIMESTAMPTZ NULL,
	archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`
		if _, err := tx.ExecContext(ctx, createArchive); err != nil {
			return 0, 0, err
		}
	}

	const selectIDs = `
SELECT id
FROM outbox_events
WHERE status = 'published' AND published_at < NOW() - ($1 * INTERVAL '1 second')
ORDER BY published_at
LIMIT $2`

	rows, err := tx.QueryContext(ctx, selectIDs, int(olderThan.Seconds()), batchSize)
	if err != nil {
		return 0, 0, err
	}
	ids := make([]string, 0, batchSize)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()

	if len(ids) == 0 {
		if err := tx.Commit(); err != nil {
			return 0, 0, err
		}
		return 0, 0, nil
	}

	archivedCount := 0
	if archive {
		const archiveQ = `
INSERT INTO outbox_events_archive (
	id, event_type, aggregate_type, aggregate_id, payload, status,
	attempt_count, last_error, next_attempt_at, created_at, updated_at, published_at
)
SELECT
	id, event_type, aggregate_type, aggregate_id, payload, status,
	attempt_count, last_error, next_attempt_at, created_at, updated_at, published_at
FROM outbox_events
WHERE id = ANY($1::uuid[])
ON CONFLICT (id) DO NOTHING`
		if _, err := tx.ExecContext(ctx, archiveQ, ids); err != nil {
			return 0, 0, err
		}
		archivedCount = len(ids)
	}

	const deleteQ = `DELETE FROM outbox_events WHERE id = ANY($1::uuid[])`
	result, err := tx.ExecContext(ctx, deleteQ, ids)
	if err != nil {
		return 0, 0, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	if !archive {
		archivedCount = 0
	}
	return int(affected), archivedCount, nil
}

func (r *PostgresUserRepository) StoreRefreshToken(ctx context.Context, tokenHash, userID string, expiresAt time.Time) error {
	const q = `
INSERT INTO refresh_tokens (token_hash, user_id, expires_at, created_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (token_hash) DO UPDATE
SET user_id = EXCLUDED.user_id,
	expires_at = EXCLUDED.expires_at`

	_, err := r.db.ExecContext(ctx, q, tokenHash, userID, expiresAt.UTC())
	return err
}

func (r *PostgresUserRepository) RotateRefreshToken(ctx context.Context, oldTokenHash, newTokenHash, userID string, expiresAt time.Time) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	const lockQ = `
SELECT user_id, expires_at
FROM refresh_tokens
WHERE token_hash = $1
FOR UPDATE`

	var storedUserID string
	var storedExpiresAt time.Time
	if err := tx.QueryRowContext(ctx, lockQ, oldTokenHash).Scan(&storedUserID, &storedExpiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if storedUserID != userID || time.Now().UTC().After(storedExpiresAt) {
		return ErrNotFound
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM refresh_tokens WHERE token_hash = $1`, oldTokenHash); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO refresh_tokens (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, NOW())`, newTokenHash, userID, expiresAt.UTC()); err != nil {
		return err
	}

	return tx.Commit()
}

func (r *PostgresUserRepository) ListTeamIDsByUserID(ctx context.Context, userID string) ([]string, error) {
	const q = `
SELECT team_id
FROM user_teams
WHERE user_id = $1
ORDER BY team_id ASC`

	rows, err := r.db.QueryContext(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	teamIDs := make([]string, 0)
	for rows.Next() {
		var teamID string
		if err := rows.Scan(&teamID); err != nil {
			return nil, err
		}
		teamIDs = append(teamIDs, teamID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return teamIDs, nil
}

func (r *PostgresUserRepository) CreateTeam(ctx context.Context, team model.Team) (model.Team, error) {
	const q = `
INSERT INTO teams (id, name, created_by, created_at, updated_at, deleted_at)
VALUES ($1, $2, $3, $4, $5, NULL)`
	_, err := r.db.ExecContext(ctx, q, team.ID, team.Name, team.CreatedBy, team.CreatedAt, team.UpdatedAt)
	if err != nil {
		return model.Team{}, err
	}
	return team, nil
}

func (r *PostgresUserRepository) FindTeamByID(ctx context.Context, teamID string) (model.Team, error) {
	const q = `
SELECT id, name, created_by, created_at, updated_at
FROM teams
WHERE id = $1 AND deleted_at IS NULL`
	var team model.Team
	if err := r.db.QueryRowContext(ctx, q, teamID).Scan(&team.ID, &team.Name, &team.CreatedBy, &team.CreatedAt, &team.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.Team{}, ErrNotFound
		}
		return model.Team{}, err
	}
	return team, nil
}

func (r *PostgresUserRepository) ListTeamsByUserID(ctx context.Context, userID string) ([]model.Team, error) {
	const q = `
SELECT t.id, t.name, t.created_by, t.created_at, t.updated_at
FROM teams t
JOIN user_teams ut ON ut.team_id = t.id
WHERE ut.user_id = $1 AND t.deleted_at IS NULL
ORDER BY t.created_at DESC`

	rows, err := r.db.QueryContext(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.Team, 0)
	for rows.Next() {
		var t model.Team
		if err := rows.Scan(&t.ID, &t.Name, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresUserRepository) DeleteTeam(ctx context.Context, teamID string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	const markTeam = `
UPDATE teams
SET deleted_at = NOW(), updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL`
	res, err := tx.ExecContext(ctx, markTeam, teamID)
	if err != nil {
		return err
	}
	if rows, err := res.RowsAffected(); err != nil {
		return err
	} else if rows == 0 {
		return ErrNotFound
	}

	const markProjects = `
UPDATE projects
SET deleted_at = NOW(), updated_at = NOW()
WHERE team_id = $1 AND deleted_at IS NULL`
	if _, err := tx.ExecContext(ctx, markProjects, teamID); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}
	tx = nil
	return nil
}

func (r *PostgresUserRepository) CreateTeamRole(ctx context.Context, role model.TeamRole) (model.TeamRole, error) {
	const q = `
INSERT INTO team_roles (team_id, role_key, name, permissions, is_system, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (team_id, role_key) DO UPDATE
SET name = EXCLUDED.name,
	permissions = EXCLUDED.permissions,
	updated_at = EXCLUDED.updated_at`

	permissionsJSON, err := json.Marshal(role.Permissions)
	if err != nil {
		return model.TeamRole{}, err
	}
	_, err = r.db.ExecContext(ctx, q, role.TeamID, role.Key, role.Name, permissionsJSON, role.System, role.CreatedAt, role.UpdatedAt)
	if err != nil {
		return model.TeamRole{}, err
	}
	return role, nil
}

func (r *PostgresUserRepository) ListTeamRoles(ctx context.Context, teamID string) ([]model.TeamRole, error) {
	const q = `
SELECT team_id, role_key, name, permissions, is_system, created_at, updated_at
FROM team_roles
WHERE team_id = $1
ORDER BY is_system DESC, role_key ASC`

	rows, err := r.db.QueryContext(ctx, q, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.TeamRole, 0)
	for rows.Next() {
		var item model.TeamRole
		var permissionsRaw []byte
		if err := rows.Scan(&item.TeamID, &item.Key, &item.Name, &permissionsRaw, &item.System, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if len(permissionsRaw) > 0 {
			_ = json.Unmarshal(permissionsRaw, &item.Permissions)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresUserRepository) FindTeamRole(ctx context.Context, teamID, roleKey string) (model.TeamRole, error) {
	const q = `
SELECT team_id, role_key, name, permissions, is_system, created_at, updated_at
FROM team_roles
WHERE team_id = $1 AND role_key = $2`
	var item model.TeamRole
	var permissionsRaw []byte
	if err := r.db.QueryRowContext(ctx, q, teamID, roleKey).Scan(&item.TeamID, &item.Key, &item.Name, &permissionsRaw, &item.System, &item.CreatedAt, &item.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.TeamRole{}, ErrNotFound
		}
		return model.TeamRole{}, err
	}
	if len(permissionsRaw) > 0 {
		_ = json.Unmarshal(permissionsRaw, &item.Permissions)
	}
	return item, nil
}

func (r *PostgresUserRepository) UpsertTeamMember(ctx context.Context, member model.TeamMember) (model.TeamMember, error) {
	const q = `
INSERT INTO team_members (team_id, user_id, role_key, invited_by, joined_at, created_at, updated_at)
VALUES ($1, $2, $3, NULLIF($4, '')::uuid, $5, $6, $7)
ON CONFLICT (team_id, user_id) DO UPDATE
SET role_key = EXCLUDED.role_key,
	invited_by = EXCLUDED.invited_by,
	joined_at = EXCLUDED.joined_at,
	updated_at = EXCLUDED.updated_at`

	_, err := r.db.ExecContext(ctx, q, member.TeamID, member.UserID, member.RoleKey, member.InvitedBy, member.JoinedAt, member.CreatedAt, member.UpdatedAt)
	if err != nil {
		return model.TeamMember{}, err
	}
	return member, nil
}

func (r *PostgresUserRepository) FindTeamMember(ctx context.Context, teamID, userID string) (model.TeamMember, error) {
	const q = `
SELECT team_id, user_id, role_key, COALESCE(invited_by::text, ''), joined_at, created_at, updated_at
FROM team_members
WHERE team_id = $1 AND user_id = $2`
	var item model.TeamMember
	if err := r.db.QueryRowContext(ctx, q, teamID, userID).Scan(&item.TeamID, &item.UserID, &item.RoleKey, &item.InvitedBy, &item.JoinedAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.TeamMember{}, ErrNotFound
		}
		return model.TeamMember{}, err
	}
	return item, nil
}

func (r *PostgresUserRepository) ListTeamMembers(ctx context.Context, teamID string) ([]model.TeamMember, error) {
	const q = `
SELECT team_id, user_id, role_key, COALESCE(invited_by::text, ''), joined_at, created_at, updated_at
FROM team_members
WHERE team_id = $1
ORDER BY created_at ASC`

	rows, err := r.db.QueryContext(ctx, q, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.TeamMember, 0)
	for rows.Next() {
		var item model.TeamMember
		if err := rows.Scan(&item.TeamID, &item.UserID, &item.RoleKey, &item.InvitedBy, &item.JoinedAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresUserRepository) CreateTeamInvite(ctx context.Context, invite model.TeamInvite, tokenHash string) (model.TeamInvite, error) {
	const q = `
INSERT INTO team_invites (id, team_id, email, role_key, token_hash, status, invited_by, accepted_by, expires_at, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $10)`
	_, err := r.db.ExecContext(ctx, q, invite.ID, invite.TeamID, invite.Email, invite.RoleKey, tokenHash, invite.Status, invite.InvitedBy, invite.ExpiresAt, invite.CreatedAt, invite.UpdatedAt)
	if err != nil {
		return model.TeamInvite{}, err
	}
	return invite, nil
}

func (r *PostgresUserRepository) FindPendingInviteByTokenHash(ctx context.Context, tokenHash string) (model.TeamInvite, error) {
	const q = `
SELECT id, team_id, email, role_key, status, invited_by::text, expires_at, created_at, updated_at
FROM team_invites
WHERE token_hash = $1 AND status = 'pending'`

	var item model.TeamInvite
	if err := r.db.QueryRowContext(ctx, q, tokenHash).Scan(&item.ID, &item.TeamID, &item.Email, &item.RoleKey, &item.Status, &item.InvitedBy, &item.ExpiresAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.TeamInvite{}, ErrNotFound
		}
		return model.TeamInvite{}, err
	}
	return item, nil
}

func (r *PostgresUserRepository) FindTeamInviteByID(ctx context.Context, inviteID string) (model.TeamInvite, error) {
	const q = `
SELECT i.id, i.team_id, COALESCE(t.name, ''), i.email, i.role_key, i.status, i.invited_by::text, i.expires_at, i.created_at, i.updated_at
FROM team_invites i
LEFT JOIN teams t ON t.id = i.team_id
WHERE i.id = $1`

	var item model.TeamInvite
	if err := r.db.QueryRowContext(ctx, q, strings.TrimSpace(inviteID)).Scan(
		&item.ID,
		&item.TeamID,
		&item.TeamName,
		&item.Email,
		&item.RoleKey,
		&item.Status,
		&item.InvitedBy,
		&item.ExpiresAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.TeamInvite{}, ErrNotFound
		}
		return model.TeamInvite{}, err
	}
	return item, nil
}

func (r *PostgresUserRepository) ListPendingInvitesByEmail(ctx context.Context, email string) ([]model.TeamInvite, error) {
	const q = `
SELECT i.id, i.team_id, COALESCE(t.name, ''), i.email, i.role_key, i.status, i.invited_by::text, i.expires_at, i.created_at, i.updated_at
FROM team_invites i
LEFT JOIN teams t ON t.id = i.team_id
WHERE i.status = 'pending' AND LOWER(i.email) = LOWER($1)
ORDER BY i.created_at DESC`

	rows, err := r.db.QueryContext(ctx, q, strings.TrimSpace(email))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.TeamInvite, 0)
	for rows.Next() {
		var item model.TeamInvite
		if err := rows.Scan(
			&item.ID,
			&item.TeamID,
			&item.TeamName,
			&item.Email,
			&item.RoleKey,
			&item.Status,
			&item.InvitedBy,
			&item.ExpiresAt,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresUserRepository) MarkInviteAccepted(ctx context.Context, inviteID, acceptedBy string) error {
	const q = `
UPDATE team_invites
SET status = 'accepted',
	accepted_by = NULLIF($2, '')::uuid,
	updated_at = NOW()
WHERE id = $1 AND status = 'pending'`
	res, err := r.db.ExecContext(ctx, q, inviteID, acceptedBy)
	if err != nil {
		return err
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresUserRepository) EnsureUserTeamMembership(ctx context.Context, userID, teamID string) error {
	const q = `
INSERT INTO user_teams (user_id, team_id, created_at)
VALUES ($1, $2, NOW())
ON CONFLICT (user_id, team_id) DO NOTHING`
	_, err := r.db.ExecContext(ctx, q, userID, teamID)
	return err
}

func (r *PostgresUserRepository) CreateProject(ctx context.Context, project model.Project) (model.Project, error) {
	const q = `
INSERT INTO projects (id, team_id, name, created_by, created_at, updated_at, deleted_at)
VALUES ($1, $2, $3, $4, $5, $6, NULL)`
	_, err := r.db.ExecContext(ctx, q, project.ID, project.TeamID, project.Name, project.CreatedBy, project.CreatedAt, project.UpdatedAt)
	if err != nil {
		return model.Project{}, err
	}
	return project, nil
}

func (r *PostgresUserRepository) ListProjectsByTeamID(ctx context.Context, teamID string) ([]model.Project, error) {
	const q = `
SELECT id, team_id, name, created_by::text, created_at, updated_at
FROM projects
WHERE team_id = $1 AND deleted_at IS NULL
ORDER BY created_at DESC`

	rows, err := r.db.QueryContext(ctx, q, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.Project, 0)
	for rows.Next() {
		var item model.Project
		if err := rows.Scan(&item.ID, &item.TeamID, &item.Name, &item.CreatedBy, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresUserRepository) FindProjectByID(ctx context.Context, projectID string) (model.Project, error) {
	const q = `
SELECT id, team_id, name, created_by::text, created_at, updated_at
FROM projects
WHERE id = $1 AND deleted_at IS NULL`
	var item model.Project
	if err := r.db.QueryRowContext(ctx, q, projectID).Scan(&item.ID, &item.TeamID, &item.Name, &item.CreatedBy, &item.CreatedAt, &item.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.Project{}, ErrNotFound
		}
		return model.Project{}, err
	}
	return item, nil
}

func (r *PostgresUserRepository) DeleteProject(ctx context.Context, projectID string) error {
	const q = `
UPDATE projects
SET deleted_at = NOW(), updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL`
	res, err := r.db.ExecContext(ctx, q, projectID)
	if err != nil {
		return err
	}
	if rows, err := res.RowsAffected(); err != nil {
		return err
	} else if rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresUserRepository) CreateProjectRole(ctx context.Context, role model.ProjectRole) (model.ProjectRole, error) {
	const q = `
INSERT INTO project_roles (project_id, role_key, name, permissions, inherit_team_role_key, is_system, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (project_id, role_key) DO UPDATE
SET name = EXCLUDED.name,
	permissions = EXCLUDED.permissions,
	inherit_team_role_key = EXCLUDED.inherit_team_role_key,
	updated_at = EXCLUDED.updated_at`

	permissionsJSON, err := json.Marshal(role.Permissions)
	if err != nil {
		return model.ProjectRole{}, err
	}
	_, err = r.db.ExecContext(ctx, q, role.ProjectID, role.Key, role.Name, permissionsJSON, role.InheritTeamRoleKey, role.System, role.CreatedAt, role.UpdatedAt)
	if err != nil {
		return model.ProjectRole{}, err
	}
	return role, nil
}

func (r *PostgresUserRepository) ListProjectRoles(ctx context.Context, projectID string) ([]model.ProjectRole, error) {
	const q = `
SELECT project_id, role_key, name, permissions, inherit_team_role_key, is_system, created_at, updated_at
FROM project_roles
WHERE project_id = $1
ORDER BY is_system DESC, role_key ASC`

	rows, err := r.db.QueryContext(ctx, q, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.ProjectRole, 0)
	for rows.Next() {
		var item model.ProjectRole
		var permissionsRaw []byte
		if err := rows.Scan(&item.ProjectID, &item.Key, &item.Name, &permissionsRaw, &item.InheritTeamRoleKey, &item.System, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if len(permissionsRaw) > 0 {
			_ = json.Unmarshal(permissionsRaw, &item.Permissions)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresUserRepository) FindProjectRole(ctx context.Context, projectID, roleKey string) (model.ProjectRole, error) {
	const q = `
SELECT project_id, role_key, name, permissions, inherit_team_role_key, is_system, created_at, updated_at
FROM project_roles
WHERE project_id = $1 AND role_key = $2`
	var item model.ProjectRole
	var permissionsRaw []byte
	if err := r.db.QueryRowContext(ctx, q, projectID, roleKey).Scan(&item.ProjectID, &item.Key, &item.Name, &permissionsRaw, &item.InheritTeamRoleKey, &item.System, &item.CreatedAt, &item.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.ProjectRole{}, ErrNotFound
		}
		return model.ProjectRole{}, err
	}
	if len(permissionsRaw) > 0 {
		_ = json.Unmarshal(permissionsRaw, &item.Permissions)
	}
	return item, nil
}

func (r *PostgresUserRepository) UpsertProjectMember(ctx context.Context, member model.ProjectMember) (model.ProjectMember, error) {
	const q = `
INSERT INTO project_members (project_id, user_id, role_key, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (project_id, user_id) DO UPDATE
SET role_key = EXCLUDED.role_key,
	updated_at = EXCLUDED.updated_at`
	_, err := r.db.ExecContext(ctx, q, member.ProjectID, member.UserID, member.RoleKey, member.CreatedAt, member.UpdatedAt)
	if err != nil {
		return model.ProjectMember{}, err
	}
	return member, nil
}

func (r *PostgresUserRepository) FindProjectMember(ctx context.Context, projectID, userID string) (model.ProjectMember, error) {
	const q = `
SELECT project_id, user_id::text, role_key, created_at, updated_at
FROM project_members
WHERE project_id = $1 AND user_id = $2`
	var item model.ProjectMember
	if err := r.db.QueryRowContext(ctx, q, projectID, userID).Scan(&item.ProjectID, &item.UserID, &item.RoleKey, &item.CreatedAt, &item.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.ProjectMember{}, ErrNotFound
		}
		return model.ProjectMember{}, err
	}
	return item, nil
}

func (r *PostgresUserRepository) ListProjectMembers(ctx context.Context, projectID string) ([]model.ProjectMember, error) {
	const q = `
SELECT project_id, user_id::text, role_key, created_at, updated_at
FROM project_members
WHERE project_id = $1
ORDER BY created_at ASC`

	rows, err := r.db.QueryContext(ctx, q, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.ProjectMember, 0)
	for rows.Next() {
		var item model.ProjectMember
		if err := rows.Scan(&item.ProjectID, &item.UserID, &item.RoleKey, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

type scanner interface {
	Scan(dest ...interface{}) error
}

func scanUser(row scanner) (model.User, error) {
	var user model.User
	var role string
	var status string
	err := row.Scan(
		&user.ID,
		&user.Email,
		&user.PasswordHash,
		&user.Name,
		&user.Tag,
		&user.Bio,
		&user.GitHubURL,
		&user.LinkedInURL,
		&user.Telegram,
		&user.WebsiteURL,
		&user.SecondaryEmail,
		&role,
		&status,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.DeletedAt,
	)
	if err != nil {
		return model.User{}, err
	}
	user.Role = model.Role(role)
	user.Status = model.Status(status)
	return user, nil
}

func insertOutboxEventTx(tx *sql.Tx, eventType string, user model.User) error {
	const q = `
INSERT INTO outbox_events (
    id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload,
    status,
    attempt_count,
    next_attempt_at,
    created_at,
    updated_at
) VALUES ($1, $2, 'user', $3, $4, 'pending', 0, NOW(), $5, $5)`

	cleanUser := user
	cleanUser.PasswordHash = ""
	payload := map[string]interface{}{
		"eventType":  eventType,
		"occurredAt": time.Now().UTC(),
		"user":       cleanUser,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	_, err = tx.ExecContext(context.Background(), q, newUUIDv4(), eventType, user.ID, body, now)
	return err
}

func newUUIDv4() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80
	full := hex.EncodeToString(buf)
	return full[0:8] + "-" + full[8:12] + "-" + full[12:16] + "-" + full[16:20] + "-" + full[20:32]
}
