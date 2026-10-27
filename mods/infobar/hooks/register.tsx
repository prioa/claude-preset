import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit, Timer } from 'claude-code'

import type { Sample } from '../types'
import {
  addSample,
  bar,
  burnOut,
  clock,
  countdown,
  duration,
  formatRows,
  matchProfile,
  parseFields,
  parseGitStatus,
  parseProfiles,
  planLabel,
  prettyModel,
  thresholds,
  tildify,
  tokens,
  warningText,
  weekday,
  type Git,
  type Host,
  type Seg,
  type Tone,
  type LineSettings,
  type Snapshot,
} from './format'

const PANE = 'infobar'
// Focused so its hotkeys reach it (Esc gives the keys back); tall enough for
// every row, the account buttons last.
const PANE_OPEN = { id: PANE, title: 'Infobar', focus: true, closeOnEscape: true, rows: 26 } as const
const CMUX_STATUSLINE = '/.config/cmux-claude-usage/statusline.sh'

// Change the tag when a value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const samples = atom({ plugin: 'infobar', key: 'samples' } as const, [] as Sample[], {
  shape: 'samples-1',
})
const warned = atom({ plugin: 'infobar', key: 'warned' } as const, [] as string[], {
  shape: 'warned-1',
})

type Usage = { context?: SessionContextUsage; rateLimits: readonly SessionRateLimit[] }

// Module state starts over on a reload; register and session.start refill it.
let settings: LineSettings = { fields: parseFields(undefined), bars: false, twoLines: true, compactBelow: 120 }
let profiles: ReturnType<typeof parseProfiles> = {}
let home: string | undefined
let host: Host | undefined
let email: string | undefined
let plan: string | undefined
let model: string | undefined
let mode: string | undefined
let effort: string | undefined
let git: Git | undefined
let mcp: string[] = []
let startedAt: number | undefined
let usage: Usage = { rateLimits: [] }
let resetTimer: Timer | undefined
let hasCmux = false
let ticker: Timer | undefined
let isPaneOpen = false
let ticks = 0

async function loadHost($: EngineInterface) {
  const out = await $.process.run(['sh', '-c', 'hostname -s; printf "%s\\n" "$SSH_CONNECTION" "$HOME"'])
  const [name = '', ssh = '', homeDir = ''] = out.stdout.split('\n')
  host = { name: name.trim(), isSsh: ssh.trim() !== '' }
  home = homeDir.trim() || undefined
  hasCmux = home ? await $.fs.exists(home + CMUX_STATUSLINE) : false
}

async function loadAccount($: EngineInterface) {
  if (!home) return
  try {
    const account = JSON.parse(await $.fs.read(home + '/.claude.json'))?.oauthAccount
    email = account?.emailAddress || undefined
    plan = planLabel(account?.organizationType, account?.organizationRateLimitTier)
  } catch {
    email = plan = undefined
  }
}

async function loadGit($: EngineInterface) {
  const cwd = await $.session.cwd()
  const [status, dirs] = await Promise.all([
    $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { cwd, timeoutMs: 5000 }),
    $.process.run(['git', 'rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir'], {
      cwd,
      timeoutMs: 5000,
    }),
  ]).catch(() => [])
  const parsed = status?.exitCode === 0 ? parseGitStatus(status.stdout) : undefined
  if (!parsed || !dirs) {
    git = undefined
    return
  }
  const [top = '', gitDir = '', commonDir = ''] = dirs.stdout.trim().split('\n')
  const isWorktree = gitDir !== commonDir && gitDir.includes('/worktrees/')
  git = { ...parsed, worktree: isWorktree ? top.split('/').pop() : undefined }
}

async function loadMcp($: EngineInterface) {
  const tools = await $.tool.list()
  const servers = new Set<string>()
  for (const t of tools) {
    const server = t.mcp ? t.name.match(/^mcp__(.+?)__/)?.[1] : undefined
    if (server) servers.add(server)
  }
  mcp = [...servers].sort()
}

