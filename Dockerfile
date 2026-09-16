# syntax=docker/dockerfile:1.7

FROM rust:1.95-bookworm AS rust-builder

ENV CARGO_TARGET_DIR=/opt/cargo-target
WORKDIR /build

COPY externalservices/market-server ./externalservices/market-server
COPY tools/market-seed ./tools/market-seed
COPY tools/market-seederv2 ./tools/market-seederv2

RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/opt/cargo-target,sharing=locked \
    cargo build --locked --release \
      --manifest-path externalservices/market-server/Cargo.toml \
 && cargo build --locked --release \
      --manifest-path tools/market-seed/Cargo.toml \
 && cargo build --locked --release \
      --manifest-path tools/market-seederv2/Cargo.toml \
 && install -D /opt/cargo-target/release/market-server /opt/artifacts/market-server \
 && install -D /opt/cargo-target/release/market-seed /opt/artifacts/market-seed \
 && install -D /opt/cargo-target/release/market-seederv2 /opt/artifacts/market-seederv2


FROM node:24-bookworm-slim AS node-dependencies

RUN apt-get update \
 && apt-get install --yes --no-install-recommends g++ make python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev


FROM node:24-bookworm-slim AS typescript-builder

WORKDIR /app
COPY package.json package-lock.json ./
# Source is copied next, so skip postinstall and build the production targets explicitly.
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --include=dev --ignore-scripts
COPY . .
RUN --mount=type=cache,target=/app/node_modules/.cache/typescript,sharing=locked \
    npm run build:production \
 && npm prune --omit=dev --ignore-scripts


FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates curl tini unzip \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=typescript-builder --chown=node:node /app/ ./
COPY --from=node-dependencies --chown=node:node /app/server/node_modules ./server/node_modules
COPY --from=rust-builder /opt/artifacts/market-server /usr/local/bin/market-server
COPY --from=rust-builder /opt/artifacts/market-seed /usr/local/bin/market-seed
COPY --from=rust-builder /opt/artifacts/market-seederv2 /usr/local/bin/market-seederv2

RUN mkdir -p /var/lib/evejs \
 && chmod +x /app/docker/entrypoint.sh \
 && chown -R node:node /var/lib/evejs

ENV NODE_ENV=production \
    EVEJS_DATA_ROOT=/var/lib/evejs \
    EVEJS_GAMESTORE_DATA_DIR=/var/lib/evejs/gameStore/data \
    EVEJS_GAME_SERVER_BIND_HOST=0.0.0.0 \
    EVEJS_IMAGE_SERVER_BIND_HOST=0.0.0.0 \
    EVEJS_MICROSERVICES_BIND_HOST=0.0.0.0 \
    EVEJS_PROXY_LOCAL_INTERCEPT=1 \
    EVEJS_PROXY_LOOPBACK_CDN_LISTEN_PORT=26003 \
    EVEJS_REDSHIFT_MONITOR_HOST=0.0.0.0 \
    EVEJS_XMPP_SERVER_BIND_HOST=0.0.0.0

VOLUME ["/var/lib/evejs"]

EXPOSE 5222 26000 26001 26002 26003 26400 40110 40111

USER node

ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/app/docker/entrypoint.sh"]
CMD ["all"]
