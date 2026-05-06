# Roadmap

## Status

| # | Title | Status | Priority |
|---|-------|--------|----------|
| 1 | Parallel advisor execution | Done | - |
| 2 | Synthesis step with lead fallback | Done | - |
| 3 | Streaming TUI dashboard | Done | - |
| 4 | Conversation mode / follow-ups | Done | - |
| 5 | Structured output | Done | - |
| 6 | stdin support | Done | - |
| 7 | Make orchestrator opt-in | Done | - |
| 8 | First-class disagreement detection | Done | - |
| 9 | Engine config surface | Done | - |
| 10 | Cost / usage awareness | Done | - |
| 11 | Cancel + partial results | Done | - |
| 12 | Persistent transcripts | Done | - |

All twelve original roadmap items have shipped. See [CHANGELOG.md](../CHANGELOG.md) for details.

## Done

1. **Parallel advisor execution** — `Promise.allSettled` for concurrent engine runs (#1).
2. **Synthesis step** — Lead summarizer with fallback claude → gemini → vibe (#1, #3).
3. **Streaming TUI dashboard** — Live per-advisor panel with spinner, ticking elapsed, status glyph; auto-disables in machine modes / non-TTY (#9).
4. **Conversation REPL** — `--repl` drops into a follow-up loop with prior turns kept as context; `/exit`, `/clear`, `/history` commands; per-turn AbortController (#10).
5. **Structured output** — `--json`, `--json-stream` (NDJSON events) (#2).
6. **stdin support** — Pipe a prompt or concatenate with the positional argument (#2).
7. **Orchestrator opt-in** — Default is consult-all + synthesize; `--smart` opts in to Claude-driven routing (#2).
8. **First-class disagreement detection** — `synthesis.structured` exposes consensus / disagreements / outliers / recommendation as JSON (#3).
9. **Engine registry** — `src/registry.ts` is single source of truth; `SENATE_<NAME>_BIN` env overrides (#4).
10. **Cost / usage awareness** — Per-engine wall-clock + tokens + cost in the footer; `--output-format json` for claude/gemini (#8).
11. **Cancel + partial results** — Ctrl-C cancels in-flight, kills the whole subprocess group, prints partial results, exits 130 (#3).
12. **Persistent transcripts** — `~/.senate/sessions/<utc>-<seq>.jsonl`; `--list-sessions`, `--resume`, `--no-transcript` (#7).

## Future ideas (not on the original list)

- **Color in the TUI** — currently plain text for terminal compatibility. Ink-style themed output would polish the experience.
- **Keypress expand-to-full-output in TUI** — deferred from #3; raw-mode stdin conflicts with stdin-as-prompt feature, needs careful state management.
- **Per-engine flags in `~/.senate/config.json`** — deferred from #9; registry covers the consolidation goal, deeper config can wait until there's a real need.
- **Tests for vibe usage parsing** — vibe is on text mode (no token counts); would need to test JSON-mode parsing if/when we adopt it.
- **Resume-as-conversation** — `--resume` currently reprints; could re-enter REPL with the saved transcript as initial context.

## Design notes

Senate is a local CLI that uses your existing LLM subscriptions. No API keys, no ranking, no leaderboard — just parallel consultation across the CLIs you already have authenticated, with a structured synthesis on top.
