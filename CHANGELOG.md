# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Cost / usage awareness (#10). `EngineResult.usage` now carries `{ inputTokens, outputTokens, totalTokens, costUsd }` when the wrapped CLI surfaces them. Claude (`--output-format json`) provides full token counts and total USD cost. Gemini (`--output-format json`) provides token counts (sums across models if more than one ran). Vibe stays in text mode — its JSON output is heavyweight and tokens aren't surfaced in the cheap path.
- New `▸ USAGE` block in the human-mode footer: per-engine wall-clock + tokens + cost where available, plus synthesis / execute timings, plus a total row.
- Per-engine `parseUsage(stdout, stderr)` hook in the registry. Returns `EngineUsage | undefined`.
- Tests for `parseClaudeJson` and `parseGeminiJson` (response extraction, usage parsing, malformed-input handling, multi-model summing, leading-noise stripping).
- Persistent transcripts (#12). Each session is written to `~/.senate/sessions/<utc>-<seq>.jsonl` as JSONL: a `session_start` line, all `WorkflowEvent`s as they occur, and a final `session_end` line carrying the full `WorkflowResult`. Best-effort write — transcript IO failures never block the run.
- `--no-transcript` flag — opts out of session persistence.
- `--list-sessions [count]` — prints recent sessions (default 20) with timestamp, advisors, prompt preview, cancel marker.
- `--resume <ref>` — reprints a saved session. `<ref>` is either an integer index into `--list-sessions` (0 = newest) or a literal file path.
- `src/transcripts.ts` exports `TranscriptWriter`, `loadSession`, `listSessions`, `resolveSessionRef`.
- Test suite (`node:test`, zero deps): unit tests for the registry (`resolveBin`, default advisors, synthesis priority, per-engine auth patterns, regression test for the gemini→claude cross-contamination bug) and synthesis (`extractJson`, `parseStructured`, `renderSynthesis`). Wired into CI via `npm test` on Node 18 + 20.

### Changed
- Claude and Gemini now invoke their CLIs in JSON output mode (`--output-format json`). Response text is extracted from the JSON envelope; pre-existing behavior is unchanged for callers (still get a string back from `engineResult.output`), but token counts and cost are now available on `engineResult.usage`.
- Transcript-module tests (writer round-trip, sort order, prompt preview truncation, junk-file resilience, ref resolution).

## [0.2.0] - 2026-05-06

### Added
- Parallel advisor execution via `Promise.allSettled` (`workflow.ts`)
- Synthesis step with structured CONSENSUS / DISAGREEMENTS / OUTLIERS / RECOMMENDATION prompt; lead summarizer falls back from `claude` → `vibe` → `gemini`
- `--no-synthesis` flag
- `synthesis` field on `WorkflowResult`; renderer surfaces it above raw advisor opinions
- `--smart` flag — opts into the Claude orchestrator routing decision.
- stdin support — when stdin is piped (not a TTY), it is used as the prompt or appended to the positional argument as additional context.
- `--json` — prints the full WorkflowResult as a single JSON blob to stdout.
- `--json-stream` — emits NDJSON events on stdout as the workflow progresses (`orchestrator_done`, `consult_start`, `engine_done`, `consult_done`, `synthesis_start`, `synthesis_done`, `execute_start`, `execute_done`, `result`). Mutually exclusive with `--json`.
- `WorkflowEvent` union type exported from `workflow.ts`.
- `RunOptions` type with `quiet`, `onEvent`, `smart` fields.
- ASCII banner shown once at startup in human mode.
- Spinner for single-engine phases (orchestrator decide, synthesis, vibe execution); animates when stderr is a TTY, falls back to a static line otherwise.
- `cancelled` engine status. Ctrl-C cancels in-flight engines (SIGTERM, then SIGKILL after 1s grace) and prints whatever has finished. Second Ctrl-C exits immediately. Process exit code 130 when cancelled.
- `cancelled: boolean` field on `WorkflowResult`; `(cancelled — partial)` indicator in the human report.
- `signal?: AbortSignal` on `RunOptions` and `RunEngineOptions`; flows through advisor calls, the synthesis lead-summarizer call, and vibe execution.
- Structured synthesis output. `SynthesisResult.structured` exposes `{ consensus: string[], disagreements: [{topic, positions:[{engine,stance}]}], outliers: [{engine,note}], recommendation }`. Synthesizer is now prompted for JSON; the prose `output` field is rendered from the structured form. When parse fails, falls back to the raw model output.
- `src/registry.ts` — single source of truth for engine configuration. Each entry carries `bin`, `defaultBinName`, `args`, `parse`, `authPatterns`, `inSynthesisPriority`, `inDefaultAdvisors`, optional `env`. Replaces the four independent touchpoints (`ENGINE_CONFIGS`, `SYNTHESIS_PRIORITY`, default advisors string, global auth-pattern list) with one place to edit.
- `SENATE_<NAME>_BIN` env-var bin overrides — e.g. `SENATE_CLAUDE_BIN=/opt/homebrew/bin/claude`. Resolved at module load. Surfaced in `--list-engines` and `--check-engines` output.

### Changed
- `--consult-only` now implies skipping execution; `--execute-only` implies skipping consultation. Setting either flag bypasses the orchestrator round-trip.
- Synthesis prompt only references advisors that actually responded.
- **Breaking**: orchestrator routing is now opt-in via `--smart`. New default is consult-only with synthesis. Previously the orchestrator ran whenever no consult/execute flags were passed.
- Section headers redesigned: removed emoji, replaced with `▸ DECIDE`, `▸ CONSULT`, `▸ SYNTHESIZE`, `▸ EXECUTE` plus thinner rule lines in the final report.
- Progress chatter now goes to stderr; final result (human, JSON, or NDJSON) goes to stdout. Enables clean piping.
- `runEngine` signature: now takes an options object `{ inactivityMs?, stream?, signal? }` instead of positional args. All callers updated.
- Engines spawn detached (their own process group) so cancellation kills the whole subprocess tree, not just the wrapped binary.
- Auth-error detection is now per-engine (registry-driven), no longer a single global pattern list. Avoids cross-contamination — e.g. the Gemini-only `must specify the gemini_api_key` string no longer accidentally classifies a Claude error as `unauthenticated`.
- Default `--advisors` value is now derived from the registry (`getDefaultAdvisors().join(',')`) instead of a hardcoded string in `cli.ts`. Adding/removing an engine from the default list is a one-line registry edit.
- `--list-engines` output now shows resolved bin paths and flags any engines using `SENATE_*_BIN` overrides.

### Fixed
- Claude: `--permission-mode auto` (invalid value) → `bypassPermissions`
- `runEngine`'s `inactivityMs` parameter is now honored (was dead code; previously hardcoded to 30s)
- Orchestrator JSON parse handles fenced/wrapped output via `extractJson`

## [0.1.0] - 2026-05-04

### Added
- Initial project: multi-model orchestration CLI scaffold
- Engines: `claude`, `vibe`, `gemini`
- Sequential advisor consultation via `spawn`
- Orchestrator: Claude decides whether to consult or execute
- `senate --check-engines`, `--list-engines`
- Mode flags: `--consult-only`, `--execute-only`, `--no-consult`, `--no-execute`, `-a/--advisors`, `-v/--verbose`
