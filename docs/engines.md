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

| Engine | Bin | Args | Parse | parseUsage | Auth patterns | Synth priority | Default advisor | Env |
|--------|-----|------|-------|------------|---------------|----------------|-----------------|-----|
| **claude** | `claude` | `-p <prompt> --permission-mode bypassPermissions --output-format json` | `JSON.parse(stdout).result` | `usage.input_tokens`, `usage.output_tokens`, `total_cost_usd` | `not logged in`, `please run /login`, `please run claude auth`, `authentication failed/required`, `not authenticated` | 1 (leads) | ✅ | — |
| **vibe** | `vibe` | `-p <prompt> --output text` | Trim stdout | — | `please run vibe --setup`, `api key not found/not valid/not set/required`, generic auth failures | 2 | ✅ | — |
| **gemini** | `gemini` | `-p <prompt> --skip-trust --output-format json` | Strip noise lines, parse `response` field | Sum `stats.models.<m>.tokens.{input,candidates,total}` | `must specify the gemini_api_key`, generic auth | 3 | ❌ | `GEMINI_CLI_TRUST_WORKSPACE=true` |

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
| Inactivity | `RunEngineOptions.inactivityMs` | 30s for advisor calls; per-registry for `--check-engines`; 60s for synthesis lead |
| Hard cap | 5 minutes | Maximum runtime regardless of activity |

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
  healthCheckTimeoutMs: 15000
})
```

This single edit wires the engine into: CLI default-advisors, synthesis priority, auth detection, `--list-engines`, env override resolution.
