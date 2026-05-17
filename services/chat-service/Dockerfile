FROM rust:1.88-alpine AS builder

RUN apk add --no-cache musl-dev pkgconfig openssl-dev

WORKDIR /app/services/chat-service

COPY libs/mq-rust /app/libs/mq-rust
COPY services/chat-service/Cargo.toml services/chat-service/Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs

RUN cargo build --release
RUN rm -rf src

COPY services/chat-service .

RUN cargo build --release


FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /app/services/chat-service/target/release/chat-service /app/chat-service

COPY --from=builder /app/services/chat-service/migrations /app/migrations

ENV RUST_LOG=info

EXPOSE 8084

CMD ["./chat-service"]