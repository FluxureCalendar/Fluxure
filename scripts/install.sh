#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  Fluxure — Self-Hosted Installer
#  https://fluxure.app
# ============================================================

FLUXURE_VERSION="1.0.0"
INSTALL_DIR="${FLUXURE_DIR:-$HOME/fluxure}"
GUM_VERSION="0.14.5"

# ---- Colors (fallback if Gum isn't available yet) ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

die() { echo -e "${RED}Error:${NC} $1" >&2; exit 1; }

# ---- Gum Bootstrap ----
# Download Gum TUI binary if not already installed
ensure_gum() {
  if command -v gum &>/dev/null; then
    return 0
  fi

  local os arch gum_tar gum_url tmp_dir
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) arch="x86_64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) die "Unsupported architecture: $arch" ;;
  esac

  case "$os" in
    linux)  gum_tar="gum_${GUM_VERSION}_Linux_${arch}.tar.gz" ;;
    darwin) gum_tar="gum_${GUM_VERSION}_Darwin_${arch}.tar.gz" ;;
    *)      die "Unsupported OS: $os" ;;
  esac

  gum_url="https://github.com/charmbracelet/gum/releases/download/v${GUM_VERSION}/${gum_tar}"

  # Use a global for the trap so it survives function scope
  GUM_TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$GUM_TMP_DIR"' EXIT

  echo -e "${DIM}Downloading Gum TUI...${NC}"
  curl -sSL "$gum_url" -o "$GUM_TMP_DIR/gum.tar.gz" || die "Failed to download Gum from $gum_url"
  tar -xzf "$GUM_TMP_DIR/gum.tar.gz" -C "$GUM_TMP_DIR" || die "Failed to extract Gum"

  # Gum tarball extracts into a subdirectory (e.g., gum_0.14.5_Linux_x86_64/gum)
  local gum_bin
  gum_bin="$(find "$GUM_TMP_DIR" -name gum -type f | head -1)"
  [ -z "$gum_bin" ] && die "Could not find gum binary in extracted archive"
  chmod +x "$gum_bin"

  # Install to /usr/local/bin if writable, otherwise to INSTALL_DIR
  if [ -w /usr/local/bin ]; then
    cp "$gum_bin" /usr/local/bin/gum
  else
    mkdir -p "$INSTALL_DIR"
    cp "$gum_bin" "$INSTALL_DIR/gum"
    export PATH="$INSTALL_DIR:$PATH"
  fi

  command -v gum &>/dev/null || die "Failed to install Gum"
  trap - EXIT
  rm -rf "$GUM_TMP_DIR"
}

# ---- Gum Helpers ----
header() {
  clear
  gum style \
    --border double \
    --border-foreground 99 \
    --padding "1 3" \
    --margin "1 0" \
    --align center \
    "✦  F L U X U R E" \
    "" \
    "Self-Hosted Installer v${FLUXURE_VERSION}"
}

step_header() {
  local step="$1" total="$2" title="$3"
  gum style \
    --foreground 99 \
    --bold \
    "Step ${step}/${total} — ${title}"
  echo ""
}

success_mark() { gum style --foreground 82 "  ✓ $1"; }
warn_mark()    { gum style --foreground 214 "  ⚠ $1"; }
fail_mark()    { gum style --foreground 196 "  ✗ $1"; }

spin() {
  # Usage: spin "message" command args...
  local msg="$1"; shift
  gum spin --spinner dot --title "$msg" -- "$@"
}

confirm() {
  gum confirm --affirmative "Yes" --negative "No" "$1"
}

prompt_input() {
  local placeholder="$1"
  local header_text="${2:-}"
  if [ -n "$header_text" ]; then
    gum input --placeholder "$placeholder" --header "$header_text"
  else
    gum input --placeholder "$placeholder"
  fi
}

prompt_password() {
  local placeholder="$1"
  gum input --password --placeholder "$placeholder"
}

info_panel() {
  gum style \
    --border rounded \
    --border-foreground 240 \
    --padding "1 2" \
    --margin "0 2" \
    "$@"
}