async function snapshot($: EngineInterface): Promise<Snapshot> {
  const cwd = await $.session.cwd()

  return {
    now: await $.clock.now(),
    model,
    context: usage.context,
    limits: usage.rateLimits,
    startedAt,
    turns: await $.session.turns(),
    mode,
    effort,
    email,
    plan,
    host,
    profile: host ? matchProfile(host.name, profiles) : undefined,
    cwd: tildify(cwd, home),
    git,
    mcp,
    samples: await read($, samples),
  }
}

// The rows drawn under the prompt, above the engine's hint line.
let rows: Seg[][] = []

// Theme keys, so the colors follow the person's theme.
const TONE_PROPS: Record<Tone, { color?: string; dimColor?: boolean; bold?: boolean }> = {
  dim: { dimColor: true },
  ok: { color: 'success' },
  warn: { color: 'warning' },
  bad: { color: 'error' },
  strong: { bold: true },
}

function show($: EngineInterface, snap: Snapshot) {
  const next = formatRows(snap, settings)
  if (JSON.stringify(next) === JSON.stringify(rows)) return
  rows = next
  $.ui.invalidate('ui.render')
}

async function paint($: EngineInterface) {
  show($, await snapshot($))
}

// Between turns nothing is measured: the countdown and the duration move
// on the clock alone, and git changes come from other terminals.
async function tick($: EngineInterface) {
  ticks += 1
  if (ticks % 4 === 0) await loadGit($)
  await paint($)
}

function takeUsage(u: { context: SessionContextUsage; rateLimits: SessionRateLimit[] }) {
  usage = { context: u.context, rateLimits: u.rateLimits }
}

async function warn($: EngineInterface, snap: Snapshot) {
  const hit = thresholds(snap)
  const before = await read($, warned)
  for (const key of hit.filter(k => !before.includes(k))) {
    $.ui.toast(warningText(key, snap))
  }
  // Keys that dropped below again (after /compact, after a reset) may warn anew.
  await update($, warned, () => hit)

  const spent = snap.limits.find(l => l.percentUsed >= 99 && l.resetsAt)
  if (!spent || resetTimer) return
  const ms = Date.parse(spent.resetsAt ?? '') - snap.now
  if (!(ms > 0)) return
  const label = spent.kind === 'five_hour' ? '5h' : spent.kind === 'seven_day' ? '7d' : spent.kind
  resetTimer = $.clock.after(ms + 30_000, () => {
    resetTimer = undefined
    void $.ui.notify(`${label}-Limit ist wieder frei`, { title: 'Claude' })
  })
}

// The cmux tab-bar gauges were fed by the status line command; hand them the
// same figures so they keep working without it.
async function feedCmux($: EngineInterface, cwd: string) {
  if (!hasCmux || !home) return
  const lim = (kind: string) => {
    const l = usage.rateLimits.find(r => r.kind === kind)
    if (!l) return undefined
    const reset = l.resetsAt ? Math.floor(Date.parse(l.resetsAt) / 1000) : undefined

    return { used_percentage: l.percentUsed, resets_at: reset }
  }
  const payload = {
    session_id: await $.session.id(),
    model: { display_name: model },
    cwd,
    context_window: { used_percentage: usage.context?.percent },
    rate_limits: { five_hour: lim('five_hour'), seven_day: lim('seven_day') },
  }
  await $.process
    .run(['bash', home + CMUX_STATUSLINE], { stdin: JSON.stringify(payload), timeoutMs: 10_000 })
    .catch(() => undefined)
}

// Mode and effort arrive with the settings hooks' input, not on `$`.
async function noteTurn($: EngineInterface, e: { permission_mode?: string; effort?: { level: string } }) {
  const nextMode = e.permission_mode ?? mode
  const nextEffort = e.effort?.level ?? effort
  if (nextMode === mode && nextEffort === effort) return
  mode = nextMode
  effort = nextEffort
  await paint($)
}

