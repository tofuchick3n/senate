# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`senate` is a Node 18+ TypeScript ESM CLI (commander) that spawns local model CLIs (`claude`, `gemini`, `vibe`) as child processes, consults them in parallel, and synthesizes their answers into structured output (consensus / disagreements / outliers / recommendation). It handles no API keys itself — each wrapped CLI authenticates independently.

## Commands

```bash
npm run build         # tsc → dist/
npm run typecheck     # tsc --noEmit
npm test              # tsc, then node --test dist/__tests__/*.test.js
npm run dev -- "..."  # tsx watch mode
npm start -- "..."    # tsx one-shot

# Run a single test file:
node --test dist/__tests__/registry.test.js   # after npm run build

# Local CLI install:
npm run build && npm link
senate --check-engines
```

Tests are pure `node:test` against the **compiled** output in `dist/__tests__/`, not against TS sources. `npm test` rebuilds first.

## Architecture (the parts that span files)

Pipeline: `cli.ts` → `workflow.ts` → (optional `orchestrator.ts` if `--smart`) → parallel `engines.ts` calls → `synthesis.ts` → render. See `docs/architecture.md` for the full diagram.

Key invariants future edits must preserve:

- **Registry is the single source of truth.** `src/registry.ts` defines every engine's bin, args, parse fn, usage parser, auth patterns, synthesis priority, default-advisor membership, and timeouts. CLI defaults, `--list-engines`, `SENATE_<NAME>_BIN` overrides, auth detection, and synthesis lead-fallback all flow from this one array. Adding an engine = one entry; do not scatter engine knowledge across modules.

- **Synthesis lead has a fallback chain.** `synthesize()` tries leads in `getSynthesisPriority()` order (claude → gemini → vibe). Vibe is fallback-only; its structured outputs are weaker. First success wins; all fail → `synthesis: null` and workflow continues.

- **Structured JSON is the synthesis source of truth.** `parseStructured` coerces partial/malformed JSON into safe defaults; `renderSynthesis` deterministically renders prose **from** the structured object. The human view and `--json` consumers must stay in sync because they share that source.

- **JSON-buffered engines need long inactivity timeouts.** claude and gemini run with `--output-format json`, so stdout stays silent until the model finishes — the inactivity timer is effectively the full-response budget (claude/gemini = 120s, vibe text = 60s). Don't reintroduce a hard wall-clock cap (see commits 1fb6496, 2719191).

- **Cancellation requires process-group kills.** Engines spawn with `detached: true` so `process.kill(-pid, SIGTERM)` then `SIGKILL` after 1s grace tears down the whole subtree. Some wrapped CLIs (gemini) ignore SIGTERM on the parent alone. First Ctrl-C aborts; second exits 130.

- **One event stream, three subscribers.** `WorkflowEvent`s flow through `RunOptions.onEvent`. cli.ts wires three independent listeners onto it: TUI dashboard, JSONL transcript writer, and `--json-stream` NDJSON output. Don't add side-channel state — emit an event.

- **TUI auto-disables in non-TTY / JSON modes.** `--json`, `--json-stream`, non-TTY stderr, or `--no-tui` falls back to static per-engine settle lines. stdout stays clean for piping; the dashboard renders to stderr only.

- **Transcripts are best-effort.** JSONL writes to `~/.senate/sessions/<utc>-<seq>.jsonl` must never block the run on IO failure — print one stderr warning and continue.

## Module map

| File | Owns |
|---|---|
| `src/cli.ts` | Commander entry, flag parsing, output dispatch, TUI/transcript/REPL wiring, SIGINT |
| `src/workflow.ts` | `runWorkflow`, phase orchestration, event emission, result formatting |
| `src/orchestrator.ts` | `--smart` Claude routing call only |
| `src/engines.ts` | `runEngine` (spawn + auth detection + cancellation + usage parsing), `checkEngines` |
| `src/registry.ts` | Engine config + helpers (see invariant above) |
| `src/synthesis.ts` | Lead-fallback chain, `extractJson`, `parseStructured`, `renderSynthesis` |
| `src/transcripts.ts` | Streaming JSONL writer + session list/resume |
| `src/tui.ts` | Live dashboard via `log-update` |
| `src/repl.ts` | `senate>` REPL, prior-turn context compression |

## Conventions

- ESM only (`"type": "module"`). Use `.js` extensions on relative imports in TS source.
- No new runtime deps unless necessary — current set is `commander` + `log-update`.
- When adding an engine, add it to `REGISTRY` in `src/registry.ts` and add a usage-parser test in `src/__tests__/`. See `docs/engines.md` for the full template.
