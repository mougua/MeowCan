FROM rust:1.90-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN useradd --system --create-home --uid 10001 meowcan
COPY --from=builder /app/target/release/meowcan-server /usr/local/bin/meowcan-server
USER meowcan
ENV MEOWCAN_BIND=0.0.0.0:8080 \
    MEOWCAN_COOKIE_SECURE=true
EXPOSE 8080
ENTRYPOINT ["meowcan-server"]
