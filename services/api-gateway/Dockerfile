FROM golang:1.22-alpine AS build
WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o api-gateway ./cmd/main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /app/api-gateway /app/api-gateway
RUN chmod +x /app/api-gateway

EXPOSE 8081
ENTRYPOINT ["/app/api-gateway"]
