FROM golang:1.24-alpine AS build
WORKDIR /workspace/services/task-service

# Preserve repository layout so local replace paths keep working in Docker.
COPY services/task-service/go.mod services/task-service/go.sum* ./
COPY libs/mq-go/go.mod /workspace/libs/mq-go/go.mod
COPY libs/observability-go/go.mod libs/observability-go/go.sum* /workspace/libs/observability-go/
RUN go mod download

# copy service and local shared module sources
COPY services/task-service /workspace/services/task-service
COPY libs/mq-go /workspace/libs/mq-go
COPY libs/observability-go /workspace/libs/observability-go
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /workspace/task-service ./cmd/main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /workspace/task-service /app/task-service
RUN chmod +x /app/task-service

EXPOSE 8083
ENTRYPOINT ["/app/task-service"]
