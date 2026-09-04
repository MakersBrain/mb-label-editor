# syntax=docker/dockerfile:1.10
FROM node:22-bookworm AS build

ENV PATH=/root/.cargo/bin:/workspace/mb-printer-sdk/.tools/wasm-bindgen/bin:$PATH
RUN apt-get update \
    && apt-get install --yes --no-install-recommends build-essential ca-certificates curl perl pkg-config python3 \
    && rm -rf /var/lib/apt/lists/* \
    && curl --proto '=https' --tlsv1.2 --fail --silent --show-error https://sh.rustup.rs \
      | sh -s -- -y --default-toolchain 1.98.0 --target wasm32-unknown-unknown
ARG TARGETARCH
ARG SCCACHE_VERSION=0.17.0
RUN case "$TARGETARCH" in \
      amd64) target=x86_64-unknown-linux-musl; sha256=67c4a96dd237c1f518f6b36083f270f9976d516f1e57fce891755ea782e50006 ;; \
      arm64) target=aarch64-unknown-linux-musl; sha256=821a86343191aa1cbab74bd42f9e93c9a63bf85e4742945f40d3ae84193c1c77 ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && archive="sccache-v${SCCACHE_VERSION}-${target}.tar.gz" \
    && curl -fsSLo "/tmp/$archive" \
       "https://github.com/mozilla/sccache/releases/download/v${SCCACHE_VERSION}/$archive" \
    && echo "$sha256  /tmp/$archive" | sha256sum -c - \
    && tar -xzf "/tmp/$archive" --strip-components=1 -C /usr/local/bin \
       "sccache-v${SCCACHE_VERSION}-${target}/sccache" \
    && rm -f "/tmp/$archive"
ARG RUSTC_WRAPPER
ARG SCCACHE_BUCKET
ARG SCCACHE_ENDPOINT
ARG SCCACHE_REGION=auto
ARG SCCACHE_PREFIX=rust-v1

WORKDIR /workspace
COPY mb-printer-sdk ./mb-printer-sdk
# The SDK build script stamps this commit into its buildInfo() export when no git repository is present.
ARG MB_SDK_GIT_COMMIT=
ENV MB_SDK_GIT_COMMIT=$MB_SDK_GIT_COMMIT
WORKDIR /workspace/mb-printer-sdk/crates/mb-printer-wasm
RUN --mount=type=secret,id=aws_access_key_id,env=AWS_ACCESS_KEY_ID \
    --mount=type=secret,id=aws_secret_access_key,env=AWS_SECRET_ACCESS_KEY \
    --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/workspace/mb-printer-sdk/target \
    export RUSTC_WRAPPER SCCACHE_BUCKET SCCACHE_ENDPOINT SCCACHE_REGION \
           SCCACHE_S3_USE_SSL=true SCCACHE_S3_KEY_PREFIX="$SCCACHE_PREFIX" \
           SCCACHE_BASEDIRS=/workspace:/root/.cargo/registry \
    && npm ci --no-audit --no-fund && npm run build

WORKDIR /workspace
COPY mb-ui ./mb-ui
# Install from the manifests alone so source edits do not invalidate the npm layer.
COPY mb-label-editor/package.json mb-label-editor/package-lock.json ./mb-label-editor/
COPY mb-label-editor/packages/label-editor/package.json ./mb-label-editor/packages/label-editor/
COPY mb-label-editor/apps/pwa/package.json ./mb-label-editor/apps/pwa/
WORKDIR /workspace/mb-label-editor
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY mb-label-editor ./
ARG VITE_ASSET_CATALOG_URL=http://127.0.0.1:8766
ENV VITE_ASSET_CATALOG_URL=$VITE_ASSET_CATALOG_URL
ARG MB_BUILD_TAG=
ENV MB_BUILD_TAG=$MB_BUILD_TAG
RUN npm run build --workspace @makersbrain/label-editor \
    && npm run build --workspace @makersbrain/label-editor-pwa

FROM nginx:1.27-alpine AS runtime
# The site config is a template so the entrypoint can inject the catalogue key
# for Cloudflare Access sessions; only that one variable is substituted.
ENV NGINX_ENVSUBST_FILTER=^ASSET_CATALOG_PROXY_AUTHORIZATION$
COPY mb-label-editor/deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=755 mb-label-editor/deploy/15-asset-catalog-proxy.envsh /docker-entrypoint.d/15-asset-catalog-proxy.envsh
COPY --from=build /workspace/mb-label-editor/apps/pwa/dist /usr/share/nginx/html
EXPOSE 8080