export const register: Register = (on, options) => {
  settings = {
    fields: parseFields(typeof options.fields === 'string' ? options.fields : undefined),
    bars: options.bars === true,
    twoLines: options.twoLines !== false,
    compactBelow: typeof options.compactBelow === 'number' ? options.compactBelow : 120,
  }
  profiles = parseProfiles(typeof options.hostProfiles === 'string' ? options.hostProfiles : undefined)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // An earlier version pinned the line with $.ui.status; clear what it left.
    $.ui.status(undefined)
    await $.command.register({ name: 'info', description: 'Infobar: Details zu Context, Limits, Account, Host' })
    await $.command.register({ name: 'account', description: 'Infobar: Account anzeigen, neu einloggen oder ausloggen' })
    await loadHost($).catch(() => undefined)
    model = prettyModel(await $.session.model())
    const now = await $.session.usage()
    startedAt = now.startedAt
    takeUsage(now)
    await Promise.all([loadAccount($), loadGit($), loadMcp($).catch(() => undefined)])
    await paint($)
    ticker?.cancel()
    ticker = $.clock.every(30_000, () => void tick($).catch(() => undefined))

    return started
  })

  on('session.measure', async ($, e, next) => {
    const done = await next(e)
    takeUsage(e)
    model = prettyModel(await $.session.model())
    const fiveHour = e.rateLimits.find(l => l.kind === 'five_hour')
    if (fiveHour) {
      const now = await $.clock.now()
      await update($, samples, list => addSample(list, { at: now, pct: fiveHour.percentUsed }))
    }
    await Promise.all([loadGit($), loadMcp($).catch(() => undefined)])
    const snap = await snapshot($)
    show($, snap)
    await warn($, snap)
    await feedCmux($, await $.session.cwd())
    $.ui.invalidate('ui.render')

    return done
  })

  on('classic.UserPromptSubmit', ($, e, next) => (void noteTurn($, e).catch(() => undefined), next(e)))
  on('classic.PostToolUse', ($, e, next) => (void noteTurn($, e).catch(() => undefined), next(e)))
  on('classic.Stop', ($, e, next) => (void noteTurn($, e).catch(() => undefined), next(e)))

  // Our rows sit on the hint line under the prompt, the engine's line kept
  // beneath them; below `compactBelow` columns only limits, host and git.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const columns = e.viewport?.columns
    if (columns !== undefined && columns !== settings.columns) {
      const wasCompact = settings.columns !== undefined && settings.columns < settings.compactBelow
      settings.columns = columns
      if (wasCompact !== columns < settings.compactBelow) void paint($)
    }
    const own = await next(e)
    if (!rows.length) return own
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {rows.map(row => (
          <Text wrap="truncate-end">
            {row.map(seg => (seg.tone ? <Text {...TONE_PROPS[seg.tone]}>{seg.text}</Text> : seg.text))}
          </Text>
        ))}
        {own}
      </Box>
    )
  })

  // /info toggles: a second /info closes the pane.
  on('command.run', { command: 'info' }, async $ => {
    if (isPaneOpen) {
      await $.ui.close({ id: PANE })
      isPaneOpen = false

      return { text: 'Infobar-Pane geschlossen.' }
    }
    await $.ui.open(PANE_OPEN)
    isPaneOpen = true

    return { text: 'Infobar-Pane geöffnet (Esc oder x schließt).' }
  })

  // Closed by Esc, its × or a button: the next /info opens it again.
  on('ui.close', ($, e, next) => {
    if (e.id === PANE) isPaneOpen = false

    return next(e)
  })

  on('command.run', { command: 'account' }, async $ => {
    await $.ui.open(PANE_OPEN)
    isPaneOpen = true

    return { text: 'Infobar-Pane geöffnet (Esc oder x schließt).' }
  })

  // After a login or logout ~/.claude.json names another account.
  on('command.run', { command: 'login' }, async ($, e, next) => {
    const done = await next(e)
    await loadAccount($)
      .then(() => paint($))
      .catch(() => undefined)

    return done
  })
  on('command.run', { command: 'logout' }, async ($, e, next) => {
    const done = await next(e)
    await loadAccount($)
      .then(() => paint($))
      .catch(() => undefined)

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const switchAccount = (command: string) => {
      void $.ui.close({ id: PANE })
      void $.command.run({ command })
    }
    const width = e.props.bodyColumns ?? 60
    const full = await $.session.usage({ breakdown: 'summary', columns: width }).catch(() => undefined)
    if (full) {
      takeUsage(full)
      startedAt = full.startedAt
    }
    const snap = await snapshot($)
    const categories = (full?.context.breakdown?.categories ?? [])
      // Free space and the autocompact reserve are not usage.
      .filter(c => c.tokens > 0 && !c.isDeferred && !/free space|autocompact/i.test(c.name))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5)

    const limitRow = (kind: string, label: string) => {
      const l = snap.limits.find(r => r.kind === kind)
      if (!l) return <Text dimColor>{label}: noch keine Messung</Text>
      const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN
      const when = Number.isNaN(reset)
        ? ''
        : kind === 'five_hour'
          ? ` · Reset ${clock(reset)} (in ${countdown(reset, snap.now)})`
          : ` · Reset ${weekday(reset)} ${clock(reset)}`
      const out = kind === 'five_hour' ? burnOut(snap.samples, snap.now) : undefined
      const pace =
        out === undefined ? '' : !Number.isNaN(reset) && reset <= out ? ' · Tempo reicht bis Reset' : ` · leer ~${clock(out)}`

      return (
        <Text>
          {label} {bar(l.percentUsed, 10)} {Math.round(l.percentUsed)}%{when}
          {pace}
        </Text>
      )
    }

    const ctx = snap.context

    return (
      <Box flexDirection="column">
        <Text bold>
          {snap.model ?? 'Modell ?'}
          {snap.mode ? ` · ${snap.mode}` : ''}
          {snap.effort ? ` · Effort ${snap.effort}` : ''}
        </Text>
        <Text> </Text>
        <Text>
          Context {bar(ctx?.percent ?? 0, 10)} {Math.round(ctx?.percent ?? 0)}%
          {ctx?.tokens !== undefined ? ` · ${tokens(ctx.tokens)} / ${tokens(ctx.window)}` : ''}
        </Text>
        {categories.map(c => (
          <Text dimColor>
            {'  '}
            {c.name}: {tokens(c.tokens)}
          </Text>
        ))}
        {limitRow('five_hour', '5h')}
        {limitRow('seven_day', '7d')}
        <Text>
          Session {snap.startedAt !== undefined ? duration(snap.now - snap.startedAt) : '–'}
          {snap.turns !== undefined ? ` · ${snap.turns} Prompts` : ''}
        </Text>
        <Text> </Text>
        <Text>
          Host {snap.profile?.label ? `${snap.profile.emoji ?? ''} ${snap.profile.label} (${snap.host?.name})` : snap.host?.name ?? '?'}
          {snap.host?.isSsh ? ' · per SSH' : ' · lokal'}
        </Text>
        <Text>Pfad {snap.cwd}</Text>
        {snap.git && (
          <Text>
            Git {snap.git.branch}
            {snap.git.isDirty ? ' · uncommitted' : ' · sauber'}
            {snap.git.ahead ? ` · ${snap.git.ahead} voraus` : ''}
            {snap.git.behind ? ` · ${snap.git.behind} zurück` : ''}
            {snap.git.worktree ? ` · Worktree ${snap.git.worktree}` : ''}
          </Text>
        )}
        <Text>MCP {mcp.length ? mcp.join(', ') : 'keine verbunden'}</Text>
        <Text> </Text>
        <Text bold>
          Account {snap.email ?? 'nicht eingeloggt'}
          {snap.plan ? ` · ${snap.plan}` : ''}
        </Text>
        <Box gap={2}>
          <Button key="login" label="Anderen Account einloggen" hotkey="l" onPress={() => switchAccount('login')} />
          <Button key="logout" label="Ausloggen" hotkey="o" onPress={() => switchAccount('logout')} />
          <Button key="refresh" label="Aktualisieren" hotkey="r" onPress={() => $.ui.invalidate('ui.render')} />
          <Button key="close" label="Schließen" hotkey="x" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
