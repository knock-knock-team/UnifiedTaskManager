FROM golang:1.24-alpine AS build
WORKDIR /app

COPY services/task-service/go.mod services/task-service/go.sum* ./
RUN go mod download

COPY services/task-service .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o task-service ./cmd/main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /app/task-service /app/task-service
RUN chmod +x /app/task-service

EXPOSE 8083
ENTRYPOINT ["/app/task-service"]
