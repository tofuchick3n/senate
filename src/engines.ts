import { spawn } from 'node:child_process';
import {
  getEngineConfig,
  getAuthPatterns,
  listEngineNames,
  listEngineEntries,
  getSynthesisPriority
} from './registry.js';

import type { EngineUsage } from './registry.js';

export type EngineResult = {
  name: string;
  status: 'ok' | 'error' | 'missing' | 'unauthenticated' | 'cancelled';
  output: string;
  durationMs: number;
  error?: string;
  /**
   * Raw stdout captured on non-zero exit. Always present on status='error', so the
   * session file and orchestrators can inspect what the engine wrote before failing.
   * Empty on missing/unauthenticated/cancelled (the engine never produced output).
   */
  rawStdout?: string;
  /**
   * Raw stderr captured on non-zero exit. Same rationale as rawStdout — keeps
   * post-mortem debugging possible without re-running the prompt.
   */
  rawStderr?: string;
  usage?: EngineUsage;
};

/**
 * Patterns we know are non-fatal warnings from engine CLIs. The first line of
 * stderr is often a warning (Gemini "Ripgrep not available", "Skill conflict
 * detected") — surfacing that as the error masked the real cause (e.g. an HTTP
 * 429 quota error deep in the output).
 */
const NON_FATAL_WARNING_RE = /^(ripgrep is not available|skill conflict detected|warning:|warn:|note:|at )/i;

/**
 * Picks a useful error line out of combined stdout+stderr. Order of preference:
 *   1. Recognized infrastructure failures (HTTP 429 quota, auth-already-handled-upstream,
 *      OOM) reported with a clean canonical message.
 *   2. The last "meaningful" line — non-warning, has letters, ≥6 chars (skips bare
 *      `}` / `}}}` from JSON stack-trace tails).
 *   3. First non-empty line as a final fallback.
 */
export function pickErrorLine(combined: string): string {
  const lower = combined.toLowerCase();
  if (
    lower.includes('"code": 429') ||
    lower.includes('"code":429') ||
    /\bstatus:?\s*429\b/.test(lower) ||
    lower.includes('resource_exhausted') ||
    lower.includes('too many requests')
  ) {
    return 'API quota / rate limit exceeded (HTTP 429 — check your provider billing)';
  }

  const lines = combined.split('\n').map(l => l.trim()).filter(Boolean);
  const meaningful = lines.filter(l =>
    !NON_FATAL_WARNING_RE.test(l) && l.length >= 6 && /[a-z]/i.test(l)
  );
  if (meaningful.length > 0) {
    const picked = meaningful[meaningful.length - 1];
    return picked.length > 240 ? picked.slice(0, 237) + '...' : picked;
  }
  return lines[0] || 'Unknown error';
}

/**
 * Spawn-failure sentinel written by the `child.on('error')` handler below.
 * Real binary-missing errors land here as `spawn <name>: ENOENT ...`. Matching
 * THIS pattern (rather than an arbitrary 'not found' substring on combined output)
 * keeps us from misclassifying long-running model responses that happen to mention
 * 'not found' as a missing-binary failure.
 */
const SPAWN_ERROR_RE = /(^|\n)spawn [^\n]*: (ENOENT|EACCES|EPERM|ENOTDIR)\b/;

export type RunEngineOptions = {
  inactivityMs?: number;
  stream?: boolean;
  signal?: AbortSignal;
};

/**
 * Backward-compat re-export. New code should import from './registry.js'.
 * Synthesis priority lives in the registry now (each entry has inSynthesisPriority + position).
 */
export const SYNTHESIS_PRIORITY = getSynthesisPriority();

