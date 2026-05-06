# Senate

```
   ███████╗███████╗███╗   ██╗ █████╗ ████████╗███████╗
   ██╔════╝██╔════╝████╗  ██║██╔══██╗╚══██╔══╝██╔════╝
   ███████╗█████╗  ██╔██╗ ██║███████║   ██║   █████╗
   ╚════██║██╔══╝  ██║╚██╗██║██╔══██║   ██║   ██╔══╝
   ███████║███████╗██║ ╚████║██║  ██║   ██║   ███████╗
   ╚══════╝╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
       multi-model orchestration
```

Multi-model orchestration CLI that wraps claude, vibe, and gemini, consults them in parallel on a prompt, then synthesizes their answers into a structured CONSENSUS / DISAGREEMENTS / OUTLIERS / RECOMMENDATION report. Uses subscriptions you already pay for — senate handles no API keys itself.

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
# Basic prompt — consults claude + vibe in parallel, synthesizes.
senate "Explain the factory pattern"

# From stdin
echo "Compare Rust and Zig" | senate

# File as prompt
senate < spec.md

# Positional + stdin concatenated
senate "context:" < details.md

# Conversation mode — drops into a senate> REPL after the first answer
senate --repl "First question"

# Reprint a previous session
senate --list-sessions
senate --resume 0
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
| `--no-tui` | Disable the live dashboard (fall back to plain settle-line output) |
| `--repl` | After the first result, drop into a `senate>` REPL with prior turns as context |
| `--no-transcript` | Don't persist this session to `~/.senate/sessions/` |
| `--list-sessions [count]` | List recent saved sessions (default 20) |
| `--resume <ref>` | Reprint a saved session by index (0=newest) or path |
| `--list-engines` | List configured engines + resolved bin paths |
| `--check-engines` | Ping each engine to verify auth |
| `-v, --verbose` | Show mode/advisors at startup |

## Recipes

Senate's `--help` lists every flag, but it doesn't show how to compose them with other tools. Here are patterns I actually use.

### Review a GitHub issue

```bash
# Issue body only
gh issue view 703 --repo OWNER/REPO --json title,body \
  --jq '"# \(.title)\n\n\(.body)"' \
  | senate "Review this issue and recommend next steps:"

# Body + comments (full thread context)
gh issue view 703 --repo OWNER/REPO --json title,body,comments \
  --jq '"# \(.title)\n\n\(.body)\n\n## Comments\n" + ([.comments[] | "**\(.author.login):**\n\(.body)"] | join("\n\n"))' \
  | senate "Help me decide what to do here:"
```

### Issue + linked source code

```bash
{ gh issue view 703 --json body --jq .body
  echo "---"
  cat src/relevant/file.ts
} | senate --consult-only "Review this architecture decision in light of the existing code:"
```

### Just the recommendation, machine-readable

```bash
gh issue view 703 --json body --jq .body \
  | senate "Architecture review:" --json \
  | jq -r .synthesis.structured.recommendation
```

### Iterate on a long doc

```bash
senate --repl < spec.md
# senate> what are the riskiest assumptions?
# senate> draft a migration plan for the database schema
# senate> /history
# senate> /exit
```

### Pick faster advisors

```bash
# Skip vibe (it's slower for read-only review work).
senate -a claude,gemini "Compare REST vs GraphQL for an internal API"
```

### Reprint or re-derive a past session

```bash
senate --list-sessions          # see what you've run recently
senate --resume 0               # newest
senate --resume <path>          # specific file
```

### Pipe a PR diff for review

```bash
gh pr diff 42 | senate "Review for bugs, naming, and edge cases:"
```

### Get just disagreements

```bash
senate "..." --json | jq '.synthesis.structured.disagreements'
```

## Default workflow

By default senate:

1. Reads the prompt (positional arg, stdin, or both concatenated)
2. Consults the default advisors (`claude` and `vibe`) in parallel
3. Synthesizes their outputs into a structured report (consensus / disagreements / outliers / recommendation), with a lead summarizer falling back claude → vibe → gemini if the lead is unavailable
4. Prints to stdout (human-friendly), with progress chatter on stderr

There is no execution by default. To run the orchestrator (Claude decides whether to consult and/or execute via vibe), pass `--smart`.

## Live dashboard

In a real terminal (stderr is a TTY) and human mode, senate shows a live per-advisor panel with an animated spinner, ticking elapsed time, and status glyph. The dashboard renders to stderr so stdout stays clean for piping. It auto-disables when:

- `--json` or `--json-stream` is set (machine modes)
- stderr is not a TTY (output is being piped or redirected)
- you pass `--no-tui`

When disabled, you get the static fallback: banner + per-engine settle line as each advisor finishes.

## Conversation REPL

`senate --repl "First question"` runs the first turn normally, then drops into a `senate>` prompt. Each follow-up turn re-runs the workflow with prior turns prepended as context (using the synthesis recommendation when available, falling back to synthesis prose, then raw advisor outputs).

REPL commands:

| Command | Effect |
|---------|--------|
| `/exit`, `/quit` | Exit cleanly |
| `/clear` | Drop prior context — next turn starts fresh |
| `/history` | List prior turns |

Ctrl-C cancels the current turn (partial result saved); a second Ctrl-C exits. Each turn is its own session file under `~/.senate/sessions/`.

The REPL is skipped automatically in machine modes, when stdin is piped (one-shot input pattern), and after a cancelled run.

## Persistent transcripts

Every senate run writes a JSONL transcript to `~/.senate/sessions/<utc>-<seq>.jsonl` unless `--no-transcript` is set. Each file contains:

- A `session_start` line with the prompt and mode
- Every `WorkflowEvent` as it happens
- A `session_end` line with the full `WorkflowResult`

Manage them with:

```bash
senate --list-sessions          # 20 most recent
senate --list-sessions 5        # most recent 5
senate --resume 0               # reprint newest
senate --resume <path>          # reprint a specific file
```

Writes are best-effort — IO failures never block the run, just print a one-time warning to stderr.

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

## Cost & timing

The human-mode footer includes a USAGE block with per-engine wall-clock, token counts, and (where available) cost:

```
────────────────────────────────────────────────────────────
  USAGE
────────────────────────────────────────────────────────────
  claude                  4.8s  12 tok (6 in / 6 out)  $0.1233
  gemini                  4.6s  12016 tok (3530 in / 27 out)
  synthesis (claude)      4.9s
  ──────────────────── ───────
  total                   9.6s
```

Token counts come from each engine's JSON output mode (claude and gemini). Vibe stays on text mode and currently doesn't surface tokens; only its wall-clock shows up.

Same data is available on `EngineResult.usage` for `--json` consumers.

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
| `src/registry.ts` | Single source of truth for engine config (bin/args/parse, auth patterns, synthesis priority, default advisors, `SENATE_*_BIN` resolution, per-engine `parseUsage` for tokens/cost) |
| `src/transcripts.ts` | Persistent session writer + reader (`~/.senate/sessions/*.jsonl`) |
| `src/tui.ts` | Live dashboard via `log-update` (per-advisor spinner + elapsed) |
| `src/repl.ts` | Conversation REPL — `buildEnrichedPrompt`, `startRepl` |
| `src/ui.ts` | Banner + spinner + section helpers (used in the static fallback) |
| `src/__tests__/` | node:test unit tests |
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