# ============================================================
#  Step 1: Prerequisites
# ============================================================

# Detect system package manager
detect_pkg_manager() {
  if command -v apt-get &>/dev/null; then echo "apt"
  elif command -v dnf &>/dev/null; then echo "dnf"
  elif command -v yum &>/dev/null; then echo "yum"
  elif command -v pacman &>/dev/null; then echo "pacman"
  elif command -v apk &>/dev/null; then echo "apk"
  elif command -v brew &>/dev/null; then echo "brew"
  else echo ""
  fi
}

# Install a package using the detected package manager
pkg_install() {
  local pkg="$1"
  local mgr
  mgr="$(detect_pkg_manager)"
  case "$mgr" in
    apt)    sudo apt-get update -qq && sudo apt-get install -y -qq "$pkg" ;;
    dnf)    sudo dnf install -y -q "$pkg" ;;
    yum)    sudo yum install -y -q "$pkg" ;;
    pacman) sudo pacman -S --noconfirm "$pkg" ;;
    apk)    sudo apk add --quiet "$pkg" ;;
    brew)   brew install --quiet "$pkg" ;;
    *)      return 1 ;;
  esac
}

# Attempt to install Docker via official convenience script
install_docker() {
  echo ""
  if confirm "Docker is not installed. Attempt automatic installation?"; then
    gum spin --spinner dot --title "Installing Docker via get.docker.com..." -- \
      bash -c 'curl -fsSL https://get.docker.com | sh' 2>/dev/null
    if command -v docker &>/dev/null; then
      success_mark "Docker installed successfully"
      # Add current user to docker group (may need re-login)
      if [ "$(id -u)" -ne 0 ] && command -v usermod &>/dev/null; then
        sudo usermod -aG docker "$USER" 2>/dev/null || true
        warn_mark "You may need to log out and back in for Docker permissions"
      fi
      # Start Docker daemon if systemctl is available
      if command -v systemctl &>/dev/null; then
        sudo systemctl start docker 2>/dev/null || true
        sudo systemctl enable docker 2>/dev/null || true
      fi
      return 0
    else
      fail_mark "Automatic Docker installation failed"
      return 1
    fi
  fi
  return 1
}

check_prerequisites() {
  step_header 1 5 "Checking prerequisites"

  local ok=true

  # curl (needed first — Docker install and Gum download use it)
  if command -v curl &>/dev/null; then
    success_mark "curl found"
  else
    warn_mark "curl not found — attempting install..."
    if pkg_install curl && command -v curl &>/dev/null; then
      success_mark "curl installed"
    else
      fail_mark "curl not found and could not be installed"
      ok=false
    fi
  fi

  # openssl
  if command -v openssl &>/dev/null; then
    success_mark "openssl found"
  else
    warn_mark "openssl not found — attempting install..."
    if pkg_install openssl && command -v openssl &>/dev/null; then
      success_mark "openssl installed"
    else
      fail_mark "openssl not found and could not be installed"
      ok=false
    fi
  fi

  # Docker
  if command -v docker &>/dev/null; then
    local docker_ver
    docker_ver="$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)"
    success_mark "Docker found (${docker_ver})"
  else
    if install_docker; then
      local docker_ver
      docker_ver="$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)"
      success_mark "Docker found (${docker_ver})"
    else
      fail_mark "Docker not found — install from https://docs.docker.com/get-docker/"
      ok=false
    fi
  fi

  # Docker Compose v2
  if docker compose version &>/dev/null 2>&1; then
    local compose_ver
    compose_ver="$(docker compose version --short 2>/dev/null || echo 'unknown')"
    success_mark "Docker Compose found (${compose_ver})"
  else
    fail_mark "Docker Compose v2 not found — included with Docker Desktop, or install the plugin"
    ok=false
  fi

  # Docker daemon running
  local docker_err
  docker_err="$(docker ps 2>&1)" && {
    success_mark "Docker daemon is running"
  } || {
    if echo "$docker_err" | grep -qi "client version.*too old\|API version"; then
      fail_mark "Docker CLI is outdated — the daemon requires a newer client"
      fail_mark "Fix: update Docker CLI or reinstall Docker Desktop"
      fail_mark "  Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y docker-ce-cli"
      fail_mark "  Or remove the old CLI so Docker Desktop's integration takes over"
      ok=false
    elif echo "$docker_err" | grep -qi "permission denied\|Got permission denied"; then
      fail_mark "Docker permission denied — add your user to the docker group:"
      fail_mark "  sudo usermod -aG docker \$USER && newgrp docker"
      ok=false
    else
      # Try to start it silently before warning the user
      local docker_started=false
      if command -v systemctl &>/dev/null; then
        sudo systemctl start docker 2>/dev/null || true
        sleep 2
        docker ps &>/dev/null && docker_started=true
      fi
      if [ "$docker_started" = false ]; then
        sleep 3
        docker ps &>/dev/null && docker_started=true
      fi
      if [ "$docker_started" = true ]; then
        success_mark "Docker daemon is running"
      else
        fail_mark "Docker daemon is not running — start Docker Desktop and try again"
        ok=false
      fi
    fi
  }

  echo ""
  if [ "$ok" = false ]; then
    die "Prerequisites check failed. Install the missing tools and try again."
  fi
  success_mark "All prerequisites met"
  echo ""
  sleep 1
}

