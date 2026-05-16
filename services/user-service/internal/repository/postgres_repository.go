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

	"UnifiedTaskManager/services/user-service/internal/model"
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
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_url TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS linkedin_url TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS website_url TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS secondary_email TEXT NOT NULL DEFAULT '';
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
`
	_, err := r.db.ExecContext(ctx, schema)
	return err
}

func (r *PostgresUserRepository) Create(user model.User) (model.User, error) {
	const q = `
INSERT INTO users (id, email, password_hash, name, bio, github_url, linkedin_url, telegram, website_url, secondary_email, role, status, created_at, updated_at, deleted_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`

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
SELECT id, email, password_hash, name, bio, github_url, linkedin_url, telegram, website_url, secondary_email, role, status, created_at, updated_at, deleted_at
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
SELECT id, email, password_hash, name, bio, github_url, linkedin_url, telegram, website_url, secondary_email, role, status, created_at, updated_at, deleted_at
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

func (r *PostgresUserRepository) Update(user model.User) (model.User, error) {
	const q = `
UPDATE users
SET email = $2,
    password_hash = $3,
    name = $4,
	bio = $5,
	github_url = $6,
	linkedin_url = $7,
	telegram = $8,
	website_url = $9,
	secondary_email = $10,
	role = $11,
	status = $12,
	updated_at = $13,
	deleted_at = $14
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
WHERE deleted_at IS NULL AND (LOWER(name) LIKE $1 OR LOWER(email) LIKE $1)`

	const listQ = `
SELECT id, email, password_hash, name, bio, github_url, linkedin_url, telegram, website_url, secondary_email, role, status, created_at, updated_at, deleted_at
FROM users
WHERE deleted_at IS NULL AND (LOWER(name) LIKE $1 OR LOWER(email) LIKE $1)
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
