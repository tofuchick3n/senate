# Senate

Multi-model orchestration CLI that wraps claude, vibe, and gemini, consults them in parallel on a prompt, then synthesizes their answers into a structured CONSENSUS / DISAGREEMENTS / OUTLIERS / RECOMMENDATION report. Inspired by https://council.armstr.ng/. Uses subscriptions you already pay for — senate handles no API keys itself.

## Install

Node >= 18

```bash
git clone https://github.com/tofuchick3n/senate && cd senate && npm install && npm run build && npm link
```

Bin name: `senate`. After `npm link`, `senate` is on PATH.

## Engines

Three wrapped CLIs. Each must be installed and authenticated independently:

| Engine | Install / Auth |
|--------|----------------|
| claude | Install per Anthropic docs; run `claude` to authenticate |
| vibe | Run `vibe --setup` |
| gemini | Set `GEMINI_API_KEY` env var, or have Code Assist eligibility |

Verify with `senate --check-engines`. List configured engines with `senate --list-engines`.

## Quickstart

```bash
# Basic prompt
senate "Explain the factory pattern"

# From stdin
echo "Compare Rust and Zig" | senate

# File as prompt
senate < spec.md

# Positional + stdin concatenated
senate "context:" < details.md
```

## Flags

| Flag | Description |
|------|-------------|
| `[query]` | Positional. Optional if stdin is piped |
| `--consult-only` | Only consult advisors. Implies execute=false. Bypasses orchestrator |
| `--execute-only` | Only execute via vibe. Implies consult=false. Bypasses orchestrator |
| `--no-consult` | Skip consult phase |
| `--no-execute` | Skip execute phase |
| `--smart` | Opt into orchestrator routing (Claude decides what to do) |
| `-a, --advisors <list>` | Comma-separated advisor names. Default: `claude,vibe` |
| `--no-synthesis` | Skip synthesis step |
| `--json` | Print final WorkflowResult as JSON blob to stdout |
| `--json-stream` | Emit NDJSON events on stdout as they happen. Mutex with `--json` |
| `--list-engines` | List configured engines + resolved bin paths |
| `--check-engines` | Ping each engine to verify auth |
| `-v, --verbose` | Show mode/advisors at startup |

## Default workflow

By default senate:

1. Reads the prompt (positional arg, stdin, or both concatenated)
2. Consults the default advisors (`claude` and `vibe`) in parallel
3. Synthesizes their outputs into a structured report (consensus / disagreements / outliers / recommendation), with a lead summarizer falling back claude → vibe → gemini if the lead is unavailable
4. Prints to stdout (human-friendly), with progress chatter on stderr

There is no execution by default. To run the orchestrator (Claude decides whether to consult and/or execute via vibe), pass `--smart`.

## JSON / NDJSON output

`--json`: prints the full WorkflowResult (decision, advisorResults, synthesis, executionResult, totalDurationMs, cancelled) as one JSON blob on stdout.

`--json-stream`: prints NDJSON events on stdout as the workflow progresses. Event types: `orchestrator_done`, `consult_start`, `engine_done`, `consult_done`, `synthesis_start`, `synthesis_done`, `execute_start`, `execute_done`, plus a final `{type:'result', result:...}`.

In machine modes the banner, spinner, and section headers are silenced. Errors are emitted as `{type:'error', message:'...'}` on stdout.

Useful:

```bash
senate "..." --json | jq .synthesis.structured.disagreements
```

## Bin overrides

Set `SENATE_<NAME>_BIN` to override the binary path:

```bash
SENATE_CLAUDE_BIN=/opt/homebrew/bin/claude senate "..."
```

`--list-engines` and `--check-engines` annotate engines using overrides.

## Cancellation (Ctrl-C)

First Ctrl-C: cancels in-flight engines (SIGTERM, then SIGKILL after 1s grace, kills the whole subprocess group), prints whatever finished, exits 130.

Second Ctrl-C: immediate exit.

## Synthesis output

The synthesizer returns a structured object:

```ts
{
  consensus: string[],
  disagreements: [{ topic: string, positions: [{ engine: string, stance: string }] }],
  outliers: [{ engine: string, note: string }],
  recommendation: string
}
```

Exposed on `WorkflowResult.synthesis.structured` for `--json` consumers. Human view renders this deterministically. If the model returns malformed JSON, falls back to the raw output.

## Project layout

| File | Purpose |
|------|---------|
| `src/cli.ts` | Commander entry, flag parsing, mode determination, output dispatch |
| `src/workflow.ts` | `runWorkflow`, `WorkflowResult`, `WorkflowEvent`, `formatWorkflowResult` |
| `src/orchestrator.ts` | Claude routing decision (only used with `--smart`) |
| `src/engines.ts` | `runEngine` (spawn + auth detection + cancel), `checkEngines` |
| `src/synthesis.ts` | Lead-summarizer fallback, JSON parsing, prose rendering |
| `src/registry.ts` | Single source of truth for engine config |
| `src/ui.ts` | Banner, spinner, section helpers |
| `src/__tests__/` | Node:test unit tests |
| `docs/` | Architecture, usage, engines, roadmap |
| `CHANGELOG.md` | Keep a Changelog format |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | tsc to dist/ |
| `npm test` | Runs node:test on compiled dist/__tests__ |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run dev -- "..."` | tsx watch mode |

## License

MIT
