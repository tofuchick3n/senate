/**
 * Single source of truth for engine configuration.
 *
 * Adds a new engine? Append one entry below. The registry feeds:
 *   - bin / args / parse used by spawn (engines.ts)
 *   - per-engine auth-error patterns (engines.ts)
 *   - which engines are eligible to lead synthesis, in what order (synthesis.ts)
 *   - which engines are in the default --advisors list (cli.ts)
 *
 * Bin paths are resolved at module load from `SENATE_<NAME>_BIN` env vars,
 * falling back to the default binary name on PATH.
 */

export type EngineUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
};

export type EngineEntry = {
  name: string;
  /** Resolved binary path (env override or default name on PATH). */
  bin: string;
  /** Default binary name; used when no env override is set. Also surfaced in --list-engines so users can see what we're looking for. */
  defaultBinName: string;
  /** True when the user supplied SENATE_<NAME>_BIN. Surfaced in --list-engines / --check-engines. */
  binOverridden: boolean;
  args: (prompt: string) => string[];
  parse: (stdout: string) => string;
  /** Optional usage extractor — parses tokens / cost from raw stdout (and stderr) when the engine surfaces them. Return undefined if the data isn't there. */
  parseUsage?: (stdout: string, stderr: string) => EngineUsage | undefined;
  /** Substrings (lower-cased, matched on combined stdout+stderr) that mean "auth required". Per-engine to avoid cross-contamination. */
  authPatterns: string[];
  /** True if this engine is eligible to lead the synthesis step. Order in REGISTRY = synthesis priority. */
  inSynthesisPriority: boolean;
  /** True if this engine is in the default `--advisors` list. */
  inDefaultAdvisors: boolean;
  /** Inactivity timeout used by `senate --check-engines` for this engine. Defaults vary because gemini's CLI is slow to cold-start (skill loading). */
  healthCheckTimeoutMs: number;
  /**
   * Inactivity timeout used during advisor calls (and synthesis when this engine leads).
   *
   * For text-streaming engines (vibe), the timer resets on every output chunk, so a relatively
   * short value is fine. For JSON-output engines (claude, gemini) the entire response is
   * buffered until the model is done — no chunks arrive mid-flight, so the inactivity timer
   * effectively becomes a wall-clock timeout. Set to 240s for those so non-trivial reasoning
   * prompts don't get killed at the time-to-first-output boundary.
   */
  advisorInactivityMs: number;
  /** Optional extra env vars merged into the spawned process env. */
  env?: Record<string, string>;
};

/**
 * Resolves the binary path for an engine: env override (SENATE_<NAME>_BIN) or default name.
 * Returns [resolvedBin, isOverridden]. Exported for tests.
 */
export function resolveBin(name: string, defaultBinName: string): [string, boolean] {
  const envKey = `SENATE_${name.toUpperCase()}_BIN`;
  const override = process.env[envKey];
  if (override && override.trim()) return [override.trim(), true];
  return [defaultBinName, false];
}

function entry(spec: Omit<EngineEntry, 'bin' | 'binOverridden'>): EngineEntry {
  const [bin, binOverridden] = resolveBin(spec.name, spec.defaultBinName);
  return { ...spec, bin, binOverridden };
}

/**
 * Best-effort JSON extractor for engine output that may include leading chatter
 * (gemini prints "Skill conflict detected" / "Ripgrep is not available" warnings
 * before its JSON). Pulls the first balanced object spanning '{' to last '}'.
 */
