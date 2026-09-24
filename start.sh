#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
VERSION=$(cat VERSION 2>/dev/null || echo "unknown")
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  OutdoorPrice v${VERSION}                       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"

echo -e "${YELLOW}[1/4] Checking prerequisites...${NC}"
if command -v bun &>/dev/null; then echo -e "  ${GREEN}✓${NC} Bun: $(bun --version)"; fi
if command -v node &>/dev/null; then echo -e "  ${GREEN}✓${NC} Node: $(node --version)"; else
  echo -e "  ${RED}✗ Node.js not found. Install from https://nodejs.org${NC}"; exit 1; fi

echo -e "${YELLOW}[2/4] Installing dependencies...${NC}"
if [ ! -d "node_modules" ]; then
  if command -v bun &>/dev/null; then bun install; else npm install; fi
  echo -e "  ${GREEN}✓${NC} Installed"
else echo -e "  ${GREEN}✓${NC} Already installed"; fi

echo -e "${YELLOW}[3/4] Checking Playwright Chromium...${NC}"
PW_CACHE="${HOME}/.cache/ms-playwright"
if [ -d "$PW_CACHE" ] && find "$PW_CACHE" -name "chrome*" 2>/dev/null | head -1 | grep -q .; then
  echo -e "  ${GREEN}✓${NC} Already installed"
else
  echo -e "  Installing..."
  if command -v bun &>/dev/null; then bunx playwright install chromium; else npx playwright install chromium; fi
  echo -e "  ${GREEN}✓${NC} Installed"
fi

echo -e "${YELLOW}[4/4] Starting server...${NC}"
PORT=${PORT:-3000}
cleanup() { if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT INT TERM

if command -v bun &>/dev/null; then PORT=$PORT bun run dev & else PORT=$PORT npm run dev & fi
SERVER_PID=$!

for i in $(seq 1 30); do
  if curl -s "http://localhost:${PORT}" -o /dev/null 2>/dev/null; then break; fi
  sleep 1
done

if [[ "$OSTYPE" == "darwin"* ]]; then open "http://localhost:${PORT}"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then xdg-open "http://localhost:${PORT}" 2>/dev/null || true; fi

echo -e "${GREEN}✓ Server ready at http://localhost:${PORT}${NC}"
echo -e "Press Ctrl+C to stop."
wait "$SERVER_PID" 2>/dev/null || true
