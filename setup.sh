#!/usr/bin/env bash
# setup.sh — Install prerequisites, configure dependencies, and start Lightpanda Docker.

set -e

# Colored outputs
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

printf "${GREEN}=========================================${NC}\n"
printf "${GREEN}   Orbit Platform Setup Script           ${NC}\n"
printf "${GREEN}=========================================${NC}\n"
echo ""

# 1. Check Node.js
printf "▸ Checking Node.js version…\n"
if ! command -v node > /dev/null 2>&1; then
    printf "${RED}✗ Error: Node.js is not installed.${NC}\n"
    printf "Please install Node.js (v22.5.0 or higher is required for node:sqlite DatabaseSync support).\n"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)
NODE_MINOR=$(echo "$NODE_VERSION" | cut -d'.' -f2)

# node:sqlite requires Node v22.5.0+ or v23+
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
    printf "${YELLOW}⚠ Warning: Node.js version is v$NODE_VERSION.${NC}\n"
    printf "Node.js v22.5.0 or higher is required for built-in SQLite DatabaseSync.\n"
    printf "Please upgrade Node.js if you encounter database initialization issues.\n"
else
    printf "${GREEN}✓ Node.js v$NODE_VERSION detected (supported).${NC}\n"
fi
echo ""

# 2. Check Docker
printf "▸ Checking Docker…\n"
if ! command -v docker > /dev/null 2>&1; then
    printf "${YELLOW}⚠ Warning: Docker is not installed or not in PATH.${NC}\n"
    printf "Docker is required to run the mandatory Lightpanda headless browser.\n"
    printf "Please install Docker to enable agent web browsing: https://docs.docker.com/get-docker/\n"
    DOCKER_AVAILABLE=false
else
    if ! docker info > /dev/null 2>&1; then
        printf "${YELLOW}⚠ Warning: Docker is installed, but the daemon is not running.${NC}\n"
        printf "Please start the Docker service/daemon (e.g. systemctl start docker or start Docker Desktop).\n"
        DOCKER_AVAILABLE=false
    else
        printf "${GREEN}✓ Docker is installed and running.${NC}\n"
        DOCKER_AVAILABLE=true
    fi
fi
echo ""

# 3. Setup Lightpanda Docker Container
if [ "$DOCKER_AVAILABLE" = true ]; then
    printf "▸ Setting up Lightpanda browser container…\n"
    if docker ps -a --format '{{.Names}}' | grep -Eq "^lightpanda-browser$"; then
        printf "  - Container 'lightpanda-browser' already exists.\n"
        if [ "$(docker inspect -f '{{.State.Status}}' lightpanda-browser)" != "running" ]; then
            printf "  - Starting 'lightpanda-browser'…\n"
            docker start lightpanda-browser
        else
            printf "  - 'lightpanda-browser' is already running.\n"
        fi
    else
        printf "  - Pulling lightpanda/browser:nightly…\n"
        docker pull lightpanda/browser:nightly
        printf "  - Running lightpanda-browser container (restart policy: unless-stopped)…\n"
        docker run -d \
            --name lightpanda-browser \
            --restart unless-stopped \
            -p 127.0.0.1:9222:9222 \
            lightpanda/browser:nightly
    fi
    printf "${GREEN}✓ Lightpanda container is up and running on port 9222.${NC}\n"
else
    printf "${YELLOW}⚠ Skipping Lightpanda setup (Docker unavailable).${NC}\n"
    printf "You can configure a fallback browser/web access in your profile settings later.\n"
fi
echo ""

# 4. Copy Environment File
printf "▸ Configuring environment variables…\n"
if [ ! -f .env ]; then
    cp .env.example .env
    printf "${GREEN}✓ Created .env file from .env.example.${NC}\n"
    printf "Please edit .env to configure your LLM settings (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL).\n"
else
    printf "  - .env file already exists.\n"
fi
echo ""

# 5. Install root dependencies
printf "▸ Installing backend dependencies…\n"
npm install
printf "${GREEN}✓ Backend dependencies installed.${NC}\n"
echo ""

# 6. Install dashboard dependencies
printf "▸ Installing dashboard dependencies…\n"
npm --prefix dashboard install
printf "${GREEN}✓ Dashboard dependencies installed.${NC}\n"
echo ""

# 7. Configure pi extensions (pi is a hard prerequisite for the local harness)
if command -v pi > /dev/null 2>&1; then
    printf "▸ Configuring pi agent extensions…\n"
    pi install npm:pi-mcp-extension
    pi install npm:pi-provider-litellm
    printf "${GREEN}✓ pi agent extensions configured.${NC}\n"
    echo ""
else
    printf "${YELLOW}⚠ pi CLI not found on PATH — the local agent harness will not run without it.${NC}\n"
    printf "  Orbit spawns the ${YELLOW}pi${NC} CLI to run local agent sessions. Install it, then re-run\n"
    printf "  this script (or the two commands below) so the required extensions are registered:\n"
    printf "      ${YELLOW}pi install npm:pi-mcp-extension${NC}\n"
    printf "      ${YELLOW}pi install npm:pi-provider-litellm${NC}\n"
    printf "  See the pi install docs, or set ${YELLOW}PI_CLI_PATH${NC}/${YELLOW}PI_NODE_PATH${NC} if pi lives off PATH.\n"
    printf "  (You can still run Orbit as a headless backend or drive a remote/paired harness.)\n"
    echo ""
fi

printf "${GREEN}=========================================${NC}\n"
printf "${GREEN}   Setup Completed Successfully!         ${NC}\n"
printf "${GREEN}=========================================${NC}\n"
echo ""
printf "To get started:\n"
printf "  1. Edit ${YELLOW}.env${NC} and fill in your LLM configuration (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL).\n"
printf "  2. Start the development servers by running:\n"
printf "     ${YELLOW}npm run dev${NC}\n"
printf "  3. Open ${YELLOW}http://localhost:6801${NC} in your browser.\n"
echo ""