# ============================================================
#  Step 2: Domain Setup
# ============================================================
DOMAIN=""
USE_CADDY=false
SCHEME="http"
BASE_URL=""

setup_domain() {
  step_header 2 5 "Domain setup"

  if confirm "Do you have a domain name pointed at this server?"; then
    DOMAIN=$(prompt_input "cal.example.com" "Enter your domain name")
    [ -z "$DOMAIN" ] && die "Domain cannot be empty"

    # Strip protocol if user accidentally included it
    DOMAIN="${DOMAIN#https://}"
    DOMAIN="${DOMAIN#http://}"
    DOMAIN="${DOMAIN%/}"

    USE_CADDY=true
    SCHEME="https"
    BASE_URL="${SCHEME}://${DOMAIN}"

    success_mark "Domain: ${DOMAIN}"
    success_mark "Caddy will auto-provision TLS certificates"
    success_mark "Google Calendar will use push notifications (real-time sync)"
  else
    BASE_URL="http://localhost:3000"
    success_mark "Running on localhost:3000 (no TLS)"
    warn_mark "Google Calendar will use polling (syncs every 15 seconds)"
    warn_mark "Add a domain later for real-time push notifications"
  fi
  echo ""
  sleep 1
}

# ============================================================
#  Step 3: Google Calendar Credentials
# ============================================================
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

setup_google() {
  step_header 3 5 "Google Calendar"

  local redirect_uri="${BASE_URL}/api/auth/google/callback"

  info_panel \
    "To connect Google Calendar, you need OAuth credentials." \
    "" \
    "  1. Go to console.cloud.google.com" \
    "  2. Create a new project (or select existing)" \
    "  3. Navigate to APIs & Services → Library" \
    "  4. Enable \"Google Calendar API\"" \
    "  5. Go to APIs & Services → Credentials" \
    "  6. Create OAuth 2.0 Client ID (Web application)" \
    "  7. Add authorized redirect URI:" \
    "" \
    "     ${redirect_uri}" \
    "" \
    "  8. Copy the Client ID and Client Secret below"

  echo ""
  GOOGLE_CLIENT_ID=$(prompt_input "xxxx.apps.googleusercontent.com" "Google Client ID")
  GOOGLE_CLIENT_SECRET=$(prompt_password "Google Client Secret")

  if [ -n "$GOOGLE_CLIENT_ID" ] && [ -n "$GOOGLE_CLIENT_SECRET" ]; then
    success_mark "Google Calendar credentials saved"
  else
    echo ""
    gum style \
      --foreground 196 \
      --bold \
      "  ⚠  Google Calendar credentials are required."
    warn_mark "Fluxure needs Google Calendar to function."
    warn_mark "The app will start, but you won't be able to sign in"
    warn_mark "or use any features until you add credentials."
    warn_mark ""
    warn_mark "To fix later, edit .env and set:"
    warn_mark "  GOOGLE_CLIENT_ID=your-client-id"
    warn_mark "  GOOGLE_CLIENT_SECRET=your-client-secret"
    warn_mark "Then restart: docker compose restart fluxure"
  fi
  echo ""
  sleep 1
}

