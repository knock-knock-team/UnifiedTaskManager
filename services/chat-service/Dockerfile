FROM rust:1.85-alpine AS builder

RUN apk add --no-cache musl-dev pkgconfig openssl-dev

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs

RUN cargo build --release
RUN rm -rf src

COPY . .

RUN cargo build --release


FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /app/target/release/chat-service /app/chat-service

COPY --from=builder /app/migrations /app/migrations

ENV RUST_LOG=info

EXPOSE 8084

CMD ["./chat-service"]