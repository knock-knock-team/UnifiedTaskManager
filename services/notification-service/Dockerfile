FROM golang:1.24-alpine AS build
WORKDIR /workspace/services/notification-service

COPY services/notification-service/go.mod services/notification-service/go.sum* ./
COPY libs/observability-go/go.mod libs/observability-go/go.sum* /workspace/libs/observability-go/
RUN go mod download

COPY services/notification-service /workspace/services/notification-service
COPY libs/observability-go /workspace/libs/observability-go
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /workspace/notification-service ./cmd/main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /workspace/notification-service /app/notification-service
RUN chmod +x /app/notification-service

EXPOSE 8089
ENTRYPOINT ["/app/notification-service"]
