# Roadmap

## Status

| # | Title | Status | Priority |
|---|-------|--------|----------|
| 1 | Parallel advisor execution | Done | - |
| 2 | Synthesis step with lead fallback | Done | - |
| 3 | Streaming TUI dashboard | TODO | high |
| 4 | Conversation mode / follow-ups | TODO | medium |
| 5 | Structured output | TODO | medium |
| 6 | stdin support | TODO | medium |
| 7 | Make orchestrator opt-in | TODO | medium |
| 8 | First-class disagreement detection | TODO | medium |
| 9 | Engine config surface | TODO | low |
| 10 | Cost / usage awareness | TODO | low |
| 11 | Cancel + partial results | TODO | low |
| 12 | Persistent transcripts | TODO | low |

## Done

1. Parallel advisor execution using `Promise.allSettled` for concurrent engine runs.
2. Synthesis step falls back through lead engines (claude → vibe → gemini) producing structured CONSENSUS/DISAGREEMENTS/OUTLIERS/RECOMMENDATION output.

## Next up

3. Streaming TUI dashboard with per-advisor panels showing spinner, elapsed time, and last output line, expandable via number keys.

## Backlog

4. **Conversation mode / follow-ups** — Add a REPL after results that carries the transcript into subsequent turns for multi-step interactions.

5. **Structured output** — Support `--json` for a final output blob and `--json-stream` for NDJSON events (engine_start, engine_chunk, engine_done, synthesis_start, synthesis_done).

6. **stdin support** — Read the prompt from stdin when not a TTY, enabling pipeline integration.

7. **Make orchestrator opt-in** — Default to consult-all + synthesize without the Claude round-trip; require `--smart` for full orchestration.

8. **First-class disagreement detection** — Synthesizer returns structured JSON with consensus, disagreements (topic + positions per engine), and outliers.

9. **Engine config surface** — Support env overrides (SENATE_*_BIN) and per-engine flags via `~/.senate/config.json`. Also the structural fix for engine-list duplication: today `ENGINE_CONFIGS`, the cli default advisors string, the auth-error pattern list, and `SYNTHESIS_PRIORITY` are independent touchpoints. A single config-driven engine registry collapses them.

10. **Cost / usage awareness** — Display per-engine wall-clock time and token counts in the footer.

11. **Cancel + partial results** — Handle SIGINT to cancel in-flight requests and print whatever results finished.

12. **Persistent transcripts** — Store sessions at `~/.senate/sessions/<timestamp>.jsonl` and enable `--resume` to continue from a saved state.

## Inspiration

Inspired by [council.armstr.ng](https://council.armstr.ng/) — senate is a local CLI tool that uses your existing LLM subscriptions without ranking or leaderboards.
