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
  /** Substrings (lower-cased, matched on combined stdout+stderr) that mean "auth required". Per-engine to avoid cross-contamination. */
  authPatterns: string[];
  /** True if this engine is eligible to lead the synthesis step. Order in REGISTRY = synthesis priority. */
  inSynthesisPriority: boolean;
  /** True if this engine is in the default `--advisors` list. */
  inDefaultAdvisors: boolean;
  /** Inactivity timeout used by `senate --check-engines` for this engine. Defaults vary because gemini's CLI is slow to cold-start (skill loading). */
  healthCheckTimeoutMs: number;
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
 * Engine registry. Order matters: it determines synthesis lead priority.
 * Claude is first because it produces the most reliable structured output.
 */
const REGISTRY: EngineEntry[] = [
  entry({
    name: 'claude',
    defaultBinName: 'claude',
    args: (p) => ['-p', p, '--permission-mode', 'bypassPermissions'],
    parse: (stdout) => stdout.trim(),
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
    healthCheckTimeoutMs: 15000
  }),
  entry({
    name: 'vibe',
    defaultBinName: 'vibe',
    args: (p) => ['-p', p, '--output', 'text'],
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
    inSynthesisPriority: true,
    inDefaultAdvisors: true,
    healthCheckTimeoutMs: 15000
  }),
  entry({
    name: 'gemini',
    defaultBinName: 'gemini',
    args: (p) => ['-p', p, '--skip-trust', '--output-format', 'text'],
    parse: (stdout) => stdout.trim(),
    authPatterns: [
      'must specify the gemini_api_key',
      'api key not set',
      'api key required',
      'authentication failed',
      'authentication required',
      'not authenticated'
    ],
    inSynthesisPriority: true,
    inDefaultAdvisors: false,
    healthCheckTimeoutMs: 30000,
    env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' }
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
