#!/usr/bin/env bash
# Daily backup of users, journals and screenshots. Add to cron:
#   sudo crontab -e   →   30 2 * * * /opt/tradedesk/deploy/backup.sh
set -euo pipefail
SRC=/opt/tradedesk/data
DEST=/var/backups/tradedesk
mkdir -p "$DEST"
tar --exclude='news.json' -czf "$DEST/tradedesk-$(date +%F).tar.gz" -C "$SRC" .
chmod 600 "$DEST"/*.tar.gz
find "$DEST" -name 'tradedesk-*.tar.gz' -mtime +14 -delete
# Optional off-server copy (needs an IAM role with access to the bucket):
# aws s3 cp "$DEST/tradedesk-$(date +%F).tar.gz" s3://YOUR-BUCKET/tradedesk/