# ============================================================
#  Step 4: SMTP (Optional)
# ============================================================
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""

setup_smtp() {
  step_header 4 5 "Email delivery (optional)"

  if confirm "Configure SMTP for email verification & password resets?"; then
    SMTP_HOST=$(prompt_input "smtp.resend.com" "SMTP Host")
    [ -z "$SMTP_HOST" ] && { warn_mark "Skipped SMTP"; echo ""; return; }

    local port_input
    port_input=$(prompt_input "587" "SMTP Port")
    SMTP_PORT="${port_input:-587}"

    SMTP_USER=$(prompt_input "" "SMTP Username (leave empty if not required)")
    SMTP_PASS=$(prompt_password "SMTP Password (leave empty if not required)")
    SMTP_FROM=$(prompt_input "noreply@${DOMAIN:-yourdomain.com}" "From address")
    SMTP_FROM="${SMTP_FROM:-noreply@${DOMAIN:-yourdomain.com}}"

    success_mark "SMTP configured (${SMTP_HOST}:${SMTP_PORT})"
  else
    warn_mark "Skipped — verification emails will be logged to console"
    warn_mark "View them with: docker compose logs -f fluxure"
  fi
  echo ""
  sleep 1
}

# ============================================================
#  Step 5: Generate Config & Launch
# ============================================================
launch() {
  step_header 5 5 "Launching Fluxure"

  # ---- Create install directory ----
  mkdir -p "$INSTALL_DIR"
  cd "$INSTALL_DIR"

  # ---- Generate or reuse secrets ----
  local pg_pass jwt_secret enc_key redis_pass
  if [ "$USE_EXISTING_SECRETS" = true ]; then
    pg_pass="$EXISTING_PG_PASS"
    jwt_secret="$EXISTING_JWT_SECRET"
    enc_key="$EXISTING_ENC_KEY"
    redis_pass="${EXISTING_REDIS_PASS:-$(openssl rand -hex 16)}"
    success_mark "Existing secrets preserved"
  else
    gum spin --spinner dot --title "Generating secrets..." -- sleep 1
    pg_pass="$(openssl rand -hex 24)"
    jwt_secret="$(openssl rand -hex 32)"
    enc_key="$(openssl rand -hex 32)"
    redis_pass="$(openssl rand -hex 16)"
    success_mark "Secrets generated"
  fi

  # ---- Write .env ----
  local trust_proxy=""
  local webhook_url=""
  [ "$USE_CADDY" = true ] && trust_proxy="1"
  [ "$USE_CADDY" = true ] && webhook_url="$BASE_URL"

  cat > "$INSTALL_DIR/.env" <<ENVEOF
# Fluxure — generated by install.sh on $(date -u +"%Y-%m-%d %H:%M UTC")
# Edit this file to change configuration, then restart:
#   docker compose restart fluxure

SELF_HOSTED="true"

POSTGRES_PASSWORD="${pg_pass}"
REDIS_PASSWORD="${redis_pass}"
JWT_SECRET="${jwt_secret}"
ENCRYPTION_KEY="${enc_key}"

GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET}"
GOOGLE_REDIRECT_URI="${BASE_URL}/api/auth/google/callback"

CORS_ORIGIN="${BASE_URL}"
FRONTEND_URL="${BASE_URL}"
TRUST_PROXY="${trust_proxy}"

WEBHOOK_BASE_URL="${webhook_url}"

