#!/usr/bin/env bash
set -euo pipefail

# Fluxure PostgreSQL Backup Script
# Usage: ./scripts/backup.sh [output_dir]
# Crontab example: 0 3 * * * /opt/fluxure/scripts/backup.sh /backups

BACKUP_DIR="${1:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
CONTAINER="${POSTGRES_CONTAINER:-fluxure-postgres-1}"
DB_NAME="${POSTGRES_DB:-fluxure}"
DB_USER="${POSTGRES_USER:-fluxure}"
TIMESTAMP=$(date +%F-%H%M%S)
FILENAME="fluxure-${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup to ${BACKUP_DIR}/${FILENAME}"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "${BACKUP_DIR}/${FILENAME}"

SIZE=$(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)
echo "[$(date)] Backup complete: ${FILENAME} (${SIZE})"

# Clean up old backups
if [ "$RETENTION_DAYS" -gt 0 ]; then
  DELETED=$(find "$BACKUP_DIR" -name "fluxure-*.sql.gz" -mtime +"$RETENTION_DAYS" -delete -print | wc -l)
  if [ "$DELETED" -gt 0 ]; then
    echo "[$(date)] Cleaned up ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
  fi
fi
