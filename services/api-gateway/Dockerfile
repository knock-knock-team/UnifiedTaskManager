FROM golang:1.24-alpine AS build
WORKDIR /app

# copy module files from repository root (CI builds with repo root as context)
COPY services/api-gateway/go.mod services/api-gateway/go.sum* ./
RUN go mod download

# copy service sources
COPY services/api-gateway .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o api-gateway ./cmd/main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /app/api-gateway /app/api-gateway
RUN chmod +x /app/api-gateway

EXPOSE 8081
ENTRYPOINT ["/app/api-gateway"]
