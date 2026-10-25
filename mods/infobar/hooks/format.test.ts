import { describe, expect, test } from 'claude-code/testing'

import {
  addSample,
  bar,
  burnOut,
  formatLine,
  matchProfile,
  parseFields,
  parseGitStatus,
  planLabel,
  prettyModel,
  shortEmail,
  thresholds,
  tildify,
  type Snapshot,
} from './format'

const NOW = Date.parse('2026-10-25T18:00:00Z')
const MIN = 60_000

const base: Snapshot = {
  now: NOW,
  model: 'Opus 5.5 1M',
  context: { percent: 42, tokens: 420_000, window: 1_000_000 },
  limits: [
    { kind: 'five_hour', percentUsed: 13, resetsAt: new Date(NOW + 134 * MIN).toISOString() },
    { kind: 'seven_day', percentUsed: 38 },
  ],
  costUsd: 1.84,
  email: 'someone@example.com',
  plan: 'Max 5×',
  host: { name: 'server1', isSsh: true },
  cwd: '~/app',
  git: { branch: 'main', isDirty: true, ahead: 3, behind: 1 },
  samples: [],
}
const wide = { fields: parseFields(undefined), bars: false, twoLines: false, compactBelow: 120, columns: 200 }

describe('formatLine', () => {
  test('draws every field that has a value, in order', () => {
    expect(formatLine(base, wide)).toBe(
      'Opus 5.5 1M · 🧠 42% 420k/1M · 5h 13% ↺2h14m · 7d 38% · $1.84 · 👤 som…@example Max 5× · 🖥 ssh:server1 ~/app · ⎇ main* ↑3↓1',
    )
  })

  test('marks high values and draws bars', () => {
    const hot = { ...base, context: { percent: 91, window: 1_000_000 }, limits: [{ kind: 'five_hour', percentUsed: 75 }] }
    expect(formatLine(hot, { ...wide, bars: true, fields: ['ctx', '5h'] })).toBe('‼🧠 ▰▰▰▰▰ 91% · ⚠5h ▰▰▰▰▱ 75%')
  })

  test('narrow terminals keep only context, 5h and host, without bars', () => {
    expect(formatLine(base, { ...wide, bars: true, columns: 80 })).toBe(
      '🧠 42% 420k/1M · 5h 13% ↺2h14m · 🖥 ssh:server1 ~/app',
    )
  })

  test('two lines: limits first, then where and who', () => {
    expect(formatLine(base, { ...wide, twoLines: true })).toBe(
      'Opus 5.5 1M · 🧠 42% 420k/1M · 5h 13% ↺2h14m · 7d 38% · $1.84\n👤 som…@example Max 5× · 🖥 ssh:server1 ~/app · ⎇ main* ↑3↓1',
    )
  })

  test('no forecast from samples only seconds apart', () => {
    const samples = [
      { at: NOW - 5_000, pct: 11 },
      { at: NOW, pct: 12 },
    ]
    expect(formatLine({ ...base, samples }, { ...wide, fields: ['5h'] })).toBe('5h 13% ↺2h14m')
  })

  test('a host profile replaces the name and alarms on PROD', () => {
    const prod = { ...base, profile: { emoji: '🔴', label: 'PROD' } }
    expect(formatLine(prod, { ...wide, fields: ['host'] })).toBe('‼🔴 PROD ~/app')
  })

  test('the burn-out forecast, and "enough" when the reset comes first', () => {
    const samples = [
      { at: NOW - 20 * MIN, pct: 50 },
      { at: NOW, pct: 70 },
    ]
    // 1% a minute from 70% → empty in 30 min, before the reset in 134 min.
    const soon = { ...base, samples, limits: [{ kind: 'five_hour', percentUsed: 70, resetsAt: base.limits[0]?.resetsAt }] }
    expect(formatLine(soon, { ...wide, fields: ['5h'] })).toMatch(/^⚠5h 70% ↺2h14m → leer ~\d\d:\d\d$/)

    const slow = { ...soon, samples: [{ at: NOW - 20 * MIN, pct: 69 }, { at: NOW, pct: 70 }] }
    expect(formatLine(slow, { ...wide, fields: ['5h'] })).toBe('⚠5h 70% ↺2h14m ✓')
  })
})

describe('helpers', () => {
  test('plan labels as cmux-claude-usage reads them', () => {
    expect(planLabel('claude_max', 'default_claude_max_5x')).toBe('Max 5×')
    expect(planLabel('claude_max', '')).toBe('Max')
    expect(planLabel('claude_pro', 'default')).toBe('Pro')
    expect(planLabel(undefined, undefined)).toBeUndefined()
  })

  test('emails, models, paths, fields', () => {
    expect(shortEmail('philipp@privaterelay.appleid.com')).toBe('phi…@privaterelay')
    expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(prettyModel('gpt-x')).toBe('gpt-x')
    expect(tildify('/home/me/app', '/home/me')).toBe('~/app')
    expect(tildify('/home/meier', '/home/me')).toBe('/home/meier')
    expect(parseFields('git, nope ,ctx')).toEqual(['git', 'ctx'])
    expect(parseFields('')).toContain('model')
    expect(bar(0)).toBe('▱▱▱▱▱')
    expect(bar(100)).toBe('▰▰▰▰▰')
  })

  test('host profiles match by glob, case-insensitively', () => {
    const profiles = { 'prod-*': { label: 'PROD' }, 'dev?': { label: 'DEV' } }
    expect(matchProfile('PROD-web1', profiles)?.label).toBe('PROD')
    expect(matchProfile('dev2', profiles)?.label).toBe('DEV')
    expect(matchProfile('dev22', profiles)).toBeUndefined()
  })

  test('git status v2', () => {
    const out = '# branch.oid abc\n# branch.head feat\n# branch.upstream origin/feat\n# branch.ab +2 -0\n1 .M N... 100644 100644 100644 a b x.ts\n'
    expect(parseGitStatus(out)).toEqual({ branch: 'feat', isDirty: true, ahead: 2, behind: 0 })
    expect(parseGitStatus('# branch.head main\n')).toEqual({ branch: 'main', isDirty: false, ahead: 0, behind: 0 })
    expect(parseGitStatus('')).toBeUndefined()
  })

  test('samples: a reset starts over, a still value within a minute is skipped', () => {
    const s1 = addSample([], { at: 0, pct: 10 })
    expect(addSample(s1, { at: 30_000, pct: 10 })).toHaveLength(1)
    expect(addSample(s1, { at: 30_000, pct: 11 })).toHaveLength(2)
    expect(addSample(s1, { at: 30_000, pct: 2 })).toEqual([{ at: 30_000, pct: 2 }])
    expect(burnOut(s1, 0)).toBeUndefined()
  })

  test('thresholds', () => {
    expect(thresholds(base)).toEqual([])
    const full = { ...base, context: { percent: 86, window: 1 }, limits: [{ kind: 'seven_day', percentUsed: 95 }] }
    expect(thresholds(full)).toEqual(['ctx85', '7d90'])
  })
})
