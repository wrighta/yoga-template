#!/bin/sh
# Nightly SQLite backup with 30-day retention.
# Install on the host:  crontab:  15 2 * * * /opt/yoga/scripts/backup.sh /var/data /var/backups/yoga
set -eu

DATA_DIR="${1:-/data}"
BACKUP_DIR="${2:-/var/backups/yoga}"
KEEP_DAYS="${KEEP_DAYS:-30}"
DB_FILE="$DATA_DIR/app.db"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%F)"
TARGET="$BACKUP_DIR/yoga-$STAMP.db"

# Consistent online snapshot (safe while the app is running)
sqlite3 "$DB_FILE" ".backup '$TARGET'"

# Keep it small
sqlite3 "$TARGET" "PRAGMA optimize;"

# Retention
find "$BACKUP_DIR" -name 'yoga-*.db' -mtime +"$KEEP_DAYS" -delete

echo "Backup written: $TARGET ($(du -h "$TARGET" | cut -f1))"