function extractFirstJson(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

/**
 * Parser for claude `-p ... --output-format json`. Output is a single-line JSON
 * with shape: { result, usage: { input_tokens, output_tokens }, total_cost_usd }.
 * Exported for tests.
 */
export function parseClaudeJson(stdout: string): { text: string; usage?: EngineUsage } {
  const json = extractFirstJson(stdout);
  if (!json) return { text: stdout.trim() };
  try {
    const obj = JSON.parse(json);
    const text = typeof obj.result === 'string' ? obj.result : stdout.trim();
    const u = obj.usage;
    if (!u) return { text };
    const inputTokens = typeof u.input_tokens === 'number' ? u.input_tokens : undefined;
    const outputTokens = typeof u.output_tokens === 'number' ? u.output_tokens : undefined;
    const totalTokens = inputTokens != null && outputTokens != null ? inputTokens + outputTokens : undefined;
    const costUsd = typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : undefined;
    return { text, usage: { inputTokens, outputTokens, totalTokens, costUsd } };
  } catch {
    return { text: stdout.trim() };
  }
}

/**
 * Parser for gemini `-p ... --output-format json`. stdout has noise then JSON.
 * Shape: { response, stats: { models: { <model>: { tokens: { input, candidates, total } } } } }.
 * Exported for tests.
 */
export function parseGeminiJson(stdout: string): { text: string; usage?: EngineUsage } {
  const json = extractFirstJson(stdout);
  if (!json) return { text: stdout.trim() };
  try {
    const obj = JSON.parse(json);
    const text = typeof obj.response === 'string' ? obj.response : stdout.trim();
    const models = obj.stats?.models;
    if (!models || typeof models !== 'object') return { text };
    // Sum across all models that ran (usually just one).
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let any = false;
    for (const m of Object.values(models) as any[]) {
      const t = m?.tokens;
      if (!t) continue;
      any = true;
      if (typeof t.input === 'number') inputTokens += t.input;
      if (typeof t.candidates === 'number') outputTokens += t.candidates;
      if (typeof t.total === 'number') totalTokens += t.total;
    }
    if (!any) return { text };
    return { text, usage: { inputTokens, outputTokens, totalTokens } };
  } catch {
    return { text: stdout.trim() };
  }
}

/**
 * Engine registry. Order matters: it determines synthesis lead priority.
 * Claude is first because it produces the most reliable structured output.
 * Vibe is the execution grunt — last in synthesis priority, NOT in default advisors.
 */
const REGISTRY: EngineEntry[] = [
  entry({
    name: 'claude',
    defaultBinName: 'claude',
    args: (p) => ['-p', p, '--permission-mode', 'bypassPermissions', '--output-format', 'json'],
    parse: (stdout) => parseClaudeJson(stdout).text,
    parseUsage: (stdout) => parseClaudeJson(stdout).usage,
    authPatterns: [
      'not logged in',
      'please run /login',
      'please run claude auth',
      'authentication failed',
      'authentication required',
      'not authenticated'
    ],
    inSynthesisPriority: true,
    inDefaultAdvisors: true,
    healthCheckTimeoutMs: 15000,
    advisorInactivityMs: 240000  // JSON output buffers; needs full-response budget
  }),
  entry({
    name: 'gemini',
    defaultBinName: 'gemini',
    // Pin to gemini-3-flash-preview by default — Pro-tier reasoning at Flash latency. Without `-m`
    // the CLI's auto-router silently routes "complex" prompts to 3.1 Pro (5–7 min wall-clock),
    // which is the wrong tradeoff for a *secondary* advisor where claude is already the synthesis
    // lead. Power users can override via SENATE_GEMINI_MODEL=gemini-3.1-pro-preview (or any other
    // model ID) to opt back into Pro.
    args: (p) => {
      const model = process.env.SENATE_GEMINI_MODEL?.trim() || 'gemini-3-flash-preview';
      return ['-p', p, '-m', model, '--skip-trust', '--output-format', 'json'];
    },
    parse: (stdout) => parseGeminiJson(stdout).text,
    parseUsage: (stdout) => parseGeminiJson(stdout).usage,
    authPatterns: [
      'must specify the gemini_api_key',
      'api key not set',
      'api key required',
      'authentication failed',
      'authentication required',
      'not authenticated'
    ],
    inSynthesisPriority: true,
    inDefaultAdvisors: true,    // promoted: vibe is execution-only; gemini is the second advisor
    healthCheckTimeoutMs: 30000,
    // 240s matches claude. Real brainstorm-with-file-reads prompts on Flash 3 land around 170s,
    // so 120s was too tight — bumped with ~40% headroom. If a user opts into Pro via
    // SENATE_GEMINI_MODEL, they should pair it with `--timeout 10m`.
    advisorInactivityMs: 240000,
    env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' }
  }),
  entry({
    name: 'vibe',
    defaultBinName: 'vibe',
    // `-p` runs vibe in programmatic mode with the auto-approve agent (per `vibe --help`),
    // which can multi-turn its way through tool calls until something stops it. Without bounds,
    // an opinion call could quietly turn into a 20-turn read/grep loop that blows our 60s
    // inactivity budget and burns Mistral credits. `--max-turns` + `--max-price` are the
    // documented guards (see the vibe-delegate skill). `--trust` skips the trust prompt so
    // vibe never blocks waiting on stdin when senate runs in a directory that hasn't been
    // accepted yet. Numbers match the upper end of the vibe-delegate skill's recommended caps
    // (TDD feature tier) so they don't tighten normal use — they just prevent runaway loops.
    args: (p) => ['-p', p, '--output', 'text', '--trust', '--max-turns', '25', '--max-price', '1.00'],
    parse: (stdout) => stdout.trim(),
    authPatterns: [
      'please run vibe --setup',
      'api key not found',
      'api key not valid',
      'api key not set',
      'api key required',
      'authentication failed',
      'authentication required',
      'not authenticated'
    ],
    // vibe is the execution grunt, not an advisor. Opt in with `-a claude,vibe` if you want
    // its opinion explicitly. Last in synthesis priority — only leads if both claude and
    // gemini fail.
    inSynthesisPriority: true,
    inDefaultAdvisors: false,
    healthCheckTimeoutMs: 15000,
    advisorInactivityMs: 60000   // text-streaming, but be generous
  })
];

const BY_NAME: Record<string, EngineEntry> = Object.fromEntries(REGISTRY.map(e => [e.name, e]));

export function getEngineConfig(name: string): EngineEntry | undefined {
  return BY_NAME[name];
}

export function listEngineNames(): string[] {
  return REGISTRY.map(e => e.name);
}

export function listEngineEntries(): EngineEntry[] {
  return [...REGISTRY];
}

export function getSynthesisPriority(): string[] {
  return REGISTRY.filter(e => e.inSynthesisPriority).map(e => e.name);
}

export function getDefaultAdvisors(): string[] {
  return REGISTRY.filter(e => e.inDefaultAdvisors).map(e => e.name);
}

export function getAuthPatterns(name: string): string[] {
  return BY_NAME[name]?.authPatterns ?? [];
}
