# Start with the Node slim base for your supervisor
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    tini \
    curl \
    ca-certificates \
    build-essential \
    php \
    && rm -rf /var/lib/apt/lists/*

# Install mise globally for the MCP tool
RUN curl https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh

# (Since you use pnpm for the manager app, enable it natively)
RUN corepack enable pnpm

WORKDIR /app

# Install dependencies
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copy and build the app
COPY . .
RUN pnpm run build
RUN pnpm prune --prod

# Set permissions for the scripts
RUN chmod +x /app/entrypoint.sh

# Container runs as root to manage the unified volume
USER root

ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]