FROM golang:1.22-alpine AS build
WORKDIR /app

COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o user-service ./cmd/main.go

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=build /app/user-service /app/user-service

EXPOSE 8082
ENTRYPOINT ["/app/user-service"]
