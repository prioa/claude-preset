// Pure formatting for the info line and the pane: no `$`, so the tests can
// drive every branch with plain values.

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Sample = { at: number; pct: number }
export type HostProfile = { emoji?: string; label?: string }
export type Host = { name: string; isSsh: boolean }
export type Git = {
  branch: string
  isDirty: boolean
  ahead: number
  behind: number
  worktree?: string
}

export type Snapshot = {
  now: number
  model?: string
  context?: { percent?: number; tokens?: number; window: number }
  limits: readonly Limit[]
  startedAt?: number
  turns?: number
  mode?: string
  effort?: string
  email?: string
  plan?: string
  host?: Host
  profile?: HostProfile
  cwd?: string
  git?: Git
  mcp?: readonly string[]
  samples: readonly Sample[]
}

export type LineSettings = {
  fields: readonly string[]
  bars: boolean
  twoLines: boolean
  compactBelow: number
  columns?: number
}

// How a run of the line is drawn: `dim` for labels and secondary values,
// `ok`/`warn`/`bad` for load, `strong` bold; absent, plain text.
export type Tone = 'dim' | 'ok' | 'warn' | 'bad' | 'strong'
export type Seg = { text: string; tone?: Tone }

export const ALL_FIELDS = [
  'model',
  'ctx',
  '5h',
  '7d',
  'mode',
  'effort',
  'account',
  'host',
  'mcp',
  'git',
  'session',
] as const
export const COMPACT_FIELDS = ['ctx', '5h', '7d', 'host', 'git'] as const

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const BURN_WINDOW_MS = 30 * 60_000
// Below this span a 1% step reads as a sprint: no forecast yet.
const BURN_MIN_SPAN_MS = 10 * 60_000
// The second line takes these; the first keeps the rest, each in the order configured.
const SECOND_LINE = new Set(['account', 'host', 'mcp', 'git', 'session'])

export function parseFields(raw: string | undefined): string[] {
  const known = new Set<string>(ALL_FIELDS)
  const picked = (raw ?? '')
    .split(',')
    .map(f => f.trim())
    .filter(f => known.has(f))

  return picked.length ? picked : [...ALL_FIELDS]
}

export function loadTone(pct: number): Tone {
  if (pct >= 90) return 'bad'
  if (pct >= 50) return 'warn'

  return 'ok'
}