export async function runEngine(name: string, prompt: string, opts: RunEngineOptions = {}): Promise<EngineResult> {
  const { inactivityMs = 30000, stream = true, signal } = opts;
  const config = getEngineConfig(name);
  if (!config) return { name, status: 'missing', output: '', durationMs: 0 };

  // If already aborted before we even spawn, return immediately.
  if (signal?.aborted) {
    return { name, status: 'cancelled', output: '', durationMs: 0, error: 'Cancelled before start' };
  }

  const env = { ...process.env, ...(config.env ?? {}) };

  return new Promise((resolve) => {
    const start = Date.now();
    // Run in its own process group so we can kill the whole tree (some wrapped CLIs spawn
    // subprocesses that ignore SIGTERM if we only signal the parent).
    const child = spawn(config.bin, config.args(prompt), {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      detached: true
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let inactivityTimer: NodeJS.Timeout;
    let killGraceTimer: NodeJS.Timeout | null = null;

    // Capture spawn failures (ENOENT, EACCES, etc.). Without this listener Node throws an
    // uncaught 'error' event when the binary is missing. Routing the message into stderr
    // also lets the close handler's missing/auth pattern matcher classify it correctly.
    child.on('error', (err: NodeJS.ErrnoException) => {
      stderr += `spawn ${name}: ${err.code || ''} ${err.message}`;
    });

    const killGroup = (sig: NodeJS.Signals) => {
      // Negative pid signals the whole process group. Falls back to per-pid if pgid unavailable.
      if (child.pid) {
        try { process.kill(-child.pid, sig); return; } catch {}
        try { process.kill(child.pid, sig); } catch {}
      }
    };
    const onAbort = () => {
      if (cancelled) return;
      cancelled = true;
      killGroup('SIGTERM');
      // Hard kill after 1s if it's still hanging on (some CLIs trap SIGTERM).
      killGraceTimer = setTimeout(() => killGroup('SIGKILL'), 1000);
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const resetInactivityTimer = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        timedOut = true;
        killGroup('SIGKILL');
      }, inactivityMs);
    };

    // Initial inactivity timer. The inactivity timer is the only runtime cap —
    // a hard cap above it would override the user's --timeout for buffered (JSON) engines.
    resetInactivityTimer();

    child.stdout.on('data', (d) => {
      stdout += d;
      if (stream) process.stdout.write(`     ${d}`);
      resetInactivityTimer();
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stream) process.stderr.write(`     ${d}`);
      resetInactivityTimer();
    });

    child.on('close', (code) => {
      clearTimeout(inactivityTimer);
      if (killGraceTimer) clearTimeout(killGraceTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      const durationMs = Date.now() - start;
      const combinedOutput = stdout + stderr;

      if (cancelled) {
        return resolve({
          name,
          status: 'cancelled',
          output: '',
          durationMs,
          error: 'Cancelled by user'
        });
      }

      // Per-engine auth-error patterns (registry-driven). Avoids cross-contamination —
      // e.g. "must specify the gemini_api_key" should NOT classify a claude failure as auth.
      const authPatterns = getAuthPatterns(name);
      const isAuthError = authPatterns.some(pattern =>
        combinedOutput.toLowerCase().includes(pattern)
      );

      if (timedOut) {
        return resolve({
          name,
          status: 'error',
          output: '',
          durationMs,
          error: `Inactivity timeout (no output for ${(inactivityMs / 1000).toFixed(0)}s — try --timeout <seconds>)`
        });
      }

      if (code !== 0) {
        if (isAuthError) {
          return resolve({
            name,
            status: 'unauthenticated',
            output: '',
            durationMs,
            error: 'Authentication required'
          });
        }
        // Strict spawn-failure check via the sentinel our error handler writes —
        // not a fuzzy `combinedOutput.includes('not found')` match, which was
        // misclassifying long-running engine responses (e.g. Gemini producing
        // text containing 'not found') as missing-binary failures.
        if (SPAWN_ERROR_RE.test(stderr)) {
          return resolve({
            name,
            status: 'missing',
            output: '',
            durationMs,
            error: 'Binary not found'
          });
        }
        // Preserve raw stdout/stderr so the session file has evidence to debug
        // ambiguous non-zero exits (engine produced output but exited non-zero).
        // The error message picker now skips known non-fatal warning prefixes.
        return resolve({
          name,
          status: 'error',
          output: '',
          durationMs,
          error: pickErrorLine(combinedOutput),
          rawStdout: stdout,
          rawStderr: stderr
        });
      }

      const output = config.parse(stdout);
      const usage = config.parseUsage?.(stdout, stderr);
      resolve({
        name,
        status: 'ok',
        output,
        durationMs,
        ...(usage ? { usage } : {})
      });
    });
  });
}

export function listEngines(): string[] {
  return listEngineNames();
}

export async function checkEngines(): Promise<Record<string, EngineResult>> {
  // Per-engine health-check timeout comes from the registry (e.g. gemini gets longer due to skill loading).
  const promises = listEngineEntries().map(e =>
    runEngine(e.name, 'ping', { inactivityMs: e.healthCheckTimeoutMs, stream: false })
      .then(result => ({ name: e.name, result }))
  );
  const results: Record<string, EngineResult> = {};
  for (const { name, result } of await Promise.all(promises)) {
    results[name] = result;
  }
  return results;
}

export function getAvailableEngines(): Promise<string[]> {
  return checkEngines().then(results =>
    Object.entries(results)
      .filter(([_, result]) => result.status === 'ok')
      .map(([name]) => name)
  );
}
