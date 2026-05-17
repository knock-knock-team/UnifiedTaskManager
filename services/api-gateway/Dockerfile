FROM golang:1.24-alpine AS build
WORKDIR /workspace/services/api-gateway

# copy module files from repository root (CI builds with repo root as context)
COPY services/api-gateway/go.mod services/api-gateway/go.sum* ./
COPY libs/observability-go/go.mod libs/observability-go/go.sum* /workspace/libs/observability-go/
RUN go mod download

# copy service sources
COPY services/api-gateway /workspace/services/api-gateway
COPY libs/observability-go /workspace/libs/observability-go
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /workspace/api-gateway ./cmd/main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /workspace/api-gateway /app/api-gateway
RUN chmod +x /app/api-gateway

EXPOSE 8081
ENTRYPOINT ["/app/api-gateway"]
