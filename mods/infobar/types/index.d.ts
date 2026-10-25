export type Sample = { at: number; pct: number }

declare module 'claude-code' {
  interface PluginState {
    infobar: {
      samples: Shaped<Sample[]>
      warned: Shaped<string[]>
    }
  }
}
