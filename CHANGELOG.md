# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Changed
- `--consult-only` now implies skipping execution; `--execute-only` implies skipping consultation. Setting either flag bypasses the orchestrator round-trip.
- Synthesis prompt only references advisors that actually responded.
- **Breaking**: orchestrator routing is now opt-in via `--smart`. New default is consult-only with synthesis. Previously the orchestrator ran whenever no consult/execute flags were passed.
- Section headers redesigned: removed emoji, replaced with `▸ DECIDE`, `▸ CONSULT`, `▸ SYNTHESIZE`, `▸ EXECUTE` plus thinner rule lines in the final report.
- Progress chatter now goes to stderr; final result (human, JSON, or NDJSON) goes to stdout. Enables clean piping.

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
