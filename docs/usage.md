# Usage

## Install & build

```bash
npm install
npm run build
npm link
```
After linking, `senate` is available on PATH. Alternatively, run directly:
```bash
node dist/cli.js
```

Each wrapped CLI (`claude`, `vibe`, `gemini`) must be installed and authenticated separately.

## Quickstart

Consult all advisors and synthesize:
```bash
senate "Explain the React hook useEffect"
```
```
[consult] claude: <response>
[consult] vibe: <response>
[synthesis] <combined answer>
```

Consult advisors only (fastest):
```bash
senate --consult-only "Review this PR description"
```
```
[consult] claude: <feedback>
[consult] vibe: <feedback>
```

Execute only via vibe:
```bash
senate --execute-only "Write a script to parse CSV files"
```
```
[execute] <code output>
```

Check available engines:
```bash
senate --check-engines
```
```
claude: ✅ (authenticated)
vibe: ✅ (authenticated)
gemini: ❌ (binary not found)
```

## Modes

By default, the orchestrator (Claude) decides whether to run consult and execute phases.

- **Default**: Orchestrator-driven. Advisors run in parallel; synthesis runs when ≥2 succeed.
- **`--consult-only`**: Only consult advisors. Implies `execute=false`. Skips orchestrator round-trip.
- **`--execute-only`**: Only execute via vibe. Implies `consult=false`. Skips orchestrator round-trip.
- **`--no-consult` / `--no-execute`**: Skip the respective phase without affecting the other.
- **`--no-synthesis`**: Skip the synthesis step (returns raw advisor outputs).

## Choosing advisors

Select advisors with `-a, --advisors <list>` (comma-separated). Default: `claude,vibe`.

```bash
senate -a claude,gemini "Analyze this architecture"
```

Advisor strengths:
- **claude**: Deep reasoning, code review, architecture
- **gemini**: Broad knowledge, multi-domain context
- **vibe**: Local execution, file operations, CLI tasks

## Health checks

| Flag | Action |
|------|--------|
| `--list-engines` | List configured engines |
| `--check-engines` | Ping each engine to verify authentication |

Common failure modes:
- **Missing binary**: CLI not installed (`command not found`)
- **Unauthenticated**: CLI installed but not logged in (auth error)
- **Timeout**: Engine unresponsive after ping

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (missing engine, auth failure, execution error) |

## Tips

- Add repo/issue context directly in the query for better results
- Pipe long context inline: `cat file.txt | xargs -0 senate --consult-only`
- Use `--consult-only` for fastest feedback (no execution overhead)
- Use `--verbose` to confirm active mode and selected advisors at startup
