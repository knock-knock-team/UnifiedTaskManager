# UnifiedTaskManager

Система управления задачами с AI-ассистентом и интеграцией GigaChat.

## Возможности

- создание команд и проектов для управления задачами;
- автодополнение и встроенный AI-агент на основе GigaChat;
- полная статистика по участникам проекта;
- автоматические уведомления по дедлайнам;
- интегрированное файловое пространство для каждого проекта;
- аудиоконференции;
- диалоги и групповые чаты.

## Локальный запуск

Для полного использования функционала сервиса необходимо получить пароль приложения для почты(например, Яндекс почта), а также API-ключ от модели(например, GigaChat).

```bash
cp .env.example .env
docker compose -f docker-compose.local.yml up --build -d
```

Основные эндпоинты:

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