SMTP_HOST="${SMTP_HOST}"
SMTP_PORT="${SMTP_PORT}"
SMTP_USER="${SMTP_USER}"
SMTP_PASS="${SMTP_PASS}"
SMTP_FROM="${SMTP_FROM}"
ENVEOF

  chmod 600 "$INSTALL_DIR/.env"
  success_mark ".env written (secrets are owner-readable only)"

  # ---- Write docker-compose.yml ----
  write_compose
  success_mark "docker-compose.yml written"

  # ---- Write Caddyfile (if domain) ----
  if [ "$USE_CADDY" = true ]; then
    write_caddyfile
    success_mark "Caddyfile written for ${DOMAIN}"
  fi

  # ---- Write update script ----
  write_update_script
  success_mark "update.sh written"

  echo ""

  # ---- Pull images ----
  gum spin --spinner dot --title "Pulling Docker images (this may take a moment)..." -- \
    docker compose pull --quiet

  success_mark "Images pulled"

  # ---- Start services ----
  gum spin --spinner dot --title "Starting services..." -- \
    docker compose up -d

  # ---- Wait for health ----
  local timeout=90 elapsed=0
  while [ $elapsed -lt $timeout ]; do
    if docker compose exec -T fluxure wget -qO- http://localhost:3000/api/health 2>/dev/null | grep -q '"ok"'; then
      break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo ""

  if [ $elapsed -lt $timeout ]; then
    success_mark "All services healthy"
  else
    warn_mark "Fluxure is still starting — check logs with: docker compose logs -f"
  fi

  echo ""

  # ---- Final summary ----
  local url="$BASE_URL"
  gum style \
    --border double \
    --border-foreground 82 \
    --padding "1 3" \
    --margin "1 0" \
    --align center \
    "✦  Fluxure is running!" \
    "" \
    "URL:       ${url}" \
    "Logs:      cd ${INSTALL_DIR} && docker compose logs -f" \
    "Stop:      cd ${INSTALL_DIR} && docker compose down" \
    "Update:    ./install.sh --update" \
    "Uninstall: ./install.sh --uninstall" \
    "" \
    "Create your account at the URL above."
}

# ============================================================
#  File Writers
# ============================================================

write_compose() {
  # Base services: postgres + redis + fluxure
  cat > "$INSTALL_DIR/docker-compose.yml" <<'COMPOSEEOF'
services:
  postgres:
    image: postgres:17-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: fluxure
      POSTGRES_USER: fluxure
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U fluxure']
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    shm_size: 128m
    mem_limit: 256m
    restart: unless-stopped
    networks:
      - internal

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes
    volumes:
      - redisdata:/data
    healthcheck:
      test: ['CMD-SHELL', 'redis-cli -a "$REDIS_PASSWORD" ping']
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 5s
    mem_limit: 128m
    restart: unless-stopped
    networks:
      - internal

  fluxure:
    image: theflyingrat/fluxure:latest
COMPOSEEOF

  # Port binding: only expose directly if no Caddy
  if [ "$USE_CADDY" = true ]; then
    cat >> "$INSTALL_DIR/docker-compose.yml" <<'COMPOSEEOF'
    # No port binding — Caddy handles external traffic
    expose:
      - '3000'
COMPOSEEOF
  else
    cat >> "$INSTALL_DIR/docker-compose.yml" <<'COMPOSEEOF'
    ports:
      - '${FLUXURE_PORT:-3000}:3000'
COMPOSEEOF
  fi

  cat >> "$INSTALL_DIR/docker-compose.yml" <<'COMPOSEEOF'
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    env_file: .env
    environment:
      - DATABASE_URL=postgresql://fluxure:${POSTGRES_PASSWORD}@postgres:5432/fluxure
      - DATABASE_SSL=false
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
      - NODE_ENV=production
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:3000/api/health']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    mem_limit: 512m
    cpus: '1.0'
    restart: unless-stopped
    networks:
      - internal
COMPOSEEOF

  # Caddy service (optional)
  if [ "$USE_CADDY" = true ]; then
    cat >> "$INSTALL_DIR/docker-compose.yml" <<'COMPOSEEOF'

  caddy:
    image: caddy:2-alpine
    ports:
      - '80:80'
      - '443:443'
      - '443:443/udp'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      fluxure:
        condition: service_healthy
    security_opt:
      - no-new-privileges:true
    mem_limit: 128m
    restart: unless-stopped
    networks:
      - internal
COMPOSEEOF
  fi

  # Volumes and networks
  if [ "$USE_CADDY" = true ]; then
    cat >> "$INSTALL_DIR/docker-compose.yml" <<'COMPOSEEOF'

volumes:
  pgdata:
  redisdata:
  caddy_data:
  caddy_config:

networks:
  internal:
    driver: bridge
COMPOSEEOF
  else
    cat >> "$INSTALL_DIR/docker-compose.yml" <<'COMPOSEEOF'

volumes:
  pgdata:
  redisdata:

networks:
  internal:
    driver: bridge
COMPOSEEOF
  fi
}

