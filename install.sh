#!/usr/bin/env bash
# Spielt das Preset nach ~/.claude ein: settings mergen, Marketplaces + Plugins + Mods installieren.
# Idempotent — nach jedem `git pull` einfach erneut ausfuehren.
set -euo pipefail

PRESET_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS="$CLAUDE_DIR/settings.json"
SKIP_PLUGINS="${SKIP_PLUGINS:-0}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

for cmd in jq git; do
  command -v "$cmd" >/dev/null || die "$cmd fehlt (macOS: brew install $cmd, Debian/Ubuntu: apt install $cmd)"
done
if [[ "$SKIP_PLUGINS" != 1 ]] && ! command -v claude >/dev/null; then
  die "claude fehlt — erst installieren: curl -fsSL https://claude.ai/install.sh | bash"
fi

case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) die "Unbekanntes OS: $(uname -s)" ;;
esac

mkdir -p "$CLAUDE_DIR/backups"

# --- settings.json -----------------------------------------------------------
# Bestehende Datei + base + OS-Overlay: Preset-Keys gewinnen, lokale Zusatz-Keys bleiben.
current='{}'
if [[ -s "$SETTINGS" ]]; then
  jq empty "$SETTINGS" 2>/dev/null || die "$SETTINGS ist kein gueltiges JSON"
  current="$(cat "$SETTINGS")"
fi

# Die Infozeile kommt vom Mod `infobar`; eine alte statusLine des Presets oder
# von cmux-claude-usage faellt weg (der Mod fuettert die cmux-Gauges selbst).
# Eine fremde statusLine bleibt unangetastet.
merged="$(jq -s '
  (.[0] * .[1] * .[2])
  | if ((.statusLine.command // "") | test("cmux-claude-usage/statusline\\.sh$|claude[-_]preset/statusline/"))
    then del(.statusLine) else . end' \
  <(printf '%s' "$current") "$PRESET_DIR/settings/base.json" "$PRESET_DIR/settings/$OS.json")"

if [[ "$(jq -S . <<<"$current")" == "$(jq -S . <<<"$merged")" ]]; then
  log "settings.json unveraendert"
else
  if [[ -s "$SETTINGS" ]]; then
    backup="$CLAUDE_DIR/backups/settings.$(date +%Y%m%d-%H%M%S).json"
    cp "$SETTINGS" "$backup"
    log "Backup: $backup"
  fi
  tmp="$(mktemp "$CLAUDE_DIR/settings.json.XXXXXX")"
  jq . <<<"$merged" >"$tmp"
  mv "$tmp" "$SETTINGS"
  log "settings.json aktualisiert ($OS)"
fi

# --- Plugins -----------------------------------------------------------------
if [[ "$SKIP_PLUGINS" == 1 ]]; then
  log "Plugins uebersprungen (SKIP_PLUGINS=1)"
  exit 0
fi

# `marketplace add` scheitert, wenn er schon da ist — dann reicht ein Update.
add_marketplace() {
  claude plugin marketplace add "$1" </dev/null >/dev/null 2>&1 || true
}

while IFS= read -r mp; do
  log "Marketplace $mp"
  add_marketplace "$mp"
done < <(jq -r '.marketplaces[]' "$PRESET_DIR/plugins.json")

claude plugin marketplace update >/dev/null 2>&1 || warn "marketplace update fehlgeschlagen"

failed=()
install_plugin() {
  log "Plugin $1"
  claude plugin install "$1" --scope user </dev/null || failed+=("$1")
}

while IFS= read -r plugin; do
  install_plugin "$plugin"
done < <(jq -r '.plugins[]' "$PRESET_DIR/plugins.json")

# --- Mods (dieses Repo als lokaler Marketplace) ------------------------------
mp_name="$(jq -r '.name' "$PRESET_DIR/.claude-plugin/marketplace.json")"
mods=()
while IFS= read -r mod; do mods+=("$mod"); done \
  < <(jq -r '.plugins[].name' "$PRESET_DIR/.claude-plugin/marketplace.json")

if ((${#mods[@]})); then
  log "Marketplace $mp_name ($PRESET_DIR)"
  add_marketplace "$PRESET_DIR"
  claude plugin marketplace update "$mp_name" >/dev/null 2>&1 || true
  for mod in "${mods[@]}"; do
    install_plugin "$mod@$mp_name"
  done
fi

if ((${#failed[@]})); then
  warn "Fehlgeschlagen: ${failed[*]}"
  exit 1
fi
log "Fertig. Neue Claude-Session starten, damit alles geladen wird."
