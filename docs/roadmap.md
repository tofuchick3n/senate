# Roadmap

## Status

| # | Title | Status | Priority |
|---|-------|--------|----------|
| 1 | Parallel advisor execution | Done | - |
| 2 | Synthesis step with lead fallback | Done | - |
| 3 | Streaming TUI dashboard | TODO | high |
| 4 | Conversation mode / follow-ups | TODO | medium |
| 5 | Structured output | Done | - |
| 6 | stdin support | Done | - |
| 7 | Make orchestrator opt-in | Done | - |
| 8 | First-class disagreement detection | Done | - |
| 9 | Engine config surface | Done | - |
| 10 | Cost / usage awareness | TODO | low |
| 11 | Cancel + partial results | Done | - |
| 12 | Persistent transcripts | TODO | low |

## Done

1. **Parallel advisor execution** — `Promise.allSettled` for concurrent engine runs (#1).
2. **Synthesis step** — Lead summarizer with fallback claude → vibe → gemini, structured CONSENSUS/DISAGREEMENTS/OUTLIERS/RECOMMENDATION output (#1, #3).
5. **Structured output** — `--json` (final WorkflowResult blob) and `--json-stream` (NDJSON events: `orchestrator_done`, `consult_start`, `engine_done`, `consult_done`, `synthesis_start`, `synthesis_done`, `execute_start`, `execute_done`, `result`). Mutually exclusive (#2).
6. **stdin support** — When stdin is piped, contents become the prompt or are appended to the positional argument as additional context (#2).
7. **Orchestrator opt-in** — Default is parallel-consult + synthesize, no Claude round-trip. `--smart` opts into the orchestrator routing decision (#2).
8. **First-class disagreement detection** — `SynthesisResult.structured` exposes `{ consensus, disagreements: [{topic, positions:[{engine,stance}]}], outliers, recommendation }`. Synthesizer is prompted for JSON; prose is rendered deterministically. Falls back to raw output on parse failure (#3).
9. **Engine config surface** — `src/registry.ts` is the single source of truth: bin/args/parse, per-engine auth patterns, synthesis priority, default-advisors membership, health-check timeout. `SENATE_<NAME>_BIN` env vars override bin paths. Per-engine flags via `~/.senate/config.json` was scoped out — defer until a real need surfaces (#4).
11. **Cancel + partial results** — Ctrl-C cancels in-flight engines (SIGTERM, then SIGKILL after 1s grace), kills the whole subprocess group, prints whatever finished, exits 130. Second Ctrl-C exits immediately (#3).

## Next up

3. **Streaming TUI dashboard** — Per-advisor panels with spinner, elapsed time, and last output line, expandable via number keys. Biggest UX upgrade still on the table.

## Backlog

4. **Conversation mode / follow-ups** — REPL after results that carries the transcript into subsequent turns. Most natural after #3 lands so the panels can host follow-up input.

10. **Cost / usage awareness** — Display per-engine wall-clock time and token counts in the footer. Token counts require parsing each CLI's stderr / stdout for usage hints (or a future structured output mode).

12. **Persistent transcripts** — Store sessions at `~/.senate/sessions/<timestamp>.jsonl` and enable `--resume` to continue from a saved state. `.senate/` is already gitignored in anticipation.

## Inspiration

Inspired by [council.armstr.ng](https://council.armstr.ng/) — senate is a local CLI tool that uses your existing LLM subscriptions without ranking or leaderboards.
