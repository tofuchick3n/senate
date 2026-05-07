# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `skills/senate/SKILL.md` — Claude Code skill that teaches orchestrator agents when and how to consult senate. Covers canonical invocation (`--consult-only --no-tui --quiet --timeout 10m`), the multi-source stdin pattern, the path-resolution gotcha, and how to read `synthesis.structured.recommendation` vs `disagreements`. Install with `cp -r skills/senate ~/.claude/skills/`.
- README "Critique an implementation plan against its issue" recipe — multi-source stdin pattern for the common "issue + written plan, does the plan match" case.
- README path-resolution heads-up under Recipes — call out absolute paths vs. piping stdin so users don't hit silent file-not-found inside spawned advisor CLIs.
- README "Use from a Claude Code agent" section pointing to the new skill.

### Changed
- **Default `advisorInactivityMs` bumped 120s → 240s** for claude and gemini. Real-world brainstorm-with-file-reads prompts on Flash 3 land around 170s, so 120s was too tight — 240s gives ~40% headroom on observed long cases while still failing fast on hung Pro calls (5–7 min). vibe stays at 60s (text-streaming, timer resets per chunk).

## [0.3.0] - 2026-05-07

### Changed
- **Gemini pinned to `gemini-3-flash-preview` by default** (was: gemini CLI's auto-router, which silently routed "complex" prompts to 3.1 Pro and ran 5–7 min per call, frequently hitting timeouts and burning quota on aborted generations). Flash 3 delivers Pro-tier reasoning at Flash latency — the right tradeoff for a *secondary* advisor where claude is the synthesis lead. Override with `SENATE_GEMINI_MODEL=<model-id>` (e.g. `gemini-3.1-pro-preview`) for users who want the deeper reasoning and don't mind the wall-clock cost.
- **`gemini` advisor timeout dropped from 600s → 120s** (matches claude). Flash should respond well within this; users who opt back into Pro via `SENATE_GEMINI_MODEL` should pair it with `--timeout 10m`.

### Fixed
- **Claude/gemini timing out at exactly 30s.** When PR #8 switched claude and gemini to `--output-format json` for token/cost extraction, their stdout became a single buffered blob — no incremental output to reset the inactivity timer. The hardcoded 30s default fired before the model finished. Per-engine `advisorInactivityMs` is now in the registry: claude=120s, gemini=120s (both buffer; need full-response budget), vibe=60s (text streams). Vibe was unaffected because it streams text.
- Timeout error messages now distinguish inactivity vs. hard-cap and include the actual seconds + a hint to `--timeout`. Previously they all said `Timeout` without context.

### Added (this round)
- `--timeout <seconds>` flag — global override for per-advisor inactivity timeout.
- `EngineEntry.advisorInactivityMs` — per-engine default. Configurable in `src/registry.ts`.
- `RunOptions.advisorInactivityMs` — workflow-level override (used by the CLI flag).
- `src/version.ts` — both `cli.ts`'s `.version()` and the banner now read from `package.json` at runtime. Bumping the version is one edit.

### Changed (this round)
- **Default advisors are now `claude,gemini`** (was `claude,vibe`). Vibe is the execution grunt for `--execute-only`, not an advisor — its review/decision responses tend to be less useful than claude/gemini. Add it explicitly with `-a claude,vibe,gemini` if you want a third opinion.
- Synthesis priority is now `claude → gemini → vibe` (was `claude → vibe → gemini`). Vibe is last-resort fallback only.

### Added
- Conversation REPL (#4). After the first result, `--repl` drops into a `senate>` prompt. Each follow-up turn is enriched with prior conversation context (using the synthesis recommendation when available, falling back to synthesis prose, then raw advisor outputs). REPL commands: `/exit`, `/quit`, `/clear` (drop context), `/history` (list prior turns). Each turn gets its own TUI panel and transcript file. Skipped automatically in machine modes, when stdin is piped, or after a cancelled run.
- Live TUI dashboard (#3) via `log-update` (one new runtime dep, no React/JSX). Per-advisor row with animated spinner, ticking elapsed time, and status glyph. Synthesis + execute rows appear when those phases start. Auto-activates in human + TTY mode; auto-disables when stdout/stderr are piped, with `--json`/`--json-stream`, or with explicit `--no-tui`. Renders to stderr so the final result on stdout stays clean for piping.
- `--no-tui` flag.
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
