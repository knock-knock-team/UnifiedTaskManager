## Local Run (Current Working Stack)

Use Docker Compose to start frontend + user-service + postgres + rabbitmq:

```bash
docker compose up --build -d
```

Then check:

- Frontend: http://localhost:8080
- User-service health: http://localhost:8082/healthz
- User-service readiness: http://localhost:8082/readyz
- User-service metrics: http://localhost:8082/metrics
- RabbitMQ UI: http://localhost:15672 (`guest / guest`)

Stop stack:

```bash
docker compose down
```

---

# Project Structure

```text
UnifiedTaskManager/
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
│   │   │   ├── handler/
│   │   │   ├── middleware/
│   │   │   ├── service/
│   │   │   └── client/
│   │   ├── api/
│   │   │   └── openapi.yaml
│   │   ├── config/
│   │   │   └── config.go
│   │   ├── Dockerfile
│   │   └── go.mod
│   │
│   ├── task-service/
│   │   ├── cmd/
│   │   │   └── main.go
│   │   ├── internal/
│   │   │   ├── handler/
│   │   │   ├── service/
│   │   │   ├── repository/
│   │   │   ├── model/
│   │   │   └── event/
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
│   ├── notification-service/
│   │   ├── cmd/
│   │   ├── internal/
│   │   │   ├── consumer/
│   │   │   ├── service/
│   │   │   └── sender/
│   │   ├── config/
│   │   ├── Dockerfile
│   │   └── go.mod
│   │
│   ├── automation-service/
│   │   ├── cmd/
│   │   ├── internal/
│   │   │   ├── consumer/
│   │   │   ├── rules/
│   │   │   └── service/
│   │   ├── config/
│   │   ├── Dockerfile
│   │   └── go.mod
│   │
│   ├── ml-service/
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── events.rs
│   │   │   ├── llm.rs
│   │   │   └── processor.rs
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