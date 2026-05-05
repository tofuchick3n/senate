# Engines

## Overview

Senate expects each engine to be a CLI binary on PATH that accepts a prompt argument, prints text to stdout, and exits 0 on success.

## Supported engines

| Name | Binary | Install | Auth | Common Failure Mode |
|---|---|---|---|---|
| claude | `claude` | `npm install -g @anthropics/claude-code` | `claude` login | "not logged in" |
| vibe | `vibe` | `npm install -g @mistralai/vibe` | `vibe --setup` | "please run vibe --setup" |
| gemini | `gemini` | `npm install -g @google/gemini-cli` | `GEMINI_API_KEY` env | "must specify the gemini_api_key" |

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

Auth detection patterns (case-insensitive): "not logged in", "please run /login", "please run claude auth", "please run vibe --setup", "api key not found/not valid/not set/required", "authentication failed/required", "not authenticated", "must specify the gemini_api_key".

## Timeouts

- **Inactivity timeout**: 30s default. SIGKILL sent if no output for this duration. Configurable per call.
- **Hard cap**: 5 minutes absolute maximum runtime.

## Adding a new engine

1. Add entry to `ENGINE_CONFIGS` in `src/engines.ts`:
   - `name`: string identifier
   - `bin`: binary name
   - `args`: `(prompt: string) => string[]`
   - `parse`: `(output: string) => string`
2. Extend auth patterns array if the engine uses new failure messages.

Example for hypothetical Codex engine:
```typescript
{
  name: 'codex',
  bin: 'codex',
  args: (prompt: string) => ['--prompt', prompt],
  parse: (output: string) => output.trim(),
}
```
