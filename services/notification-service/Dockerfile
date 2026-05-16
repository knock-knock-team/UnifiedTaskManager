FROM golang:1.24-alpine AS build
WORKDIR /app

COPY services/notification-service/go.mod services/notification-service/go.sum* ./
RUN go mod download

COPY services/notification-service .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o notification-service ./cmd/main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /app/notification-service /app/notification-service
RUN chmod +x /app/notification-service

EXPOSE 8089
ENTRYPOINT ["/app/notification-service"]
