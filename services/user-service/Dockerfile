FROM golang:1.24-alpine AS build
WORKDIR /app

COPY services/user-service/go.mod services/user-service/go.sum* ./
RUN go mod download

COPY services/user-service .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o user-service ./cmd/main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /app/user-service /app/user-service
RUN chmod +x /app/user-service

EXPOSE 8082
ENTRYPOINT ["/app/user-service"]
