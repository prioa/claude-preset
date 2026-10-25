#!/usr/bin/env bash
# Einzeiler fuer neue Rechner/Server:
#   curl -fsSL https://raw.githubusercontent.com/prioa/claude-preset/main/bootstrap.sh | bash
set -euo pipefail

REPO="${PRESET_REPO:-https://github.com/prioa/claude-preset.git}"
DEST="${PRESET_DIR:-$HOME/.claude-preset}"

if ! command -v claude >/dev/null; then
  echo "==> Claude Code installieren"
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
fi

if [[ -d "$DEST/.git" ]]; then
  echo "==> Preset aktualisieren ($DEST)"
  git -C "$DEST" pull --ff-only
else
  echo "==> Preset klonen nach $DEST"
  git clone "$REPO" "$DEST"
fi

exec "$DEST/install.sh"
