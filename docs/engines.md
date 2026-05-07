# Engines

Senate spawns wrapped CLIs as child processes. Three engines are configured: **claude**, **vibe**, and **gemini**. Each must be installed and authenticated independently.

## Overview

## Source of truth

`src/registry.ts` defines the `REGISTRY` array. Each entry exports:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Engine identifier |
| `defaultBinName` | `string` | Default binary on `PATH` |
| `bin` | `string` | Resolved at module load (env override or default) |
| `binOverridden` | `boolean` | `true` when `SENATE_<NAME>_BIN` is set |
| `args(prompt)` | `(p: string) => string[]` | argv builder |
| `parse(stdout)` | `(s: string) => string` | Extract response text from raw stdout |
| `parseUsage(stdout, stderr)` | `(s: string, e: string) => Usage \| undefined` | Returns `{inputTokens?, outputTokens?, totalTokens?, costUsd?}` |
| `authPatterns` | `string[]` | Substrings (lowercased, matched on stdout+stderr) that trigger `unauthenticated` status |
| `inSynthesisPriority` | `boolean` | Eligible to lead synthesis; array order determines priority |
| `inDefaultAdvisors` | `boolean` | Included in default `--advisors` |
| `healthCheckTimeoutMs` | `number` | Inactivity timeout for `--check-engines` |
| `advisorInactivityMs` | `number` | Inactivity timeout for advisor / synthesis-lead calls. JSON-output engines need a longer value because output is buffered until the model is done |
| `env` | `Record<string, string> \| undefined` | Extra env vars merged into spawned process |

## Bin overrides

Override any engine's binary via environment:

```bash
SENATE_<NAME>_BIN=/path/to/binary senate ...
```

Example:
```bash
SENATE_CLAUDE_BIN=/opt/homebrew/bin/claude senate "..."
```

`--list-engines` shows resolved bins and override flags. `--check-engines` annotates failed engines with their effective bin.

## Per-engine config

| Engine | Args | Parse | parseUsage | Synth priority | Default advisor | Advisor timeout | Env |
|--------|------|-------|------------|----------------|-----------------|-----------------|-----|
| **claude** | `-p <prompt> --permission-mode bypassPermissions --output-format json` | `JSON.parse(stdout).result` | `usage.input_tokens`, `usage.output_tokens`, `total_cost_usd` | 1 (leads) | ✅ | 240s | — |
| **gemini** | `-p <prompt> -m <SENATE_GEMINI_MODEL or gemini-3-flash-preview> --skip-trust --output-format json` | Strip noise lines, parse `response` field | Sum `stats.models.<m>.tokens.{input,candidates,total}` | 2 | ✅ | 240s | `GEMINI_CLI_TRUST_WORKSPACE=true` |
| **vibe** | `-p <prompt> --output text` | Trim stdout | — (text mode doesn't surface tokens) | 3 (fallback only) | ❌ (execution grunt; opt-in via `-a`) | 60s | — |

Vibe is intentionally not in the default advisor set: it's the executor for `--execute-only`, and its advisor-style responses tend to be less useful than claude/gemini for review/decision tasks. It stays in `inSynthesisPriority` only as a last-resort fallback if both claude and gemini are unavailable.

## Status semantics

`EngineResult.status` values:

| Status | Condition |
|--------|-----------|
| `ok` | Exit 0, output produced |
| `error` | Non-zero exit, no auth pattern matched |
| `missing` | ENOENT / "not found" (binary not on PATH or unspawnable) |
| `unauthenticated` | Non-zero exit + auth pattern matched |
| `cancelled` | Killed mid-flight by SIGINT (partial output discarded) |

## Cancellation

Engines spawn with `detached: true` so `process.kill(-pid, sig)` terminates the whole subprocess tree. Some wrapped CLIs (e.g., gemini) ignore SIGTERM on the parent alone. Signal order: SIGTERM, then SIGKILL after 1s grace.

## Timeouts

| Type | Default | Notes |
|------|---------|-------|
| Inactivity | `RunEngineOptions.inactivityMs` | Per-engine, from registry's `advisorInactivityMs` (claude=240s, gemini=240s, vibe=60s). Override globally with `senate --timeout <seconds>`. JSON-output engines need a longer value because the response is buffered until the model is done — for those, the inactivity timer is effectively the total runtime budget |
| Health-check inactivity | per-registry `healthCheckTimeoutMs` | Used by `senate --check-engines` |

When the inactivity timer fires, the error message says `Inactivity timeout (no output for Ns — try --timeout <seconds> ...)` so it's distinguishable from a subprocess error or a Ctrl-C cancel.

## Adding a new engine

Append an entry to the `REGISTRY` array in `src/registry.ts`. Example for `codex`:

```ts
entry({
  name: 'codex',
  defaultBinName: 'codex',
  args: (p) => ['-p', p, '--output-format', 'json'],
  parse: (stdout) => JSON.parse(stdout).result,
  parseUsage: (stdout) => {
    try {
      const obj = JSON.parse(stdout);
      return { totalTokens: obj.usage?.total };
    } catch { return undefined; }
  },
  authPatterns: ['not logged in', 'authentication required'],
  inSynthesisPriority: true,
  inDefaultAdvisors: false,
  healthCheckTimeoutMs: 15000,
  advisorInactivityMs: 240000   // JSON-output engines buffer; needs full-response budget
})
```

This single edit wires the engine into: CLI default-advisors, synthesis priority, auth detection, `--list-engines`, env override resolution.
