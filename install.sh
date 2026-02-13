#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/pasteus-pass"
SERVICE_FILE="/etc/systemd/system/pasteus-pass.service"
ENV_FILE="${APP_DIR}/.env"

# --- Check root ---
if [ "$(id -u)" -ne 0 ]; then
  echo "Error: this script must be run as root"
  exit 1
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

# --- Copy project files ---
echo "Setting up ${APP_DIR}..."
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
EOF
  chmod 600 "${ENV_FILE}"
  echo "IMPORTANT: Edit ${ENV_FILE} and fill in your Pushover credentials"
else
  echo "${ENV_FILE} already exists, skipping"
fi

# --- Install systemd service ---
echo "Installing systemd service..."
cp pasteus-pass.service "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable pasteus-pass

echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit credentials:  nano ${ENV_FILE}"
echo "  2. Test notification: bun ${APP_DIR}/poll.ts -t"
echo "  3. Start the service: systemctl start pasteus-pass"
echo "  4. Check logs:        journalctl -u pasteus-pass -f"