export function bar(pct: number, segments = 5): string {
  const filled = Math.min(segments, Math.max(0, Math.round((pct / 100) * segments)))

  return '▰'.repeat(filled) + '▱'.repeat(segments - filled)
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`

  return `${n}`
}

export function countdown(resetMs: number, now: number): string {
  const mins = Math.max(0, Math.round((resetMs - now) / 60_000))
  const h = Math.floor(mins / 60)

  return h ? `${h}h${String(mins % 60).padStart(2, '0')}` : `${mins}m`
}

export function clock(ms: number): string {
  const d = new Date(ms)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function weekday(ms: number): string {
  return WEEKDAYS[new Date(ms).getDay()] ?? ''
}

export function duration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000))
  const h = Math.floor(mins / 60)

  return h ? `${h}h${String(mins % 60).padStart(2, '0')}` : `${mins}m`
}

// Plan label as cmux-claude-usage's render.mjs derives it from ~/.claude.json.
export function planLabel(type = '', tier = ''): string | undefined {
  const mult = tier.match(/_(\d+)x$/)?.[1]
  if (type.includes('max')) return mult ? `Max ${mult}×` : 'Max'
  if (type.includes('enterprise')) return 'Enterprise'
  if (type.includes('team')) return 'Team'
  if (type.includes('pro')) return 'Pro'

  return tier || type || undefined
}

export function shortEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  const head = domain.split('.')[0]

  return head ? `${local.slice(0, 3)}…@${head}` : local.slice(0, 3) + '…'
}

export function matchProfile(
  host: string,
  profiles: Readonly<Record<string, HostProfile>>,
): HostProfile | undefined {
  for (const [glob, profile] of Object.entries(profiles)) {
    const pattern = new RegExp(
      '^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      'i',
    )
    if (pattern.test(host)) return profile
  }

  return undefined
}

export function parseProfiles(raw: string | undefined): Record<string, HostProfile> {
  if (!raw?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)

    return parsed && typeof parsed === 'object' ? (parsed as Record<string, HostProfile>) : {}
  } catch {
    return {}
  }
}

/**
 * When the 5h window runs out at the current pace, from the samples of the
 * last 30 minutes; undefined with too little data or no rise.
 */
export function burnOut(samples: readonly Sample[], now: number): number | undefined {
  const recent = samples.filter(s => now - s.at <= BURN_WINDOW_MS)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (!first || !last || last.at - first.at < BURN_MIN_SPAN_MS) return undefined

  const perMs = (last.pct - first.pct) / (last.at - first.at)
  if (perMs <= 0) return undefined

  return last.at + (100 - last.pct) / perMs
}

/** A sample is kept only when the value moved or a minute passed. */
export function addSample(samples: readonly Sample[], next: Sample): Sample[] {
  const last = samples[samples.length - 1]
  // A drop means the window reset: the old pace no longer applies.
  if (last && next.pct < last.pct) return [next]
  if (last && last.pct === next.pct && next.at - last.at < 60_000) return [...samples]

  return [...samples, next].filter(s => next.at - s.at <= BURN_WINDOW_MS).slice(-60)
}

function limit(snap: Snapshot, kind: string): Limit | undefined {
  return snap.limits.find(l => l.kind === kind)
}

const dim = (text: string): Seg => ({ text, tone: 'dim' })

function pctSegs(label: string, pct: number, bars: boolean): Seg[] {
  const tone = loadTone(pct)
  const segs: Seg[] = [dim(label + ' ')]
  if (bars) segs.push({ text: bar(pct) + ' ', tone })
  segs.push({ text: `${Math.round(pct)}%`, tone })

  return segs
}

function fieldSegs(field: string, snap: Snapshot, bars: boolean): Seg[] | undefined {
  switch (field) {
    case 'model':
      return snap.model ? [{ text: snap.model, tone: 'strong' }] : undefined
    case 'ctx': {
      const c = snap.context
      if (c?.percent === undefined) return undefined
      const segs = pctSegs('ctx', c.percent, bars)
      if (c.tokens !== undefined) segs.push(dim(` ${tokens(c.tokens)}/${tokens(c.window)}`))

      return segs
    }
    case '5h': {
      const l = limit(snap, 'five_hour')
      if (!l) return undefined
      const segs = pctSegs('5h', l.percentUsed, bars)
      const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN
      if (!Number.isNaN(reset)) segs.push(dim(` ↺${countdown(reset, snap.now)}`))
      const out = burnOut(snap.samples, snap.now)
      if (out !== undefined) {
        // Empty before the reset at this pace: the time it runs out, in red.
        segs.push(!Number.isNaN(reset) && reset <= out ? { text: ' ✓', tone: 'ok' } : { text: ` → ${clock(out)}`, tone: 'bad' })
      }

      return segs
    }
    case '7d': {
      const l = limit(snap, 'seven_day')
      if (!l) return undefined
      const segs = pctSegs('7d', l.percentUsed, bars)
      const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN
      if (!Number.isNaN(reset)) segs.push(dim(` ↺${weekday(reset)}`))

      return segs
    }
    case 'mode':
      return snap.mode ? [{ text: snap.mode }] : undefined
    case 'effort':
      return snap.effort ? [{ text: snap.effort }] : undefined
    case 'account': {
      const segs: Seg[] = []
      if (snap.email) segs.push({ text: shortEmail(snap.email) })
      if (snap.plan) segs.push(dim((segs.length ? ' ' : '') + snap.plan))

      return segs.length ? segs : undefined
    }
    case 'host': {
      if (!snap.host && !snap.cwd) return undefined
      const p = snap.profile
      const segs: Seg[] = []
      if (p?.label) {
        const isProd = p.label.toUpperCase().includes('PROD')
        segs.push({ text: (p.emoji ? p.emoji + ' ' : '') + p.label, tone: isProd ? 'bad' : 'strong' })
      } else if (snap.host) {
        // A remote host stays at full strength so it is not mistaken for the local one.
        segs.push(snap.host.isSsh ? { text: `ssh:${snap.host.name}` } : dim(snap.host.name))
      }
      if (snap.cwd) segs.push({ text: (segs.length ? ' ' : '') + snap.cwd })

      return segs
    }
    case 'mcp':
      return snap.mcp?.length ? [dim('mcp '), { text: `${snap.mcp.length}` }] : undefined
    case 'git': {
      const g = snap.git
      if (!g) return undefined
      const segs: Seg[] = [dim('⎇ '), { text: g.branch }]
      if (g.isDirty) segs.push({ text: '*', tone: 'warn' })
      const ab = (g.ahead ? `↑${g.ahead}` : '') + (g.behind ? `↓${g.behind}` : '')
      if (ab) segs.push(dim(' ' + ab))
      if (g.worktree) segs.push(dim(` [${g.worktree}]`))

      return segs
    }
    case 'session': {
      if (snap.startedAt === undefined) return undefined
      const segs: Seg[] = [{ text: duration(snap.now - snap.startedAt) }]
      if (snap.turns !== undefined) segs.push(dim(` · ${snap.turns} turns`))

      return segs
    }
    default:
      return undefined
  }
}

export function isCompact(settings: LineSettings): boolean {
  return settings.columns !== undefined && settings.columns < settings.compactBelow
}

/** The rows of the info line as styled runs, one array per row. */
export function formatRows(snap: Snapshot, settings: LineSettings): Seg[][] {
  const compact = isCompact(settings)
  const fields = compact
    ? settings.fields.filter(f => (COMPACT_FIELDS as readonly string[]).includes(f))
    : settings.fields
  const bars = settings.bars && !compact
  const row = (list: readonly string[]) => {
    const segs: Seg[] = []
    let prev: string | undefined
    for (const f of list) {
      const part = fieldSegs(f, snap, bars)
      if (!part?.length) continue
      // Mode and effort read as one setting: a lighter separator between them.
      if (prev) segs.push(dim(prev === 'mode' && f === 'effort' ? ' · ' : ' │ '))
      segs.push(...part)
      prev = f
    }

    return segs
  }

  const rows = settings.twoLines
    ? [row(fields.filter(f => !SECOND_LINE.has(f))), row(fields.filter(f => SECOND_LINE.has(f)))]
    : [row(fields)]

  return rows.filter(r => r.length)
}

/** The info line as plain text, rows joined by newlines. */
export function formatLine(snap: Snapshot, settings: LineSettings): string {
  return formatRows(snap, settings)
    .map(r => r.map(seg => seg.text).join(''))
    .join('\n')
}

/** Thresholds crossed now that were not warned of yet: `ctx85`, `5h90`, `7d90`. */
export function thresholds(snap: Snapshot): string[] {
  const hit: string[] = []
  if ((snap.context?.percent ?? 0) >= 85) hit.push('ctx85')
  if ((limit(snap, 'five_hour')?.percentUsed ?? 0) >= 90) hit.push('5h90')
  if ((limit(snap, 'seven_day')?.percentUsed ?? 0) >= 90) hit.push('7d90')

  return hit
}

export function warningText(key: string, snap: Snapshot): string {
  if (key === 'ctx85') {
    return `Context ${Math.round(snap.context?.percent ?? 0)}% voll – /compact erwägen`
  }
  const l = limit(snap, key === '5h90' ? 'five_hour' : 'seven_day')
  const reset = l?.resetsAt ? Date.parse(l.resetsAt) : NaN
  const when = Number.isNaN(reset) ? '' : `, Reset ${key === '5h90' ? clock(reset) : weekday(reset) + ' ' + clock(reset)}`

  return `${key === '5h90' ? '5h' : '7d'}-Limit bei ${Math.round(l?.percentUsed ?? 0)}%${when}`
}

/** Parses `git status --porcelain=v2 --branch`. */
export function parseGitStatus(out: string): Omit<Git, 'worktree'> | undefined {
  let branch: string | undefined
  let ahead = 0
  let behind = 0
  let isDirty = false
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice(14).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/)
      ahead = Number(m?.[1] ?? 0)
      behind = Number(m?.[2] ?? 0)
    } else if (line.trim() && !line.startsWith('#')) isDirty = true
  }
  if (!branch) return undefined

  return { branch: branch === '(detached)' ? 'detached' : branch, isDirty, ahead, behind }
}

/** `claude-opus-5-5[1m]` → `Opus 5.5 1M`; anything else as given. */
export function prettyModel(id: string): string {
  const m = id.match(/^(?:claude-)?([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?(\[1m\])?$/i)
  if (!m) return id
  const [, family = '', major, minor, oneM] = m
  const name = family.charAt(0).toUpperCase() + family.slice(1)

  return `${name} ${major}${minor ? '.' + minor : ''}${oneM ? ' 1M' : ''}`
}

export function tildify(path: string, home: string | undefined): string {
  if (home && (path === home || path.startsWith(home + '/'))) return '~' + path.slice(home.length)

  return path
}
