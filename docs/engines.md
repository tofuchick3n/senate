# Engines

Senate spawns wrapped CLIs as child processes. Four engines are configured: **claude**, **codex**, **gemini**, and **vibe**. Each must be installed and authenticated independently.

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
| **codex** | `exec <prompt> --json --skip-git-repo-check -s read-only` (plus `-m <SENATE_CODEX_MODEL>` only when set) | Walk NDJSON for the last `item.completed` `agent_message`, take `item.text` | From `turn.completed.usage`: `input_tokens`, `output_tokens` + `reasoning_output_tokens` (rolled into outputTokens). No `costUsd` — ChatGPT Plus is flat-rate | 2 | ✅ | 240s | — |
| **gemini** | `-p <prompt> -m <SENATE_GEMINI_MODEL or gemini-3-flash-preview> --skip-trust --output-format json` | Strip noise lines, parse `response` field | Sum `stats.models.<m>.tokens.{input,candidates,total}` | 3 | ⛔ opt-in | 240s | `GEMINI_CLI_TRUST_WORKSPACE=true` |
| **vibe** | `-p <prompt> --output text` (or wrapper invocation) | Trim stdout (or read vibe session log when via wrapper) | Tokens from vibe session log when present | 4 (fallback only) | ❌ (execution grunt; opt-in via `-a`) | 60s | — |

**Default-advisor policy.** Claude + codex are flat-rate (Claude subscription / ChatGPT Plus), so they don't surprise you with a bill mid-month. Gemini was a default advisor in v0.4.x but was demoted to opt-in in v0.4.7 after a real-world incident where an account hit its monthly spending cap and every senate run silently degraded to claude-only with `synthesis: null`. Vibe stays opt-in for a different reason: it's the executor for `--execute-only`, and its advisor-style responses are less useful than claude/codex/gemini for review/decision tasks. Both remain in `inSynthesisPriority` as fallback synthesis leads when their predecessors fail.

## Status semantics

`EngineResult.status` values:

| Status | Condition |
|--------|-----------|
| `ok` | Exit 0, output produced |
| `error` | Non-zero exit, no auth pattern matched |
| `missing` | Strict `spawn <name>: ENOENT/EACCES/EPERM/ENOTDIR` sentinel from the spawn-error handler (binary not on PATH or unspawnable). Previously matched any "not found" substring in combined output, which misclassified long-running engine responses; tightened in v0.4.6 |
| `unauthenticated` | Non-zero exit + auth pattern matched |
| `cancelled` | Killed mid-flight by SIGINT (partial output discarded) |

## Cancellation

Engines spawn with `detached: true` so `process.kill(-pid, sig)` terminates the whole subprocess tree. Some wrapped CLIs (e.g., gemini) ignore SIGTERM on the parent alone. Signal order: SIGTERM, then SIGKILL after 1s grace.

## Timeouts

| Type | Default | Notes |
|------|---------|-------|
| Inactivity | `RunEngineOptions.inactivityMs` | Per-engine, from registry's `advisorInactivityMs` (claude=240s, codex=240s, gemini=240s, vibe=60s). Override globally with `senate --timeout <seconds>`. JSON-output engines need a longer value because the response is buffered until the model is done — for those, the inactivity timer is effectively the total runtime budget. Codex streams NDJSON but the model still buffers reasoning before the first item, so it gets the same 240s budget as claude/gemini |
| Health-check inactivity | per-registry `healthCheckTimeoutMs` | Used by `senate --check-engines` |

When the inactivity timer fires, the error message says `Inactivity timeout (no output for Ns — try --timeout <seconds> ...)` so it's distinguishable from a subprocess error or a Ctrl-C cancel.

## Adding a new engine

Append an entry to the `REGISTRY` array in `src/registry.ts`. Example for a hypothetical `newengine` CLI that exposes `newengine -p <prompt> --json`:

```ts
entry({
  name: 'newengine',
  defaultBinName: 'newengine',
  args: (p) => ['-p', p, '--json'],
  parse: (stdout) => {
    try { return JSON.parse(stdout).response ?? stdout.trim(); }
    catch { return stdout.trim(); }
  },
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

For an NDJSON-streaming engine where the final text and usage land in different event types, see how `codex` is wired in `src/registry.ts` (`parseCodexJsonl` walks the stream once and returns both).

This single edit wires the engine into: CLI default-advisors, synthesis priority, auth detection, `--list-engines`, env override resolution.