write_caddyfile() {
  cat > "$INSTALL_DIR/Caddyfile" <<CADDYEOF
${DOMAIN} {
    reverse_proxy fluxure:3000
}
CADDYEOF
}

write_update_script() {
  cat > "$INSTALL_DIR/update.sh" <<'UPDATEEOF'
#!/usr/bin/env bash
set -euo pipefail

if [ ! -f docker-compose.yml ]; then
  echo "Error: docker-compose.yml not found in current directory."
  echo "Run this script from your Fluxure install directory."
  exit 1
fi

# Pre-update database backup
echo "Creating pre-update database backup..."
mkdir -p backups
BACKUP_FILE="backups/pre-update-$(date +%F-%H%M%S).sql.gz"
if docker compose exec -T postgres pg_dump -U fluxure fluxure | gzip > "$BACKUP_FILE"; then
  if [ -s "$BACKUP_FILE" ]; then
    echo "✓ Backup saved to $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
  else
    rm -f "$BACKUP_FILE"
    echo "⚠ Backup file is empty — proceeding without backup"
  fi
else
  rm -f "$BACKUP_FILE"
  echo "⚠ Backup failed — proceeding without backup"
fi

# Save current image digest for rollback
OLD_IMAGE="$(docker compose images fluxure -q 2>/dev/null | head -1 || true)"

echo "Pulling latest Fluxure image..."
docker compose pull fluxure

echo "Restarting Fluxure..."
docker compose up -d fluxure

echo "Waiting for Fluxure to start..."
timeout=60; elapsed=0
while [ $elapsed -lt $timeout ]; do
  if docker compose exec -T fluxure wget -qO- http://localhost:3000/api/health 2>/dev/null | grep -q '"ok"'; then
    echo "✓ Fluxure updated and healthy"
    exit 0
  fi
  sleep 2; elapsed=$((elapsed + 2))
done

echo "⚠ Fluxure is not healthy after ${timeout}s."
if [ -n "${OLD_IMAGE:-}" ]; then
  echo ""
  echo "To roll back to the previous image:"
  echo "  docker tag $OLD_IMAGE theflyingrat/fluxure:rollback"
  echo "  Edit docker-compose.yml: change image to theflyingrat/fluxure:rollback"
  echo "  docker compose up -d fluxure"
fi
echo ""
echo "Check logs: docker compose logs -f fluxure"
UPDATEEOF

  chmod +x "$INSTALL_DIR/update.sh"
}

