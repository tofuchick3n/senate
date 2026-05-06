# Usage

## Install & build

Requires Node ≥ 18.

```bash
git clone https://github.com/tofuchick3n/senate && cd senate
npm install
npm run build
npm link
```

After linking, `senate` is on PATH. Or run directly:

```bash
node dist/cli.js
```

Each wrapped CLI authenticates separately. Verify:

```bash
senate --check-engines
```

## Default workflow

Consults all selected advisors (`claude`, `vibe`) in parallel, synthesizes answers, prints to stdout. No orchestrator round-trip. No vibe execution.

Use `--smart` to opt into orchestrator routing (Claude decides what to do).

## Mode flags

| Flag | Effect |
|------|--------|
| `[query]` | Positional; optional if stdin piped |
| `--consult-only` | Consult only. Implies `execute=false`. Bypasses orchestrator |
| `--execute-only` | Execute via vibe only. Implies `consult=false`. Bypasses orchestrator |
| `--no-consult` | Skip consult phase |
| `--no-execute` | Skip execute phase |
| `--smart` | Orchestrator routing |
| `-a, --advisors <list>` | Comma-separated. Default: `claude,gemini` |
| `--no-synthesis` | Skip synthesis |
| `--timeout <seconds>` | Per-advisor inactivity override (defaults: claude/gemini 120s, vibe 60s) |

## Choosing advisors

```bash
senate -a claude,gemini "Your prompt"        # default — two reasoners
senate -a claude,vibe,gemini "Your prompt"   # add vibe as a third opinion
senate -a claude "Your prompt"               # solo claude (no synthesis runs with <2)
```

Default is `claude,gemini`. Vibe is intentionally **not** in the default advisor set — it's the execution grunt for `--execute-only`, and its advisor-style responses tend to be less useful than claude/gemini for review/decision tasks. Add it explicitly with `-a` if you want a third opinion.

## Live dashboard

In TTY: live per-advisor panel with spinner, elapsed time, status glyph on stderr. stdout stays clean. Auto-disables in machine modes/non-TTY/`--no-tui`.

Footer: per-engine wall-clock, token counts (claude/gemini), cost (claude). Vibe: wall-clock only.

## Conversation REPL

```bash
senate --repl "Initial prompt"
```

Drops into `senate>` REPL after first result. Commands:

| Command | Effect |
|---------|--------|
| `/exit`, `/quit` | Exit REPL |
| `/clear` | Drop context |
| `/history` | List turns |

Ctrl-C cancels current turn; second Ctrl-C exits. Skipped in machine modes/piped stdin/cancelled runs.

## Transcripts

Writes `~/.senate/sessions/<utc>-<seq>.jsonl` unless `--no-transcript`.

Lines: `session_start` (prompt + mode), each `WorkflowEvent`, `session_end` (full `WorkflowResult`).

```bash
senate --list-sessions [count]  # Recent sessions, default 20
senate --resume <ref>           # By index (0=newest) or path
```

## Pipeline use

Stdin:

```bash
echo "query" | senate
senate < spec.md
senate "context:" < details.md
```

Prompt = `<positional>\n\n<stdin>`.

JSON output:

```bash
senate "..." --json | jq .synthesis.structured.recommendation
```

Streaming:

```bash
senate "..." --json-stream
```

NDJSON events: `orchestrator_done`, `consult_start`, `engine_done`, `consult_done`, `synthesis_start`, `synthesis_done`, `execute_start`, `execute_done`, final `{type:'result', result:...}`. Errors: `{type:'error', message:'...'}`. Mutually exclusive with `--json`.

GitHub integration:

```bash
gh issue view 703 --json body --jq .body | senate "Review:"
```

## Bin overrides

```bash
SENATE_CLAUDE_BIN=/path/to/binary senate
```

Format: `SENATE_<NAME>_BIN=/path/to/binary`. Resolved at module load. Surfaced in `--list-engines` and `--check-engines`.

## Cancellation

First Ctrl-C: SIGTERM to in-flight engines, SIGKILL after 1s, kills subprocess group, prints partial results, exits 130.

Second Ctrl-C: immediate exit.

## Synthesis schema

On `WorkflowResult.synthesis.structured`:

```json
{
  "consensus": ["string"],
  "disagreements": [
    {
      "topic": "string",
      "positions": [
        {"engine": "string", "stance": "string"}
      ]
    }
  ],
  "outliers": [
    {"engine": "string", "note": "string"}
  ],
  "recommendation": "string"
}
```

Prose rendering is deterministic. Falls back to raw output if JSON parse fails.

## Health checks

```bash
senate --list-engines   # Name + resolved bin + override marker
senate --check-engines  # Ping each, report auth state
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error |
| 2 | Mutually-exclusive flag conflict |
| 130 | Cancelled by Ctrl-C |

## Tips

- Default = consult-only with synthesis. Most sessions don't need `--smart`.
- Machine pipelines: prefer `--json | jq` over `--json-stream`.
- `--repl` uses transcripts: each turn = its own session file.
- Specific advisors: `-a claude,gemini` skips vibe.
