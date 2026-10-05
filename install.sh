#!/usr/bin/env bash
# SalesBoard one-command install (Mac / Linux).
#
#   bash install.sh             install + set up + start
#   bash install.sh --service   also keep it running 24/7 (Linux servers with systemd)
#   bash install.sh --docker    run it with Docker instead
#
# Not cloned yet? This does it for you:
#   curl -fsSL https://raw.githubusercontent.com/tidewaterrepair-code/sales-board/main/install.sh | bash
set -euo pipefail

REPO_URL="${SALESBOARD_REPO:-https://github.com/tidewaterrepair-code/sales-board.git}"
TARGET_DIR="${SALESBOARD_DIR:-$HOME/sales-board}"
SERVICE=0; DOCKER=0
for arg in "$@"; do
  case "$arg" in
    --service) SERVICE=1 ;;
    --docker) DOCKER=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
  esac
done

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }
# Read answers from the keyboard even when this script was piped from curl.
TTY=/dev/null; if [ -t 1 ] && [ -r /dev/tty ]; then TTY=/dev/tty; fi

echo "🏆  SalesBoard installer"

# 1. Get the code
if [ -f package.json ] && grep -q '"name": "sales-board"' package.json; then
  ok "Using this folder: $(pwd)"
else
  say "Downloading SalesBoard to $TARGET_DIR"
  has git || die "git is missing. Install it (Mac: xcode-select --install · Ubuntu: sudo apt install -y git) and run this again."
  if [ -d "$TARGET_DIR/.git" ]; then git -C "$TARGET_DIR" pull --ff-only; else git clone "$REPO_URL" "$TARGET_DIR"; fi
  cd "$TARGET_DIR"
  ok "Code ready"
fi
APP_DIR="$(pwd)"

# 2. Docker path
if [ "$DOCKER" = 1 ]; then
  has docker || die "Docker is missing. Get it at https://docs.docker.com/get-docker/ (or run without --docker)."
  [ -f .env ] || node scripts/setup.js < "$TTY" 2>/dev/null || cp .env.example .env
  say "Starting with Docker"
  docker compose up -d --build
  ok "Running → http://localhost:$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo 3000)"
  exit 0
fi

# 3. Node.js 20+
node_ok() { has node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; }
if ! node_ok; then
  say "Installing Node.js (LTS) with nvm. No admin rights needed"
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install --lts >/dev/null
  nvm alias default 'lts/*' >/dev/null
fi
node_ok || die "Node.js 20+ is required. Install it from https://nodejs.org and run this again."
ok "Node.js $(node -v)"

# 4. Settings (.env)
say "Setting up your keys (press Enter to skip any of them)"
if [ "$TTY" = /dev/tty ]; then node scripts/setup.js < /dev/tty; else node scripts/setup.js --yes; fi
mkdir -p data

# 5. Self-check
say "Running a quick self-check"
npm test --silent >/dev/null 2>&1 && ok "All checks passed" || die "Self-check failed. Run 'npm test' to see why."

PORT="$(grep -E '^PORT=' .env | cut -d= -f2)"; PORT="${PORT:-3000}"

# 6. Run 24/7 as a service (Linux)
if [ "$SERVICE" = 1 ]; then
  has systemctl || die "--service needs a Linux server with systemd. Use --docker instead, or just run 'npm start'."
  say "Installing the 'salesboard' service so it runs 24/7 and restarts on reboot"
  SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
  $SUDO tee /etc/systemd/system/salesboard.service >/dev/null <<UNIT
[Unit]
Description=SalesBoard
After=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now salesboard
  ok "Running as a service → http://localhost:$PORT"
  echo "   Logs: sudo journalctl -u salesboard -f   ·   Restart: sudo systemctl restart salesboard"
  exit 0
fi

# 7. Start
say "Starting SalesBoard → http://localhost:$PORT   (Ctrl+C to stop, 'npm start' to start again)"
exec node server.js
