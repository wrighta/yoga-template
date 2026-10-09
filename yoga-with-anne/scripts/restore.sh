#!/bin/sh
# Restore a backup. DESTRUCTIVE: stops nothing for you - stop the app first!
# Usage: scripts/restore.sh /var/backups/yoga/yoga-2026-01-31.db /data
set -eu

BACKUP="${1:?Usage: restore.sh <backup.db> <data-dir>}"
DATA_DIR="${2:-/data}"
DB_FILE="$DATA_DIR/app.db"

if [ ! -f "$BACKUP" ]; then
  echo "Backup file not found: $BACKUP" >&2
  exit 1
fi

echo "About to REPLACE $DB_FILE with $BACKUP"
echo "Type RESTORE to continue:"
read -r confirm
[ "$confirm" = "RESTORE" ] || { echo "Aborted."; exit 1; }

cp "$DB_FILE" "$DB_FILE.pre-restore-$(date +%s)"   # safety copy of current state
rm -f "$DB_FILE-wal" "$DB_FILE-shm"
cp "$BACKUP" "$DB_FILE"
chown "$(stat -c '%U:%G' "$DATA_DIR")" "$DB_FILE" 2>/dev/null || true
echo "Restored. Start the app and check /api/health and /admin."
