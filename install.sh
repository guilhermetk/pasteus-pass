#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/pasteus-pass"
SERVICE_NAME="pasteus-pass"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
ENV_FILE="${APP_DIR}/.env"

# --- Check root ---
if [ "$(id -u)" -ne 0 ]; then
  echo "Error: this script must be run as root"
  exit 1
fi

# --- Detect if already installed ---
IS_UPDATE=false
if systemctl list-unit-files | grep -q "${SERVICE_NAME}.service"; then
  IS_UPDATE=true
  echo "=== Updating existing installation ==="
else
  echo "=== Fresh install ==="
fi

# --- Install bun if missing ---
if ! command -v bun &>/dev/null; then
  echo "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="/root/.bun"
  export PATH="${BUN_INSTALL}/bin:${PATH}"

  # Symlink to /usr/local/bin so systemd can find it
  ln -sf "${BUN_INSTALL}/bin/bun" /usr/local/bin/bun
  echo "Bun installed: $(bun --version)"
else
  echo "Bun already installed: $(bun --version)"
fi

# --- Stop service if updating ---
if [ "${IS_UPDATE}" = true ]; then
  echo "Stopping service..."
  systemctl stop "${SERVICE_NAME}" || true
fi

# --- Copy project files ---
echo "Copying files to ${APP_DIR}..."
mkdir -p "${APP_DIR}"
cp poll.ts package.json bun.lock "${APP_DIR}/"

# --- Install dependencies ---
echo "Installing dependencies..."
(cd "${APP_DIR}" && bun install --production)

# --- Create .env if it doesn't exist ---
if [ ! -f "${ENV_FILE}" ]; then
  echo "Creating ${ENV_FILE}..."
  cat > "${ENV_FILE}" <<'EOF'
LOGIN_USER=your-username-here
LOGIN_PASSWORD=your-password-here
PUSHOVER_USER=your-user-key-here
PUSHOVER_TOKEN=your-app-token-here
POLL_INTERVAL_MINUTES=30
EOF
  chmod 600 "${ENV_FILE}"
  echo "IMPORTANT: Edit ${ENV_FILE} and fill in your credentials"
else
  echo "${ENV_FILE} already exists, keeping current credentials"
fi

# --- Install systemd service ---
echo "Installing systemd service..."
cp pasteus-pass.service "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"

# --- Start/restart ---
if [ "${IS_UPDATE}" = true ]; then
  echo "Restarting service..."
  systemctl start "${SERVICE_NAME}"
  echo ""
  echo "=== Update complete — service restarted ==="
  echo ""
  echo "Check logs: journalctl -u ${SERVICE_NAME} -f"
else
  echo ""
  echo "=== Installation complete ==="
  echo ""
  echo "Next steps:"
  echo "  1. Edit credentials:  nano ${ENV_FILE}"
  echo "  2. Test notification: bun ${APP_DIR}/poll.ts -t"
  echo "  3. Start the service: systemctl start ${SERVICE_NAME}"
  echo "  4. Check logs:        journalctl -u ${SERVICE_NAME} -f"
fi
