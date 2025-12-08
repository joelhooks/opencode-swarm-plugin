#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[entrypoint]${NC} $1"; }
warn() { echo -e "${YELLOW}[entrypoint]${NC} $1"; }
error() { echo -e "${RED}[entrypoint]${NC} $1"; }

# Initialize git repo if not present (beads requires git)
if [ ! -d ".git" ]; then
    log "Initializing git repository..."
    git init
    git config user.email "test@example.com"
    git config user.name "Test Runner"
    git add -A
    git commit -m "Initial commit for test environment" --allow-empty
fi

# Initialize beads if not present
if [ ! -d ".beads" ]; then
    log "Initializing beads..."
    bd init --name "test-project" || warn "beads init failed (may already exist)"
fi

# Wait for agent-mail to be healthy
AGENT_MAIL_URL="${AGENT_MAIL_URL:-http://agent-mail:8765}"
MAX_RETRIES=30
RETRY_COUNT=0

log "Waiting for agent-mail at ${AGENT_MAIL_URL}..."

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -sf "${AGENT_MAIL_URL}/health/liveness" > /dev/null 2>&1; then
        log "agent-mail is healthy!"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        error "agent-mail failed to become healthy after ${MAX_RETRIES} attempts"
        exit 1
    fi
    warn "Waiting for agent-mail... (attempt ${RETRY_COUNT}/${MAX_RETRIES})"
    sleep 1
done

log "Starting integration tests..."

# Execute the command passed to the container
exec "$@"