# ============================================================
#  Update (existing install — pull latest image + restart)
# ============================================================
do_update() {
  step_header 1 1 "Updating Fluxure"

  cd "$INSTALL_DIR"

  # Pre-update database backup
  gum spin --spinner dot --title "Creating pre-update backup..." -- bash -c '
    mkdir -p backups
    docker compose exec -T postgres pg_dump -U fluxure fluxure | gzip > "backups/pre-update-$(date +%F-%H%M%S).sql.gz"
  '
  local backup_file
  backup_file="$(ls -t backups/pre-update-*.sql.gz 2>/dev/null | head -1)"
  if [ -n "$backup_file" ] && [ -s "$backup_file" ]; then
    success_mark "Backup: $backup_file ($(du -h "$backup_file" | cut -f1))"
  else
    warn_mark "Backup may have failed — check backups/ directory"
  fi

  # Save current image digest for rollback
  local old_image
  old_image="$(docker compose images fluxure -q 2>/dev/null | head -1 || true)"

  gum spin --spinner dot --title "Pulling latest Fluxure image..." -- \
    docker compose pull --quiet fluxure

  success_mark "Image pulled"

  gum spin --spinner dot --title "Restarting Fluxure..." -- \
    docker compose up -d fluxure

  # Wait for health
  local timeout=90 elapsed=0
  while [ $elapsed -lt $timeout ]; do
    if docker compose exec -T fluxure wget -qO- http://localhost:3000/api/health 2>/dev/null | grep -q '"ok"'; then
      break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo ""
  if [ $elapsed -lt $timeout ]; then
    success_mark "Fluxure updated and healthy"
  else
    warn_mark "Fluxure is still starting — check logs with: docker compose logs -f"
    if [ -n "${old_image:-}" ]; then
      echo ""
      echo "  To roll back: docker tag $old_image theflyingrat/fluxure:rollback"
      echo "  Then edit docker-compose.yml and run: docker compose up -d fluxure"
    fi
  fi

  # Show current version info
  local image_id
  image_id="$(docker compose images fluxure -q 2>/dev/null | head -1)"
  if [ -n "$image_id" ]; then
    success_mark "Image: ${image_id:0:12}"
  fi

  echo ""
  gum style \
    --border rounded \
    --border-foreground 82 \
    --padding "1 3" \
    --align center \
    "✦  Update complete"
}

# ============================================================
#  Uninstall
# ============================================================
do_uninstall() {
  header

  if [ ! -d "$INSTALL_DIR" ] || [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    warn_mark "No installation found at $INSTALL_DIR"
    exit 0
  fi

  echo ""
  gum style \
    --foreground 196 \
    --bold \
    "  Uninstall Fluxure"
  echo ""

  local choice
  choice=$(gum choose \
    "Stop only — stop containers, keep data and config" \
    "Remove containers — stop and remove containers, keep volumes and config" \
    "Remove everything — delete containers, volumes, and config (destroys all data)" \
    "Cancel")

  echo ""

  case "$choice" in
    "Stop only"*)
      cd "$INSTALL_DIR"
      gum spin --spinner dot --title "Stopping containers..." -- \
        docker compose stop 2>/dev/null || true
      success_mark "Containers stopped"
      echo ""
      info_panel \
        "Containers stopped. Data and config preserved at:" \
        "  $INSTALL_DIR" \
        "" \
        "Restart with: cd $INSTALL_DIR && docker compose up -d"
      ;;
    "Remove containers"*)
      cd "$INSTALL_DIR"
      gum spin --spinner dot --title "Removing containers..." -- \
        docker compose down 2>/dev/null || true
      success_mark "Containers removed"
      success_mark "Volumes preserved (database, redis)"
      success_mark "Config preserved ($INSTALL_DIR)"
      echo ""
      info_panel \
        "Containers removed. Your data and config are intact." \
        "" \
        "Reinstall with: ./install.sh" \
        "Your existing secrets and database will be reused."
      ;;
    "Remove everything"*)
      if ! confirm "This will DELETE ALL DATA including your database. Are you sure?"; then
        gum style --foreground 214 "Uninstall cancelled."
        exit 0
      fi
      echo ""
      cd "$INSTALL_DIR"
      gum spin --spinner dot --title "Removing containers and volumes..." -- \
        docker compose down --volumes --remove-orphans 2>/dev/null || true
      success_mark "Containers and volumes removed"
      cd /
      rm -rf "$INSTALL_DIR"
      success_mark "Configuration removed ($INSTALL_DIR)"
      echo ""
      gum style \
        --border rounded \
        --border-foreground 82 \
        --padding "1 3" \
        --align center \
        "Fluxure has been fully uninstalled." \
        "" \
        "Docker images may still be cached." \
        "Run 'docker image prune' to reclaim space."
      ;;
    *)
      gum style --foreground 214 "No changes made."
      ;;
  esac
}

