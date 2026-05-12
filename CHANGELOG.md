# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Real token tracking for vibe** (closes #35, part 1). Vibe's `--output text` mode prints no stats and there was no `parseUsage` on the registry entry, so vibe contributed nothing to senate's USAGE footer. The new `src/vibe-session-log.ts` helper reads `~/.vibe/logs/session/<id>/meta.json` after every run and extracts real `last_turn_prompt_tokens` / `_completion_tokens` / `_total_tokens`. The USAGE footer now shows e.g. `vibe  9100 tok (9050 in / 50 out)`. The execute (vibe) row also gained a usage column. `costUsd` is **deliberately left undefined** for vibe — Mistral Pro is flat-rate, so the `session_cost` field in the session log is a list-price equivalent at API pricing, not actual spend; reporting it would misrepresent Pro plan billing.
- **Optional `SENATE_VIBE_WRAPPER` detection** (closes #35, part 2). If `$SENATE_VIBE_WRAPPER` is set, or `~/tools/vibe-delegate` exists and is executable, senate's vibe engine spawns the wrapper with positional args `(cwd, prompt, max-turns)` instead of bare `vibe -p ...`. The wrapper (designed for richer Claude Code → vibe delegation, e.g. [pcx-wave/vibe-skill](https://github.com/pcx-wave/vibe-skill)) handles streaming supervision, shell-safe prompts, and an audit log at `~/.local/share/delegate-runs.jsonl`. In wrapper mode senate recovers the canonical assistant message from `messages.jsonl` rather than relying on stdout (which is a stream of `[read]/[tool]/[vibe]` events). When neither env var nor `~/tools/vibe-delegate` is present, senate falls back to direct vibe spawn — no behavior change for users without a wrapper.
- Two new test suites (26 tests total): `vibe-session-log.test.ts` exercises happy / missing / malformed / no-stats paths for the session-log helpers; `registry.test.ts` gains a `buildVibeEntry wrapper detection (Option A)` describe that isolates HOME + `$SENATE_VIBE_WRAPPER` to assert direct-mode vs wrapper-mode bin/args shapes.

### Changed
- **README structure.** "Use from a Claude Code agent" moved up from below "Modes" to right under "Install" — it's an install-time concern, not an advanced topic, so it belongs with the other setup steps. The Engines section now documents `SENATE_VIBE_WRAPPER` alongside the existing `SENATE_*_BIN` overrides.

## [0.4.3] - 2026-05-12

### Fixed
- **Bounded vibe engine spawn with runaway-loop guards** (#34). `vibe -p` mode defaults to the auto-approve agent and can multi-turn its way through tool calls indefinitely; senate's only stop signal was the 60s inactivity timeout, which is unreliable for buffered output. The vibe registry entry now passes `--trust` (skips the stdin trust prompt — senate spawns with `stdio: ignore` so an interactive prompt would hang), `--max-turns 25`, and `--max-price 1.00`. Numbers match the upper-end TDD-tier caps from the standalone `vibe-delegate` skill, so normal usage isn't tightened — only runaways are stopped. Regression test added.

## [0.4.2] - 2026-05-07

### Fixed
- **First-run UX with no engines authenticated** (closes part of #20). When every advisor fails (binary missing, auth failed, etc.), senate now exits with code **2** instead of 0 so pipelines and orchestrator agents see the failure. The empty-result message is now actionable: it lists the advisors that were tried and points users at `senate --check-engines` plus the README install section.
- Extracted `hasAnyResult(result)` helper in `src/workflow.ts` (used by both the formatter and the CLI exit code) and added 6 unit tests covering the helper + the empty-result message.

### Added
- **Author metadata.** `package.json` `author` field now points to Deian Isac (https://deianisac.com/), and the README has an Author section. Closes the empty-`author` half of #20.
- **`--diff [file]` flag** (closes part of #20). Eats the most common `cat <file> | senate "review this:"` recipe. With no arg it pulls `git diff` (your unstaged changes); with a path it reads that file. An optional positional query becomes the review focus, otherwise senate uses a sensible default ("bugs, regressions, edge cases, unclear naming, missing tests"). Uses `execFileSync` (no shell) so there's no command-injection surface. Errors out with exit code 2 if the file is unreadable or the diff is empty. README has a recipe and a flag-table entry.
- **Total cost rollup** in the USAGE footer (closes part of #20). When at least one engine reports `costUsd` (claude does; gemini/vibe currently don't), the total line gets a `$0.1775`-style rollup so consultations have a visible price tag. `sumCostUsd(result)` helper is exported and unit-tested (4 tests covering null / advisor-only / advisor+execution / partial-cost cases).

## [0.4.1] - 2026-05-07

### Changed
- **Renamed npm package to `senate-ai`** (was briefly `@tofuchick3n/senate@0.4.0`). The unscoped name `senate` was rejected by npm as too similar to the existing `slate` package; `senate-ai` is distinct enough to clear the similarity rule and reads cleanly as `npm install -g senate-ai`. The CLI binary is still `senate`, so invocation is unchanged. The scoped 0.4.0 release has been deprecated with a pointer to this name.

## [0.4.0] - 2026-05-07

### Added
- **`senate --install-skill` / `--uninstall-skill` / `--skill-status`** — manage the bundled Claude Code skill from the CLI. `--install-skill` copies `skills/senate/` into `~/.claude/skills/senate/` (with `--force` to overwrite); `--skill-status` sha256s both trees and reports `absent` / `matches` / `differs` so users know whether to re-run after upgrading senate. Replaces the manual `cp -r` step that broke when run from the wrong cwd. No npm postinstall hook — those are commonly disabled in CI/corporate environments.
- `src/install-skill.ts` — extracted install/uninstall/status logic with a `home` option for testability. cli.ts holds only thin wrappers.
- 9 unit tests for install / uninstall / status × happy + edge paths, using `mkdtempSync` HOMEs so they don't touch the real `~/.claude`.
- `skills/senate/SKILL.md` — Claude Code skill that teaches orchestrator agents when and how to consult senate. Covers canonical invocation (`--consult-only --no-tui --quiet --timeout 10m`), the multi-source stdin pattern, the path-resolution gotcha, and how to read `synthesis.structured.recommendation` vs `disagreements`.
- README "Critique an implementation plan against its issue" recipe — multi-source stdin pattern for the common "issue + written plan, does the plan match" case.
- README path-resolution heads-up under Recipes — call out absolute paths vs. piping stdin so users don't hit silent file-not-found inside spawned advisor CLIs.
- README "Use from a Claude Code agent" section pointing to the new skill.

### Changed
- **npm publish-ready.** `package.json` now has a `files` whitelist (`dist`, `skills`, `README.md`, `LICENSE`, `CHANGELOG.md`) so the tarball ships the skill alongside the binary. Added `repository`, `homepage`, `bugs` metadata. Install via `npm install -g senate-ai` (see 0.4.1 for the rename note).
- **Default `advisorInactivityMs` bumped 120s → 240s** for claude and gemini. Real-world brainstorm-with-file-reads prompts on Flash 3 land around 170s, so 120s was too tight — 240s gives ~40% headroom on observed long cases while still failing fast on hung Pro calls (5–7 min). vibe stays at 60s (text-streaming, timer resets per chunk).
- `hashDir` (used by `--skill-status`) streams file bytes through `crypto.createHash` incrementally instead of reading every file as a hex string into memory. Memory is now O(largest single file) instead of O(total bundle × 2).

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
