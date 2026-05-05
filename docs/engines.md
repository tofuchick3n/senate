# Engines

## Overview

Senate expects each engine to be a CLI binary on PATH that accepts a prompt argument, prints text to stdout, and exits 0 on success.

## Bin overrides

Each engine's binary path can be overridden with `SENATE_<NAME>_BIN` environment variables, e.g.:
```bash
SENATE_CLAUDE_BIN=/opt/homebrew/bin/claude senate "..."
```
The `--list-engines` command shows the resolved bin and flags `[SENATE_<NAME>_BIN]` next to engines that are using an override. `--check-engines` annotates failed engines with their effective bin so debugging custom paths is easy.

## Supported engines

| Name | Binary | Install | Auth | Common Failure Mode | Default in --advisors? |
|---|---|---|---|---|---|
| claude | `claude` | `npm install -g @anthropics/claude-code` | `claude` login | "not logged in" | Yes |
| vibe | `vibe` | `npm install -g @mistralai/vibe` | `vibe --setup` | "please run vibe --setup" | Yes |
| gemini | `gemini` | `npm install -g @google/gemini-cli` | `GEMINI_API_KEY` env | "must specify the gemini_api_key" | No |

## Per-engine quirks

### Claude

Install: `npm install -g @anthropics/claude-code`
Auth: `claude` (browser-based Anthropic login)
Flags: `-p <prompt> --permission-mode bypassPermissions`

### Vibe

Install: `npm install -g @mistralai/vibe`
Auth: `vibe --setup` (Mistral)
Flags: `-p <prompt> --output text`

### Gemini

Install: `npm install -g @google/gemini-cli`
Auth: `GEMINI_API_KEY` environment variable or Google Cloud Code Assist eligibility
Flags: `-p <prompt> --skip-trust --output-format text`
Quirk: Requires `GEMINI_CLI_TRUST_WORKSPACE=true` environment variable.

## Status semantics

| Status | Meaning |
|---|---|
| `ok` | Engine executed successfully, produced output |
| `error` | Non-zero exit code (non-auth failure) |
| `missing` | Binary not on PATH (ENOENT or "not found") |
| `unauthenticated` | Auth failure detected via stdout/stderr pattern matching |
| `cancelled` | Engine was killed mid-flight by Ctrl-C; partial output discarded |

Auth detection now uses per-engine pattern lists (defined in `src/registry.ts`) rather than a single global list. This avoids cross-contamination — e.g. the Gemini-only "must specify the gemini_api_key" string no longer accidentally classifies a Claude error as unauthenticated.

## Adding it to the registry

The single-touchpoint registry in `src/registry.ts` defines all engines. Each engine entry has fields:
- `name` — string identifier used everywhere (CLI flags, JSON output, etc.)
- `defaultBinName` — default binary name on PATH
- `args(prompt)` — argv builder
- `parse(stdout)` — extract the model output from stdout
- `authPatterns` — per-engine substrings (lowercased, matched on stdout+stderr) that mean "auth required". Per-engine, no longer one global list, so failures don't cross-contaminate.
- `inSynthesisPriority` — true if eligible to lead synthesis. Order in the REGISTRY array determines priority.
- `inDefaultAdvisors` — true if in the default `--advisors` list.
- `env` — optional extra env vars merged into the spawned process env (e.g. gemini's `GEMINI_CLI_TRUST_WORKSPACE`).

The bin path is resolved at module load via `SENATE_<NAME>_BIN` env override, falling back to `defaultBinName`.

Example for adding a hypothetical `codex` engine to the registry:
```typescript
{
  name: 'codex',
  defaultBinName: 'codex',
  args: (prompt: string) => ['--prompt', prompt],
  parse: (output: string) => output.trim(),
  authPatterns: ['not logged in', 'authentication required'],
  inSynthesisPriority: true,
  inDefaultAdvisors: false,
  env: {},
}
```

## Timeouts

- **Inactivity timeout**: 30s default. SIGKILL sent if no output for this duration. Configurable per call.
- **Hard cap**: 5 minutes absolute maximum runtime.
