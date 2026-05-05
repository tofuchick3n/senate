# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Parallel advisor execution via `Promise.allSettled` (`workflow.ts`)
- Synthesis step with structured CONSENSUS / DISAGREEMENTS / OUTLIERS / RECOMMENDATION prompt; lead summarizer falls back from `claude` → `vibe` → `gemini`
- `--no-synthesis` flag
- `synthesis` field on `WorkflowResult`; renderer surfaces it above raw advisor opinions

### Changed
- `--consult-only` now implies skipping execution; `--execute-only` implies skipping consultation. Setting either flag bypasses the orchestrator round-trip.
- Synthesis prompt only references advisors that actually responded.

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
