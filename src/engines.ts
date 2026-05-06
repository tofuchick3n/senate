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
  usage?: EngineUsage;
};

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
    let timedOutReason: 'inactivity' | 'hard_cap' | null = null;
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
        timedOutReason = 'inactivity';
        killGroup('SIGKILL');
      }, inactivityMs);
    };

    // Initial inactivity timer
    resetInactivityTimer();

    // Also keep a max timeout as safety (5 minutes)
    const maxTimeout = setTimeout(() => {
      timedOut = true;
      timedOutReason = 'hard_cap';
      killGroup('SIGKILL');
    }, 300000);

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
      clearTimeout(maxTimeout);
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
        const reason = timedOutReason === 'hard_cap'
          ? `Hard cap timeout (5min max runtime)`
          : `Inactivity timeout (no output for ${(inactivityMs / 1000).toFixed(0)}s — try --timeout <seconds> or set advisorInactivityMs in registry)`;
        return resolve({
          name,
          status: 'error',
          output: '',
          durationMs,
          error: reason
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
        if (combinedOutput.includes('not found') || combinedOutput.includes('ENOENT')) {
          return resolve({
            name,
            status: 'missing',
            output: '',
            durationMs,
            error: 'Binary not found'
          });
        }
        return resolve({
          name,
          status: 'error',
          output: '',
          durationMs,
          error: combinedOutput.trim().split('\n').at(0) || 'Unknown error'
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
