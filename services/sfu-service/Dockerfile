FROM golang:1.24-alpine AS builder
WORKDIR /build

# Copy service sources
COPY services/sfu-service .

RUN apk add --no-cache git ca-certificates \
 && go mod tidy \
 && CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o /sfu ./cmd/main.go

FROM alpine:3.18
RUN apk add --no-cache ca-certificates
COPY --from=builder /sfu /usr/local/bin/sfu
EXPOSE 8086
ENTRYPOINT ["/usr/local/bin/sfu"]