# ============================================================
#  Existing Install Menu
# ============================================================
handle_existing_install() {
  echo ""
  info_panel \
    "Existing Fluxure installation found at:" \
    "  $INSTALL_DIR"

  # Show running status
  cd "$INSTALL_DIR"
  if docker compose ps --status running 2>/dev/null | grep -q fluxure; then
    success_mark "Fluxure is currently running"
  else
    warn_mark "Fluxure is not currently running"
  fi
  echo ""

  local choice
  choice=$(gum choose \
    "Update — pull latest image and restart" \
    "Reconfigure — change domain, Google, SMTP settings" \
    "Fresh install — regenerate all config and secrets" \
    "Cancel — leave everything as-is")

  case "$choice" in
    Update*)
      do_update
      exit 0
      ;;
    Reconfigure*)
      # Load existing secrets from .env so we preserve them
      load_existing_secrets
      ;;
    "Fresh install"*)
      echo ""
      gum style --foreground 196 --bold "  ⚠  This will regenerate all secrets."
      warn_mark "Your existing database password will change,"
      warn_mark "which means the database will become inaccessible."
      echo ""
      if ! confirm "Are you sure you want a fresh install?"; then
        gum style --foreground 214 "Cancelled."
        exit 0
      fi
      # Stop existing services first
      cd "$INSTALL_DIR"
      gum spin --spinner dot --title "Stopping existing services..." -- \
        docker compose down 2>/dev/null || true
      ;;
    *)
      gum style --foreground 214 "No changes made."
      exit 0
      ;;
  esac
}

# Load secrets from an existing .env so reconfigure preserves them
EXISTING_PG_PASS=""
EXISTING_JWT_SECRET=""
EXISTING_ENC_KEY=""
EXISTING_REDIS_PASS=""
USE_EXISTING_SECRETS=false

load_existing_secrets() {
  if [ -f "$INSTALL_DIR/.env" ]; then
    EXISTING_PG_PASS="$(grep -oP '^POSTGRES_PASSWORD=\K.*' "$INSTALL_DIR/.env" 2>/dev/null || true)"
    EXISTING_JWT_SECRET="$(grep -oP '^JWT_SECRET=\K.*' "$INSTALL_DIR/.env" 2>/dev/null || true)"
    EXISTING_ENC_KEY="$(grep -oP '^ENCRYPTION_KEY=\K.*' "$INSTALL_DIR/.env" 2>/dev/null || true)"
    EXISTING_REDIS_PASS="$(grep -oP '^REDIS_PASSWORD=\K.*' "$INSTALL_DIR/.env" 2>/dev/null || true)"

    if [ -n "$EXISTING_PG_PASS" ] && [ -n "$EXISTING_JWT_SECRET" ] && [ -n "$EXISTING_ENC_KEY" ]; then
      USE_EXISTING_SECRETS=true
      success_mark "Existing secrets preserved"
    fi
  fi
}

# ============================================================
#  Main
# ============================================================
main() {
  # When piped via curl | bash, stdin is the script itself — rebind to /dev/tty
  # so Gum prompts can read user input from the terminal
  if [ ! -t 0 ]; then
    exec < /dev/tty || die "This installer requires an interactive terminal."
  fi

  # Handle --uninstall flag before Gum (in case Gum isn't installed)
  if [ "${1:-}" = "--uninstall" ] || [ "${1:-}" = "uninstall" ]; then
    ensure_gum
    do_uninstall
    exit 0
  fi

  # Handle --update flag for scriptable updates
  if [ "${1:-}" = "--update" ] || [ "${1:-}" = "update" ]; then
    ensure_gum
    header
    if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
      die "No installation found at $INSTALL_DIR. Run install.sh first."
    fi
    do_update
    exit 0
  fi

  ensure_gum
  header

  # Warn if running as root (but don't block — Docker often needs it)
  if [ "$(id -u)" -eq 0 ]; then
    warn_mark "Running as root — .env file permissions will be set to 600"
    echo ""
  fi

  # Check for existing installation
  if [ -f "$INSTALL_DIR/docker-compose.yml" ] && [ -f "$INSTALL_DIR/.env" ]; then
    handle_existing_install
  fi

  check_prerequisites
  setup_domain
  setup_google
  setup_smtp
  launch
}

main "$@"
