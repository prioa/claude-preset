import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'infobar',
  component: 'Pane',
  requestId: 'infobar',
  props: {
    title: 'Infobar',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const USAGE = {
  startedAt: 0,
  context: { percent: 42, tokens: 420_000, window: 1_000_000 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 13 }],
}

test('the pane shows the figures and switches account', async ($, on) => {
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  const ran: string[] = []
  on('clock.now', () => ({ value: 1000 }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.turns', () => ({ value: 4 }))
  on('session.usage', () => ({ value: USAGE }))
  on('ui.close', () => ({ value: undefined }))
  on('command.run', (_, e) => {
    ran.push(e.command)
    return { text: '' }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    ran.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /^Context/ }))?.text).toMatch(/42% · 420k \/ 1M/)
    expect((await ui.find({ type: 'Text', text: /^5h/ }))?.text).toMatch(/13%/)
    expect((await ui.find({ type: 'Text', text: /^Session/ }))?.text).toBe('Session 0m · 4 Prompts')

    await ui.press({ key: 'login' })
    expect(ran).toEqual(['login'])
    await ui.unmount()
  }
})
