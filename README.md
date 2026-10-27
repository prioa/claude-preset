# claude-preset

My Claude Code configuration for every machine and server: settings, plugins, custom mods.

## Install

New machine/server (installs Claude Code if it is missing):

```bash
curl -fsSL https://raw.githubusercontent.com/prioa/claude-preset/main/bootstrap.sh | bash
```

Or manually:

```bash
git clone https://github.com/prioa/claude-preset ~/.claude-preset
~/.claude-preset/install.sh
```

Update: `git -C ~/.claude-preset pull && ~/.claude-preset/install.sh`

Requirements: `git`, `jq`, `claude`.

## What install.sh does

1. **Merge settings.json:** existing `~/.claude/settings.json` + `settings/base.json` + `settings/<darwin|linux>.json`. Preset values win, extra local keys are kept. Before every change a backup goes to `~/.claude/backups/`.
2. **Status line:** none anymore. An old `statusLine` from the preset or from cmux-claude-usage is removed; any other one is left alone. The `infobar` mod shows the info instead.
3. **Plugins:** all marketplaces and plugins from `plugins.json`; built-in ones (`@builtin`) are only enabled.
4. **Mods:** this repo is also the marketplace `prioa-preset`; each mod lives under `mods/<name>/` and is listed in `.claude-plugin/marketplace.json`.

`SKIP_PLUGINS=1 ./install.sh` only merges the settings. `./uninstall.sh` restores the latest settings backup.

## Plugins

| Plugin | Purpose |
| --- | --- |
| `clangd-lsp@claude-plugins-official` | C/C++ LSP |
| `ui-ux-pro-max@ui-ux-pro-max-skill` | UI/UX design skills |
| `cc-plugin-you-should-know@builtin` | Side agent that shows important things above the prompt during longer tasks |
| `pensive@claude-night-market` | Code review incl. the `blast-radius-reviewer` agent (pulls in `leyline` as a dependency) |
| `security-guidance@claude-plugins-official` | Checks Claude's changes for injection, XSS, secrets and similar |
| `chrome-devtools-mcp@claude-plugins-official` | Live Chrome: performance traces, network, console (WP performance, React debugging) |
| `php-lsp@claude-plugins-official` | PHP LSP (Intelephense) |
| `typescript-lsp@claude-plugins-official` | TypeScript/JavaScript LSP |
| `launch-codes@claude-code-mods` | Risky Bash commands (`rm -rf`, force push, `reset --hard`, SQL `DROP`, `curl \| sh` …) need a one-time code + LAUNCH; without input (e.g. `claude -p`) they are blocked. `/launch-codes test <cmd>` checks without running |

External programs (install.sh only warns if they are missing): `intelephense` (`npm i -g intelephense`), `typescript-language-server` (`npm i -g typescript-language-server typescript`), `pio` (`pipx install platformio`).

The night-market star prompt (SessionStart hook of `leyline`) is turned off via `env.CLAUDE_NIGHT_MARKET_NO_STAR_PROMPT` in `settings/base.json`.

New plugin: add it to `plugins.json` (for a third-party marketplace also its `owner/repo`), then run `./install.sh`.

## Mods

### infobar

Draws two lines below the prompt, above Claude Code's hint line (replaces the statusLine):

```
Opus 5.5 1M · 🧠 ▰▰▱▱▱ 42% 420k/1M · 5h ▰▱▱▱▱ 13% ↺2h14m → leer ~20:40 · 7d ▰▰▱▱▱ 38% ↺Mo · $1.84 · auto · high
👤 abc…@example Max 5× · 🖥 ssh:server1 ~/app · 🔌 3 · ⎇ main* ↑3↓1 · ⏱ 1h12 14× $1.53/h
```

- ⚠ from 70 %, ‼ from 90 %. Toast at context ≥ 85 % and limit ≥ 90 %, system message when an exhausted limit is free again.
- `→ leer ~HH:MM` (German for "empty"): projection from the last 30 min; `✓` if the current pace lasts until the reset.
- Narrower than 120 columns: line 1 only context, 5h and 7d, line 2 only host and git, without bars.
- Refresh: after every turn and whenever a limit moves by one point; plus every 30 s (countdown, duration, $/h) and every 2 min for git.
- `/info` opens a pane with details (context by category, limits, host, git, MCP) and account switching (`/login`, `/logout`); `/account` opens it focused. Keys: `r` refresh, `x`/Esc close (`l`/`o` = login/logout where no dropdown is drawn).
- Settings in the `/config` menu: `fields` (order), `bars`, `compactBelow`, `hostProfiles` (e.g. `{"prod-*": {"emoji": "🔴", "label": "PROD"}}`).
- With cmux-claude-usage installed, the mod feeds its tab-bar gauges.

Tests: `claude plugin test mods/infobar`

### agent-library

Specialist agents for WordPress dev, WordPress performance, React/Vite and ESP32/PlatformIO. They are **not** registered as subagents: only the skill description sits in the context. Claude loads the skill when a task in one of these areas comes up, decides whether delegating is worth it (parallel subtasks, an audit that would flood the context, a long autonomous run), and otherwise uses the definition as a checklist inline. To delegate, it reads `agents/<name>.md` and starts a `general-purpose` agent with it.

New agent: add `mods/agent-library/skills/agent-library/agents/<name>.md` and a row to the index in `SKILL.md`.

Written for this preset; [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) and [wshobson/agents](https://github.com/wshobson/agents) (both MIT) served as references.

### wp-skills

The official [WordPress/agent-skills](https://github.com/WordPress/agent-skills) (GPL-2.0-or-later), vendored at a fixed commit (see `mods/wp-skills/VENDOR.md`): `wp-performance`, `wp-plugin-development`, `wp-block-development`, `wp-rest-api`, `wp-wpcli-and-ops`, `wp-phpstan` and more.

Third-party prompts are pinned on purpose, so an upstream change cannot slip prompt injection into every machine. Update:

```bash
scripts/vendor-wp-skills.sh <commit-sha>   # fetch, then review git diff
```

### Adding a mod

```
mods/<name>/.claude-plugin/plugin.json
mods/<name>/{commands,agents,skills,hooks}/...
```

and add it to `.claude-plugin/marketplace.json`:

```json
{ "name": "<name>", "source": "./mods/<name>" }
```
