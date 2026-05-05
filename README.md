# Senate

> **Multi-model orchestration CLI** - Uses Claude Opus as the orchestrator, Vibe (Mistral) for execution, with optional advisor consultation from available CLIs.

## 🎯 Project Scope

**Senate** is a CLI tool that intelligently coordinates multiple AI models to solve development tasks:

- **Claude Opus** acts as the **orchestrator** - analyzes tasks and decides the workflow
- **Vibe (Mistral Pro)** handles **execution** - code generation, fixes, implementation
- **Optional advisors** (Claude, Vibe, Gemini, Codex) provide **second opinions** when needed

**Key Design Principle:** Use existing CLI subscriptions (no direct API costs). All integrations wrap authenticated CLIs.

## ⚡ Features

- **Smart Orchestration:** Opus decides whether to consult advisors, execute, or both
- **CLI-only:** Uses `claude`, `vibe`, `gemini`, `codex` CLIs - no API keys needed
- **Parallel Consultation:** Advisors run in parallel for fast feedback
- **Flexible Modes:** Consult-only, execute-only, or full workflow
- **Graceful Degradation:** Skips unavailable/unauthenticated engines

## 📦 Installation

```bash
# Clone or navigate to the project
git clone <repo-url> senate
cd senate

# Install dependencies
npm install

# Build
npm run build

# Link globally
npm link

# Or use npx (after publishing)
npx senate "your task here"
```

## 🔑 Authenticate CLIs

Senate wraps existing CLIs - authenticate each one first:

| CLI | Install | Authenticate |
|-----|---------|--------------|
| **Claude** | `npm install -g @anthropics/claude-cli` | `claude auth login` |
| **Vibe** | `npm install -g @mistralai/vibe-cli` | `vibe --setup` |
| **Gemini** | `npm install -g @google/gemini-cli` | Set `GEMINI_API_KEY` env var |

Verify all engines are authenticated:
```bash
senate --check-engines
```

### Troubleshooting

If engines show as unavailable, `senate --check-engines` will display the specific error for each.

**Common issues:**
- **Claude**: Usage limit reached → wait for monthly reset or upgrade plan
- **Vibe**: API key not set → run `vibe --setup` again
- **Gemini**: Missing `GEMINI_API_KEY` → set the environment variable
- **Gemini**: Account not eligible for Code Assist → check your Google Cloud subscription
- **Gemini**: 503 error → Google servers under high demand, try again later

## 🚀 Usage

### Basic Usage

```bash
# Full workflow (orchestrate + consult + execute)
senate "Implement a TypeScript CSV parser"

# Consult advisors only (no execution)
senate --consult-only "Review this architecture decision"

# Execute only (no consultation)
senate --execute-only "Fix the TypeScript error in this file"

# Skip consultation
senate --no-consult "Simple question here"

# Skip execution
senate --no-execute "I just want opinions on this approach"

# Custom advisors
senate -a claude,vibe "Get opinions from Claude and Vibe"
```

### Engine Management

```bash
# List available engines
senate --list-engines

# Check which engines are authenticated
senate --check-engines
```

### Development

```bash
# Run in development mode (auto-reload)
npm run dev -- "your task"

# Build for production
npm run build

# Run directly without build
npm run start -- "your task"
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        SENATE CLI                               │
├─────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │   Claude     │    │    Vibe       │    │   Advisors   │   │
│  │   (Opus)     │    │   (Mistral)   │    │  (Optional)   │   │
│  │ Orchestrator │    │  Executor     │    │ Consultation │   │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘   │
│         │                   │                   │            │
│         │ Decision          │                   │ Opinions   │
│         ▼                   ▼                   ▼            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    Workflow Engine                       │  │
│  │  1. Analyze task with Opus                            │  │
│  │  2. Consult advisors (parallel) if needed              │  │
│  │  3. Execute with Vibe if needed                       │  │
│  │  4. Synthesize and display results                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
senate/
├── src/
│   ├── cli.ts              # Commander CLI interface
│   ├── engines.ts          # CLI engine wrappers (claude, vibe, gemini, codex)
│   ├── orchestrator.ts     # Opus decision logic
│   └── workflow.ts         # Main workflow execution
├── dist/                   # Compiled output (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## 🔧 Engine Configuration

Engines are configured in `src/engines.ts`. Each engine has:

- **Binary name:** The CLI command to spawn
- **Arguments:** CLI-specific flags for safe, read-only operation
- **Output parser:** Extracts clean text from CLI output
- **Auth check:** Detects if authentication is missing

Currently supported:
- `claude` - Claude CLI (Opus via Max plan)
- `vibe` - Mistral Vibe CLI (Pro subscription)
- `gemini` - Google Gemini CLI
- `codex` - OpenAI Codex CLI

## 🎛️ Workflow Logic

1. **Orchestration Phase:**
   - Opus (via `claude` CLI) analyzes the task
   - Decides: consult advisors? execute? both?
   - Returns a decision with reasoning

2. **Consultation Phase (parallel):**
   - Selected advisors process the task simultaneously
   - Results are collected and filtered by success

3. **Execution Phase:**
   - Vibe CLI handles code generation and implementation
   - Runs only if orchestrator approves

4. **Result Formatting:**
   - Execution results displayed first
   - Advisor opinions grouped separately
   - Clear visual separation with emojis

## 🛡️ Safety & Cost Control

- **CLI-only:** No direct API calls = no unexpected costs
- **Read-only defaults:** Engines configured for safe operation
- **Subscription-based:** Uses your existing authenticated CLIs
- **Graceful failure:** Skips unavailable engines without crashing

## 📝 Decision Logic

The orchestrator (Opus) uses these heuristics:

| Task Type | Consult Advisors | Execute with Vibe |
|-----------|-----------------|------------------|
| "Implement X" | Maybe | ✅ Yes |
| "Fix Y" | Maybe | ✅ Yes |
| "Review Z" | ✅ Yes | ❌ No |
| "Compare A and B" | ✅ Yes | ❌ No |
| "Explain C" | ✅ Yes | ❌ No |
| "Simple question" | ❌ No | ❌ No |

## 🔄 Future Enhancements

- [ ] Synthesis of advisor opinions into unified response
- [ ] Conversation mode for multi-turn tasks
- [ ] Project context awareness (read files from cwd)
- [ ] Custom prompts per engine
- [ ] Timeout configuration per engine
- [ ] JSON output mode for automation
- [ ] Streaming output for long-running tasks
- [ ] History/logging of past sessions

## 🤝 Related Projects

- [council](https://github.com/seeARMS/council) - Inspiration for multi-model CLI wrapping
- [vibe](https://github.com/mistralai/vibe) - Mistral's CLI agent
- [claude](https://github.com/anthropics/claude-cli) - Anthropic's CLI agent

## 📄 License

MIT
