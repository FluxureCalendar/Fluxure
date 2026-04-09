#!/usr/bin/env bash
set -euo pipefail

# Fluxure self-hosted update script
# Run from your Fluxure install directory (where docker-compose.yml lives)

if [ ! -f docker-compose.yml ]; then
  echo "Error: docker-compose.yml not found in current directory."
  echo "Run this script from your Fluxure install directory."
  exit 1
fi

# ── Pre-update database backup ──────────────────────────────
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

# ── Save current image digest for rollback ──────────────────
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

# ── Health check failed — offer rollback ────────────────────
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
