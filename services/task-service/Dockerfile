FROM golang:1.22-alpine AS build
WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o task-service ./cmd/main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /app/task-service /app/task-service
RUN chmod +x /app/task-service

EXPOSE 8083
ENTRYPOINT ["/app/task-service"]
