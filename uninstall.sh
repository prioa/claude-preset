#!/usr/bin/env bash
# Spielt das letzte settings-Backup zurueck. Plugins bleiben installiert
# (entfernen mit: claude plugin uninstall <name@marketplace>).
set -euo pipefail

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
latest="$(find "$CLAUDE_DIR/backups" -maxdepth 1 -name 'settings.*.json' 2>/dev/null | sort | tail -n 1)"

if [[ -z "$latest" ]]; then
  echo "Kein settings-Backup in $CLAUDE_DIR/backups gefunden." >&2
  exit 1
fi

cp "$latest" "$CLAUDE_DIR/settings.json"
echo "==> settings.json aus $latest wiederhergestellt"
