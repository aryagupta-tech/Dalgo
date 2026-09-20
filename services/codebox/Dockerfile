FROM ubuntu:24.04 AS worker
ENV DEBIAN_FRONTEND=noninteractive NODE_ENV=production
ARG ISOLATE_VERSION=v2.7
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ openjdk-17-jdk-headless python3 ca-certificates curl gnupg bash \
    make git pkg-config libcap-dev libsystemd-dev libseccomp-dev \
    && rm -rf /var/lib/apt/lists/*
# Native binaries and paths on both ARM64 and AMD64; Node 24 LTS.
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg \
    && echo 'deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main' > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${ISOLATE_VERSION} https://github.com/ioi/isolate.git /tmp/isolate \
    && cd /tmp/isolate && make isolate isolate-cg-keeper \
    && cp isolate isolate-cg-keeper /usr/local/bin/ && chmod 4755 /usr/local/bin/isolate \
    && rm -rf /tmp/isolate && mkdir -p /usr/local/etc /var/local/lib/isolate /run/isolate \
    && printf 'box_root = /var/local/lib/isolate\nlock_root = /run/isolate\ncg_root = /sys/fs/cgroup/isolate\nfirst_uid = 60000\nfirst_gid = 60000\nnum_boxes = 1000\nrestricted_init = 0\n' > /usr/local/etc/isolate
WORKDIR /app
COPY upstream/package*.json ./
RUN npm ci --omit=dev
COPY upstream/src ./upstream/src
COPY dalgo ./dalgo
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dalgo/worker.mjs"]

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY upstream/package*.json ./
RUN npm ci --omit=dev
COPY dalgo ./dalgo
USER node
CMD ["node", "dalgo/api.mjs"]
