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

By default, senate consults all selected advisors in parallel and synthesizes their responses (no orchestrator round-trip). Use `--smart` to let Claude decide whether to run consult and/or execute phases.

- **Default**: All advisors run in parallel; synthesis runs when ≥2 succeed.
- **`--smart`**: Orchestrator-driven. Claude decides routing between consult and execute phases.
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

## Pipeline use

Stdin is supported in addition to positional arguments. When both are provided, they are concatenated as `<positional>\n\n<stdin>`.

```bash
echo "prompt" | senate
senate < spec.md
senate "context:" < details.md
```

Use `--json` to output the final `WorkflowResult` as a single JSON blob on stdout:

```bash
senate "..." --json | jq .synthesis.output
```

Use `--json-stream` for NDJSON events on stdout as they occur. Event types include: `orchestrator_done`, `consult_start`, `engine_done`, `consult_done`, `synthesis_start`, `synthesis_done`, `execute_start`, `execute_done`, plus a final `{type:'result', result:...}`. In machine modes (`--json` or `--json-stream`), progress chatter is silenced (no banner, no spinner, no section headers). Errors are emitted to stdout as `{type:'error', message:'...'}` for easy parsing.

> **Note**: `--json` and `--json-stream` are mutually exclusive. Using both exits with code 2.
