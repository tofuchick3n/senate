import { spawn } from 'node:child_process';

export type EngineResult = {
  name: string;
  status: 'ok' | 'error' | 'missing' | 'unauthenticated' | 'cancelled';
  output: string;
  durationMs: number;
  error?: string;
};

export type RunEngineOptions = {
  inactivityMs?: number;
  stream?: boolean;
  signal?: AbortSignal;
};

// Order matters: synthesis tries these as the lead summarizer in order, falling back if one
// fails. Claude is first because it produces the most reliable structured output. To add a
// new engine, register it in ENGINE_CONFIGS below and append it here only if you want it
// eligible to lead synthesis.
export const SYNTHESIS_PRIORITY = ['claude', 'vibe', 'gemini'] as const;

const ENGINE_CONFIGS: Record<string, {
  bin: string;
  args: (prompt: string) => string[];
  parse: (stdout: string) => string;
}> = {
  claude: {
    bin: 'claude',
    args: (p) => ['-p', p, '--permission-mode', 'bypassPermissions'],
    parse: (stdout) => stdout.trim()
  },
  vibe: {
    bin: 'vibe',
    args: (p) => ['-p', p, '--output', 'text'],
    parse: (stdout) => stdout.trim()
  },
  gemini: {
    bin: 'gemini',
    args: (p) => ['-p', p, '--skip-trust', '--output-format', 'text'],
    parse: (stdout) => stdout.trim()
  }
};

export async function runEngine(name: string, prompt: string, opts: RunEngineOptions = {}): Promise<EngineResult> {
  const { inactivityMs = 30000, stream = true, signal } = opts;
  const config = ENGINE_CONFIGS[name];
  if (!config) return { name, status: 'missing', output: '', durationMs: 0 };

  // If already aborted before we even spawn, return immediately.
  if (signal?.aborted) {
    return { name, status: 'cancelled', output: '', durationMs: 0, error: 'Cancelled before start' };
  }

  const env = { ...process.env };
  // Set trust workspace for gemini to avoid directory trust prompts
  if (name === 'gemini') {
    env.GEMINI_CLI_TRUST_WORKSPACE = 'true';
  }

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

    // Initial inactivity timer
    resetInactivityTimer();

    // Also keep a max timeout as safety (5 minutes)
    const maxTimeout = setTimeout(() => {
      timedOut = true;
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

      // Check for authentication errors in both stdout and stderr
      // Be specific to avoid false positives (e.g., "Error authenticating" for eligibility issues)
      const authErrorPatterns = [
        'not logged in',
        'please run /login',
        'please run claude auth',
        'please run vibe --setup',
        'api key not found',
        'api key not valid',
        'api key not set',
        'api key required',
        'authentication failed',
        'authentication required',
        'not authenticated',
        'must specify the gemini_api_key'
      ];
      const isAuthError = authErrorPatterns.some(pattern => 
        combinedOutput.toLowerCase().includes(pattern)
      );

      if (timedOut) {
        return resolve({
          name,
          status: 'error',
          output: '',
          durationMs,
          error: 'Timeout'
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

      resolve({
        name,
        status: 'ok',
        output: config.parse(stdout),
        durationMs
      });
    });
  });
}

export function listEngines(): string[] {
  return Object.keys(ENGINE_CONFIGS);
}

export async function checkEngines(): Promise<Record<string, EngineResult>> {
  const names = Object.keys(ENGINE_CONFIGS);
  // Use longer timeout for health checks: gemini needs more time due to skill loading
  const checkTimeouts: Record<string, number> = { gemini: 30000, claude: 15000, vibe: 15000 };
  const promises = names.map(name => runEngine(name, 'ping', { inactivityMs: checkTimeouts[name] || 15000, stream: false }).then(result => ({ name, result })));
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
