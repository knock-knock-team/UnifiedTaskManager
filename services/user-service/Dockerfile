FROM golang:1.24-alpine AS build
WORKDIR /workspace/services/user-service

# copy module files from repository root (CI builds with repo root as context)
COPY services/user-service/go.mod services/user-service/go.sum* ./
COPY libs/observability-go/go.mod libs/observability-go/go.sum* /workspace/libs/observability-go/
RUN go mod download

# copy service sources
COPY services/user-service /workspace/services/user-service
COPY libs/observability-go /workspace/libs/observability-go
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /workspace/user-service ./cmd/main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /workspace/user-service /app/user-service
RUN chmod +x /app/user-service

EXPOSE 8082
ENTRYPOINT ["/app/user-service"]
