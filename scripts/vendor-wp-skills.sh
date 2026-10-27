#!/usr/bin/env bash
# Holt WordPress/agent-skills in einer festen Version nach mods/wp-skills/skills.
# Kein Auto-Update: nach dem Lauf den Diff pruefen und erst dann committen.
# Aufruf: scripts/vendor-wp-skills.sh <commit-sha>
set -euo pipefail

REPO=WordPress/agent-skills
sha="${1:?Aufruf: $0 <commit-sha>}"
PRESET_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$PRESET_DIR/mods/wp-skills"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git -C "$tmp" init -q
git -C "$tmp" fetch -q --depth 1 "https://github.com/$REPO.git" "$sha"
git -C "$tmp" checkout -q FETCH_HEAD
full="$(git -C "$tmp" rev-parse HEAD)"
date="$(git -C "$tmp" log -1 --format=%cs)"

# Der Upstream-Build kopiert skills/ nur (ohne Symlinks), das genuegt hier.
if find "$tmp/skills" -type l | grep -q .; then
  echo "Symlinks in skills/, abgebrochen" >&2
  exit 1
fi
# Alte Version in den Temp-Ordner schieben, damit auch geloeschte Dateien im Diff auftauchen.
[[ -d "$DEST/skills" ]] && mv "$DEST/skills" "$tmp/old-skills"
cp -R "$tmp/skills" "$DEST/skills"
cp "$tmp/LICENSE" "$DEST/LICENSE"
cat >"$DEST/VENDOR.md" <<MD
# Vendored: $REPO

- Commit: \`$full\` ($date)
- Source: https://github.com/$REPO/tree/$full/skills
- License: GPL-2.0-or-later (see LICENSE)

Update: \`scripts/vendor-wp-skills.sh <sha>\`, review the diff for prompt injection, then commit.
MD

git -C "$PRESET_DIR" add -A -N -- "$DEST"
git -C "$PRESET_DIR" diff --stat -- "$DEST"
echo "Vendored $REPO@$full. Review the diff before committing."
