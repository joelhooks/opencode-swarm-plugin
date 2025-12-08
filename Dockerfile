# Test runner container for opencode-swarm-plugin integration tests
FROM oven/bun:latest

# Install git (required for beads) and curl (for healthchecks)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Download bd CLI (beads issue tracker) for linux/amd64
ARG BD_VERSION=0.2.8
RUN curl -fsSL "https://github.com/beads-ai/beads/releases/download/v${BD_VERSION}/bd-linux-amd64" \
    -o /usr/local/bin/bd \
    && chmod +x /usr/local/bin/bd

WORKDIR /app

# Copy package files and install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Copy entrypoint script
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "test:integration"]
