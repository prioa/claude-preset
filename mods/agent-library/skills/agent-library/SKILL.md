---
name: agent-library
description: Specialist subagent definitions for WordPress development, WordPress performance, React/Vite apps, Grafana (self-hosted) and ESP32/Arduino/PlatformIO firmware. Load when a task in one of these areas is big enough to delegate (parallel subtasks, a broad audit, a long autonomous run), or to get the specialist's checklist for inline work.
---

# Agent library

The definitions in `agents/` (next to this file) are **not** registered as subagents, so they cost no context until needed. Read one only when it is relevant.

## Delegate or work inline?

Spawn a specialist only if at least one applies:

1. **Parallel:** two or more independent subtasks (e.g. audit theme *and* plugin, firmware *and* dashboard).
2. **Context protection:** the exploration or audit would pull many files or long tool output into the main conversation, and only the conclusion matters.
3. **Long autonomous run:** a measured optimization loop or migration that can work without check-ins.

Otherwise work inline: read the matching definition and use its checklist yourself. Never delegate a one-file change, a quick question or something you already have the context for.

## Index

| File | Use for |
| --- | --- |
| `agents/wordpress-dev.md` | Themes, plugins, blocks, REST, WP-CLI, coding standards, security |
| `agents/wp-performance.md` | Measured WordPress speed work: TTFB, queries, autoload, caching, assets, Core Web Vitals |
| `agents/react-vite.md` | React apps on Vite: components, state, routing, build config, bundle size, Vitest |
| `agents/grafana.md` | Self-hosted Grafana: dashboards, queries (PromQL/Flux/InfluxQL/SQL), alerting, provisioning |
| `agents/esp32-firmware.md` | ESP32 with Arduino core or ESP-IDF via PlatformIO: firmware, OTA, power, connectivity |

## Spawning

1. Read `agents/<name>.md`. The header lists `model` and the tools the agent needs.
2. Call `Agent` with `subagent_type: "general-purpose"`, `model` from the header, and a `prompt` made of the definition body followed by the concrete task: goal, paths, constraints, what to return.
3. For parallel work, send all `Agent` calls in one message. Relay what matters from each result; the user does not see it.
