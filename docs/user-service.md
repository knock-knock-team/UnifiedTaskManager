# User Service

## What was implemented

A production-style MVP user-service in Go was added under `services/user-service` with layered architecture:

- `cmd/main.go` - application entry point
- `internal/config` - environment-based configuration
- `internal/model` - domain models
- `internal/repository` - data access interface + PostgreSQL + in-memory implementation
- `internal/service` - business logic (auth, RBAC checks, profile/user operations)
- `internal/handler` - HTTP handlers and auth middleware
- `migrations` - initial SQL schema draft
- `Dockerfile` - container image build

## API

Base URL: `http://localhost:8082`

### Health

- `GET /healthz`
- `GET /readyz` (checks database availability)
- `GET /metrics` (Prometheus metrics)

### Auth

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`

### User profile

- `GET /v1/users/me`
- `PATCH /v1/users/me`

### Admin user management

- `GET /v1/users`
- `GET /v1/users/{userId}`
- `PATCH /v1/users/{userId}`
- `DELETE /v1/users/{userId}`

### Operational admin endpoints

- `POST /internal/admin/outbox/flush`
- `POST /internal/admin/outbox/clean`

Protection:

- admin JWT role
- `X-Admin-Ops-Token` header (`ADMIN_OPS_TOKEN`)

## Auth model

- JWT Bearer authentication (HS256)
- Access token and refresh token pair
- Access token carries subject (`sub`) and role (`role`)
- Endpoints under `/v1/users*` require `Authorization: Bearer <access-token>`

Implementation details:

- Token signing is implemented with Go standard library (HMAC-SHA256).
- Password hashing is implemented with Argon2id.

## RBAC

- `admin` role can list/update/delete arbitrary users
- Regular users can only use `/v1/users/me`

## Data model

User fields:

- `id` (UUID)
- `email`
- `passwordHash` (stored hashed)
- `name`
- `role` (`user|manager|admin`)
- `status` (`active|inactive|suspended`)
- `createdAt`, `updatedAt`, `deletedAt`

## Notes for next iteration

PostgreSQL repository is the default production path. In-memory repository is kept for fast tests and local sandbox runs.

Bootstrap admin is supported via env variables to make admin-only endpoints usable from first startup.

## Configuration (important)

- `DATABASE_URL` - PostgreSQL DSN
- `AUTO_MIGRATE` - auto apply base schema on startup
- `USE_IN_MEMORY` - force in-memory repository for tests/local debug
- `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_NAME`
- `RABBITMQ_ENABLED`, `RABBITMQ_URL`, `RABBITMQ_EXCHANGE`
- `OUTBOX_CLEANER_ENABLED`, `OUTBOX_ARCHIVE_ENABLED`
- `OUTBOX_RETENTION_DAYS`, `OUTBOX_CLEANUP_INTERVAL_SECONDS`, `OUTBOX_CLEANUP_BATCH_SIZE`
- `OUTBOX_MAX_ATTEMPTS` (DLQ threshold)
- `ADMIN_OPS_TOKEN` (operational endpoint protection)
- `CORS_ALLOW_ORIGIN` (frontend/browser origin allow-list, default `*`)

The service auto-loads root `.env` for local development.

Frontend service:

- `services/frontend` contains a browser UI integrated with user-service API.

## Test coverage

Implemented tests include:

1. Unit tests for service layer (`register/login`, RBAC rules, bootstrap admin).
2. Integration tests for HTTP API (`auth/RBAC/CRUD`) using `httptest`.
3. PostgreSQL integration test against real DB container (`TestPostgresRepositoryIntegrationCRUD`).

## CI integration profile (containerized)

Workflow: `.github/workflows/user-service-integration.yml`

What it does:

1. Starts PostgreSQL and RabbitMQ as CI service containers.
2. Runs regular test suite for user-service.
3. Runs repository integration test with real PostgreSQL.

Local equivalent profile:

- `services/user-service/docker-compose.integration.yml`

## Transactional outbox (guaranteed delivery pattern)

The service now uses transactional outbox for user domain events:

1. User write (`create`/`update`) and outbox event insert are in one DB transaction.
2. Events are stored in `outbox_events` with `pending` status.
3. Background outbox worker fetches pending rows, publishes to RabbitMQ, marks rows as `published`.
4. Failed publish attempts are retried with exponential backoff.
5. Cleaner worker archives/deletes published events older than retention window.

Cleaner behavior:

- archive old published events into `outbox_events_archive` (optional)
- delete archived/published events in batches
- configured by outbox cleaner env variables

This removes the risk of "DB commit succeeded but Rabbit publish failed" inconsistency.

Published routing keys:

- `user.created`
- `user.updated`

DLQ behavior:

- events that fail publishing repeatedly are moved to `dead` status after `OUTBOX_MAX_ATTEMPTS`
- reason is stored in `dead_letter_reason`

## Prometheus metrics

Endpoint:

- `GET /metrics`

Outbox metrics:

- `user_service_outbox_pending_count`
- `user_service_outbox_oldest_pending_age_seconds`
- `user_service_outbox_publish_retries_total`
- `user_service_outbox_published_total`
- `user_service_outbox_dead_letter_total`
- `user_service_outbox_cleaner_deleted_total`
- `user_service_outbox_cleaner_archived_total`
- `user_service_outbox_cleaner_run_errors_total`

Recommended immediate improvements:

1. Add dedicated migration tool integration (goose/atlas) for versioned schema rollout.
2. Add request/response validation package-level helpers.
3. Add tracing and structured logging.
4. Emit domain events (e.g. `UserCreated`, `UserUpdated`) to RabbitMQ.
5. Add dead-letter policy and poison-event quarantine for permanent failures.
