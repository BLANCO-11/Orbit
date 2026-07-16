#!/usr/bin/env bash
# setup.sh — Install prerequisites, configure dependencies, and start Lightpanda Docker.

set -e

# Colored outputs
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}   Orbit Platform Setup Script           ${NC}"
echo -e "${GREEN}=========================================${NC}"
echo

# 1. Check Node.js
echo -e "▸ Checking Node.js version…"
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Error: Node.js is not installed.${NC}"
    echo -e "Please install Node.js (v22.5.0 or higher is required for node:sqlite DatabaseSync support)."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)
NODE_MINOR=$(echo "$NODE_VERSION" | cut -d'.' -f2)

# node:sqlite requires Node v22.5.0+ or v23+
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
    echo -e "${YELLOW}⚠ Warning: Node.js version is v$NODE_VERSION.${NC}"
    echo -e "Node.js v22.5.0 or higher is required for built-in SQLite DatabaseSync."
    echo -e "Please upgrade Node.js if you encounter database initialization issues."
else
    echo -e "${GREEN}✓ Node.js v$NODE_VERSION detected (supported).${NC}"
fi
echo

# 2. Check Docker
echo -e "▸ Checking Docker…"
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}⚠ Warning: Docker is not installed or not in PATH.${NC}"
    echo -e "Docker is required to run the mandatory Lightpanda headless browser."
    echo -e "Please install Docker to enable agent web browsing: https://docs.docker.com/get-docker/"
    DOCKER_AVAILABLE=false
else
    if ! docker info &> /dev/null; then
        echo -e "${YELLOW}⚠ Warning: Docker is installed, but the daemon is not running.${NC}"
        echo -e "Please start the Docker service/daemon (e.g. systemctl start docker or start Docker Desktop)."
        DOCKER_AVAILABLE=false
    else
        echo -e "${GREEN}✓ Docker is installed and running.${NC}"
        DOCKER_AVAILABLE=true
    fi
fi
echo

# 3. Setup Lightpanda Docker Container
if [ "$DOCKER_AVAILABLE" = true ]; then
    echo -e "▸ Setting up Lightpanda browser container…"
    if docker ps -a --format '{{.Names}}' | grep -Eq "^lightpanda-browser$"; then
        echo -e "  - Container 'lightpanda-browser' already exists."
        if [ "$(docker inspect -f '{{.State.Status}}' lightpanda-browser)" != "running" ]; then
            echo -e "  - Starting 'lightpanda-browser'…"
            docker start lightpanda-browser
        else
            echo -e "  - 'lightpanda-browser' is already running."
        fi
    else
        echo -e "  - Pulling lightpanda/browser:nightly…"
        docker pull lightpanda/browser:nightly
        echo -e "  - Running lightpanda-browser container (restart policy: unless-stopped)…"
        docker run -d \
            --name lightpanda-browser \
            --restart unless-stopped \
            -p 127.0.0.1:9222:9222 \
            lightpanda/browser:nightly
    fi
    echo -e "${GREEN}✓ Lightpanda container is up and running on port 9222.${NC}"
else
    echo -e "${YELLOW}⚠ Skipping Lightpanda setup (Docker unavailable).${NC}"
    echo -e "You can configure a fallback browser/web access in your profile settings later."
fi
echo

# 4. Copy Environment File
echo -e "▸ Configuring environment variables…"
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}✓ Created .env file from .env.example.${NC}"
    echo -e "Please edit .env to configure your LLM settings (LITELLM_BASE_URL, LITELLM_KEY, etc.)."
else
    echo -e "  - .env file already exists."
fi
echo

# 5. Install root dependencies
echo -e "▸ Installing backend dependencies…"
npm install
echo -e "${GREEN}✓ Backend dependencies installed.${NC}"
echo

# 6. Install dashboard dependencies
echo -e "▸ Installing dashboard dependencies…"
npm --prefix dashboard install
echo -e "${GREEN}✓ Dashboard dependencies installed.${NC}"
echo

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}   Setup Completed Successfully!         ${NC}"
echo -e "${GREEN}=========================================${NC}"
echo
echo -e "To get started:"
echo -e "  1. Edit ${YELLOW}.env${NC} and fill in your LLM configuration (e.g. LITELLM_KEY)."
echo -e "  2. Start the development servers by running:"
echo -e "     ${YELLOW}npm run dev${NC}"
echo -e "  3. Open ${YELLOW}http://localhost:6801${NC} in your browser."
echo
