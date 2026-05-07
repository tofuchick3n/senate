---
name: senate
description: Get a structured second opinion from senate (multi-model CLI consultant) on judgment calls — architecture decisions, plan critiques, security reviews, "should I X or Y" questions. Use when the agent is about to commit to an approach on a non-trivial decision and a sanity check from other models would reduce risk. Also use when explicitly asked to "consult senate", "get a second opinion", "what would senate say", or "ask the bench". Invokes the local `senate` CLI which runs claude + gemini in parallel and synthesizes a CONSENSUS / DISAGREEMENTS / OUTLIERS / RECOMMENDATION report.
---

# Senate

`senate` is a local CLI that asks 2–3 model CLIs the same question in parallel and writes a structured opinion. Use it when you're about to make a real judgment call and want a sanity check from other models.

## When to use it

Call senate **before** committing to an approach on:

- Architecture decisions ("worker vs. inline", "queue vs. cron", "REST vs. GraphQL")
- Plan critiques ("does this design have holes?", "review this implementation plan")
- Trade-off questions ("one PR or three?", "freemium vs. trial?")
- Security/safety reviews ("is this auth model safe?", "any obvious footguns?")
- Test strategy ("are these tests covering the right thing?")

## When NOT to use it

- Questions you can answer from the codebase or your own context (waste of tokens + wall-clock)
- Pure code generation (senate doesn't write code; it consults)
- Time-sensitive single-step actions (each call is 30s–3min)
- Anything where the answer is "just look at the file"

## Canonical invocation

For a review/critique with one or more files for context, **pipe everything via stdin** (most reliable, avoids any path-resolution issues across advisors):

```bash
{ gh issue view 452 --repo OWNER/REPO --json title,body \
    --jq '"# ISSUE\n\n# \(.title)\n\n\(.body)"'
  echo
  echo "# IMPLEMENTATION PLAN"
  echo
  cat plans/the-plan.md
} | senate --consult-only --no-tui --quiet --timeout 10m \
    "Critique the plan against the issue. Cover: tradeoffs, retry/dedup, observability, failure modes."
```

Flag breakdown:

| Flag | Why |
|---|---|
| `--consult-only` | Skip the orchestrator and execution paths — pure advisor consultation |
| `--no-tui` | Disable the live dashboard (it renders to stderr but is noise in agent contexts) |
| `--quiet` | Suppress banner/settle lines; stdout becomes the synthesis only |
| `--timeout 10m` | 10-min ceiling per advisor. The default is enough for short reviews; bump it for long brainstorms or when opting into Pro |

Without those flags, stdout will include progress chatter that's painful to parse downstream.

## Reading the output

In `--quiet` mode, stdout is the synthesis text:

```
─────────────  CONSENSUS  ─────────────
- bullet 1
- bullet 2
─────  DISAGREEMENTS  ─────
- claude: ... / gemini: ...
─────  RECOMMENDATION  ─────
<one-paragraph or bullet list>
```

For machine-readable output, use `--json` and pull the structured object:

```bash
... | senate --consult-only --json --timeout 10m "..." \
  | jq -r '.synthesis.structured.recommendation'
```

`synthesis.structured` is `{ consensus: string[], disagreements: [...], outliers: [...], recommendation: string }`. **The `recommendation` field is the primary signal.** `disagreements` is the secondary signal — if the advisors split on something material, surface that to the user instead of silently picking a side.

## Path resolution gotcha

Each advisor (claude, gemini) spawns as a child process with its own cwd resolution. **If you reference file paths in the prompt itself, use absolute paths** (`/tmp/foo.md`, not `plans/foo.md`). Better: pipe the file contents via stdin and skip paths entirely (see canonical invocation above).

```bash
# RISKY — relative path may not resolve in the advisor's workspace
senate "Review the plan at plans/foo.md"

# OK — absolute path
senate "Review the plan at /Users/me/repo/plans/foo.md"

# BEST — content is in stdin, no path resolution involved
cat plans/foo.md | senate --consult-only --no-tui --quiet "Review this plan"
```

## Picking advisors

Defaults to claude + gemini (gemini pinned to `gemini-3-flash-preview` for speed). To override:

| Need | How |
|---|---|
| Add vibe as a third opinion | `-a claude,gemini,vibe` |
| Just claude (fast, single-model sanity check) | `-a claude` |
| Deeper reasoning from gemini (slower) | `SENATE_GEMINI_MODEL=gemini-3.1-pro-preview senate ... --timeout 10m` |

Don't add vibe by default — it's an execution grunt, not an advisor; its review-style outputs are weaker than claude/gemini.

## Common patterns

**Quick architecture sanity check:**
```bash
senate --consult-only --no-tui --quiet \
  "Should an internal-only API use REST or GraphQL? We have ~10 endpoints, 3 internal consumers, no public API plans."
```

**Critique a PR diff:**
```bash
gh pr diff 42 | senate --consult-only --no-tui --quiet \
  "Review for bugs, naming issues, and edge cases."
```

**Review an issue + linked source:**
```bash
{ gh issue view 703 --json title,body --jq '"# \(.title)\n\n\(.body)"'
  echo "---"
  cat src/the/file.ts
} | senate --consult-only --no-tui --quiet \
  "Does the proposed change in this issue actually fit the existing code?"
```

**Just want one structured field:**
```bash
... | senate --consult-only --json --timeout 10m "..." \
  | jq -r '.synthesis.structured.recommendation'
```

## Failure modes

- **`Timeout`** with a hint to `--timeout` — bump it. Default is sized for short reviews; brainstorms or file-reading prompts may need 5–10 min. If it times out repeatedly even with `--timeout 10m`, you're probably hitting the gemini Pro path; try Flash 3 (the default) or check `SENATE_GEMINI_MODEL`.
- **`auth required`** — a wrapped CLI (claude/gemini/vibe) isn't authenticated. The user needs to run that CLI's login flow once; senate doesn't manage auth itself.
- **`synthesis: null`** — all synthesis-lead candidates failed (claude → gemini → vibe). The raw advisor outputs are still in `advisorResults[]`. Fall back to reading those directly.
- **Empty / truncated output** — likely the prompt was too long for the model's context window. Trim or split.

## Don'ts

- Don't pipe gigabytes of context — token waste and likely truncation. Trim to the relevant slice.
- Don't use senate when you've already decided. It's a *check before committing*, not a rubber stamp after.
- Don't ignore `disagreements` if they're material to the user's decision.
- Don't use relative paths in the prompt; pipe stdin or use absolute paths.
- Don't skip `--no-tui --quiet` in agent contexts — the dashboard noise pollutes downstream parsing.
