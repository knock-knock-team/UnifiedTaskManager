## Local Run

Use local development compose with source-based builds:

```bash
cp .env.example .env
docker compose -f docker-compose.local.yml up --build -d
```

This file is tuned for local work:

- all app services are built from local sources with correct repository-root build context
- `pull_policy: never` is enabled for built services, so Docker does not pull remote images and does not trigger unnecessary network rebuild flow
- infra services (`postgres`, `rabbitmq`, `redis`, `coturn`) use published images as usual

Main local endpoints:

- Frontend: http://localhost:8080
- API Gateway: http://localhost:8081
- Chat-service: http://localhost:8084
- SFU: http://localhost:8086
- File-service: http://localhost:8088
- RabbitMQ UI: http://localhost:15672
- Grafana: http://localhost:3000 (`GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`, default `admin` / `admin`)
- Prometheus: http://localhost:9090
- Loki: http://localhost:3100

## Observability

The local and production compose stacks include a self-hosted observability stack:

- Prometheus scrapes `/metrics` from application services.
- Loki stores logs.
- Promtail reads Docker container logs and nginx log files.
- Grafana is provisioned with Prometheus and Loki datasources plus a starter dashboard.

Useful checks:

```bash
docker compose -f docker-compose.local.yml config
docker compose -f docker-compose.local.yml up -d prometheus loki promtail grafana
curl http://localhost:8081/metrics
```

In Grafana, query logs with labels such as `{service="api-gateway"}` or `{service="frontend"}`. Production Grafana is attached only to the internal compose network by default; use an SSH tunnel or add protected reverse-proxy access if you need browser access on the server.

Application services also emit structured `audit_event`, `security_event`, and `slow_http_request` logs. The slow request threshold is controlled by `SLOW_REQUEST_MS` (`750` by default, set `0` to disable).

## Production Compose

`docker-compose.yml` is registry-agnostic and defaults to GitLab Container Registry naming:

- image format: `${CI_REGISTRY_IMAGE}/<service>:${IMAGE_TAG}`
- fallback for standalone hosts: `registry.gitlab.com/knock-knock-team/unified-task-manager/<service>:${IMAGE_TAG}`
- `pull_policy: always` is used for app services, so deployment hosts always take the exact pushed tag

Production deploy is **automated with Ansible** from GitLab CI (see **`ansible/README.md`**). The job syncs `docker-compose.yml`, `deploy/nginx/default.conf`, renders `.env.production` from CI variables, then runs `docker compose --env-file .env.production pull` and `up`.

## GitLab CI/CD

Pipeline is fully moved to `.gitlab-ci.yml` with anti-rebuild rules:

- pipelines run for **Merge Request** events, **tags**, and manual `Run pipeline`
- test/build jobs are gated by `rules:changes`, so only affected services run
- Docker images are **built for validation in MR** (no push)
- Docker images are **built + pushed only on tags**
- **`deploy_production`** (manual on tag) runs **Ansible** from the tagged tree: copies compose + nginx, writes `.env.production`, registry login, `docker compose` pull/up

Required GitLab CI/CD variables for deploy are listed in **`ansible/README.md`** (SSH + secrets). Built-in `CI_REGISTRY_*` and `CI_COMMIT_TAG` are supplied by GitLab automatically.

## File Service API

`file-service` is available through API gateway under `/api/v1/file-environments`.

Implemented operations:

- auto-create storage environment per `team_id + project_id` scope
- add/remove members in environment
- create folder, upload file, delete file/folder
- download file and inline view file
- rename file or folder

Access model:

- only environment members can access its files
- users cannot create arbitrary standalone environments; environment is tied to team/project
- storage quota: 100MB total per team
- user existence checks are done through RabbitMQ RPC queue `user-service.user-exists`
- file deletion publishes event into RabbitMQ queue `task-service.file-deleted` so task-service can fix attached file links

```
unified-task-manager/
├── README.md
├── go.work
├── Makefile
├── .env
├── .gitignore
│
├── services/
│   ├── api-gateway/
│   │   ├── cmd/
│   │   │   └── main.go
│   │   ├── internal/
│   │   │   ├── handler/        # HTTP handlers
│   │   │   ├── middleware/     # auth, logging
│   │   │   ├── service/        # бизнес-логика (агрегация)
│   │   │   └── client/         # клиенты к другим сервисам
│   │   ├── api/
│   │   │   └── openapi.yaml    # OpenAPI (ВАЖНО)
│   │   ├── config/
│   │   │   └── config.go
│   │   ├── Dockerfile
│   │   └── go.mod
│   │
│   ├── task-service/
│   │   ├── cmd/
│   │   │   └── main.go
│   │   ├── internal/
│   │   │   ├── handler/        # REST/gRPC handlers
│   │   │   ├── service/        # бизнес-логика
│   │   │   ├── repository/     # работа с БД
│   │   │   ├── model/          # структуры (Task)
│   │   │   └── event/          # публикация событий (RabbitMQ)
│   │   ├── migrations/
│   │   ├── config/
│   │   ├── Dockerfile
│   │   └── go.mod
│   │
│   ├── user-service/
│   │   ├── cmd/
│   │   ├── internal/
│   │   │   ├── handler/
│   │   │   ├── service/
│   │   │   ├── repository/
│   │   │   └── model/
│   │   ├── migrations/
│   │   ├── config/
│   │   ├── Dockerfile
│   │   └── go.mod
│   │
│   ├── frontend/
│   │   ├── index.html
│   │   ├── styles.css
│   │   ├── app.js
│   │   ├── Dockerfile
│   │   └── .dockerignore
│   │
│   ├── automation-service/
│   │   ├── cmd/
│   │   ├── internal/
│   │   │   ├── consumer/
│   │   │   ├── rules/          # rules engine
│   │   │   └── service/
│   │   ├── config/
│   │   ├── Dockerfile
│   │   └── go.mod
│   │
│   │
│   ├── ml-service/             # Rust
│   │   ├── src/                # события TaskCreated
│   │   │                       # обработка задач
│   │   │                       # LLM API
│   │   ├── Cargo.toml
│   │   └── Dockerfile
│   │
│   └── graph-service/
│       ├── src/
│       │   ├── main.rs
│       │   ├── graph.rs
│       │   ├── queries.rs
│       │   └── consumer.rs
│       ├── Cargo.toml
│       └── Dockerfile
│
├── libs/
│   ├── go/
│   │   ├── logger/
│   │   ├── database/
│   │   ├── rabbitmq/
│   │   └── auth/
│   │
│   └── rust/
│       ├── common/
│       └── messaging/
│
├── proto/
│   ├── task.proto
│   ├── user.proto
│   └── common.proto
│
├── deploy/
│   ├── docker-compose.yml
│   ├── k8s/
│   │   ├── api-gateway.yaml
│   │   ├── task-service.yaml
│   │   └── ...
│   └── env/
│
└── docs/
    ├── architecture.md
    ├── api.md
    └── decisions/
```
