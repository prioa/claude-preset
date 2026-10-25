# claude-preset

Meine Claude-Code-Konfiguration für alle Rechner und Server: settings, Plugins, eigene Mods.

## Installieren

Neuer Rechner/Server (installiert Claude Code, falls es fehlt):

```bash
curl -fsSL https://raw.githubusercontent.com/prioa/claude-preset/main/bootstrap.sh | bash
```

Oder manuell:

```bash
git clone https://github.com/prioa/claude-preset ~/.claude-preset
~/.claude-preset/install.sh
```

Aktualisieren: `git -C ~/.claude-preset pull && ~/.claude-preset/install.sh`

Voraussetzungen: `git`, `jq`, `claude`.

## Was install.sh macht

1. **settings.json mergen:** bestehende `~/.claude/settings.json` + `settings/base.json` + `settings/<darwin|linux>.json`. Werte aus dem Preset gewinnen, lokale Zusatz-Keys bleiben erhalten. Vor jeder Änderung landet ein Backup in `~/.claude/backups/`.
2. **Statusline:** keine mehr. Eine alte `statusLine` des Presets oder von cmux-claude-usage wird entfernt, eine fremde bleibt. Die Infos zeigt der Mod `infobar`.
3. **Plugins:** alle Marketplaces und Plugins aus `plugins.json`; eingebaute (`@builtin`) werden nur aktiviert.
4. **Mods:** dieses Repo ist zugleich der Marketplace `prioa-preset`; jeder Mod liegt unter `mods/<name>/` und wird in `.claude-plugin/marketplace.json` eingetragen.

`SKIP_PLUGINS=1 ./install.sh` mergt nur die settings. `./uninstall.sh` spielt das letzte settings-Backup zurück.

## Plugins

| Plugin | Wozu |
| --- | --- |
| `clangd-lsp@claude-plugins-official` | C/C++-LSP |
| `ui-ux-pro-max@ui-ux-pro-max-skill` | UI/UX-Design-Skills |
| `cc-plugin-you-should-know@builtin` | Side-Agent, der während längerer Tasks Wichtiges über dem Prompt anzeigt |
| `pensive@claude-night-market` | Code-Review inkl. `blast-radius-reviewer`-Agent (zieht `leyline` als Abhängigkeit mit) |

Neues Plugin: in `plugins.json` eintragen (bei fremdem Marketplace auch dessen `owner/repo`), dann `./install.sh`.

## Mods

### infobar

Zeichnet zwei Zeilen unter den Prompt, über die Hinweiszeile von Claude Code (ersetzt die statusLine):

```
Opus 5.5 1M · 🧠 ▰▰▱▱▱ 42% 420k/1M · 5h ▰▱▱▱▱ 13% ↺2h14m → leer ~20:40 · 7d ▰▰▱▱▱ 38% ↺Mo · $1.84 · auto · high
👤 abc…@example Max 5× · 🖥 ssh:server1 ~/app · 🔌 3 · ⎇ main* ↑3↓1 · ⏱ 1h12 14× $1.53/h
```

- ⚠ ab 70 %, ‼ ab 90 %. Toast bei Context ≥ 85 % und Limit ≥ 90 %, Systemnachricht wenn ein erschöpftes Limit wieder frei ist.
- `→ leer ~HH:MM`: Hochrechnung aus den letzten 30 min; `✓`, wenn das Tempo bis zum Reset reicht.
- Schmaler als 120 Spalten: nur Context, 5h und Host.
- Aktualisierung: nach jedem Turn und wenn sich ein Limit um einen Punkt bewegt; dazu alle 30 s (Countdown, Dauer, $/h) und alle 2 min Git.
- `/info` öffnet ein Pane mit Details (Context nach Kategorie, Limits, Host, Git, MCP) und Account-Wechsel (`/login`, `/logout`); `/account` öffnet es mit Fokus. Tasten: `r` aktualisieren, `x`/Esc schließen (`l`/`o` = Login/Logout, wo kein Dropdown gezeichnet wird).
- Einstellungen im `/config`-Menü: `fields` (Reihenfolge), `bars`, `compactBelow`, `hostProfiles` (z.B. `{"prod-*": {"emoji": "🔴", "label": "PROD"}}`).
- Mit installiertem cmux-claude-usage füttert der Mod dessen Tab-Bar-Gauges.

Tests: `claude plugin test mods/infobar`

### Mod hinzufügen

```
mods/<name>/.claude-plugin/plugin.json
mods/<name>/{commands,agents,skills,hooks}/...
```

und in `.claude-plugin/marketplace.json` eintragen:

```json
{ "name": "<name>", "source": "./mods/<name>" }
```
