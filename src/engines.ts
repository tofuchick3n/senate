import { spawn } from 'node:child_process';

export type EngineResult = {
  name: string;
  status: 'ok' | 'error' | 'missing' | 'unauthenticated';
  output: string;
  durationMs: number;
  error?: string;
};

const ENGINE_CONFIGS: Record<string, {
  bin: string;
  args: (prompt: string) => string[];
  parse: (stdout: string) => string;
  authCheck?: (stderr: string) => boolean;
}> = {
  claude: {
    bin: 'claude',
    args: (p) => ['--bare', '-p', '--permission-mode', 'plan', '--output-format', 'stream-json'],
    parse: (stdout) => {
      const lines = stdout.split('\n');
      const textParts = lines
        .map(l => {
          try { return JSON.parse(l)?.message?.content?.[0]?.text; } catch { return null; }
        })
        .filter(Boolean);
      return textParts.join('');
    }
  },
  vibe: {
    bin: 'vibe',
    args: (p) => ['--no-interactive', '--task', p, '--output-format', 'text'],
    parse: (stdout) => stdout.trim(),
    authCheck: (stderr) => !stderr.includes('API key not found')
  },
  gemini: {
    bin: 'gemini',
    args: (p) => ['-p', p, '--approval-mode', 'plan', '--output-format', 'json'],
    parse: (stdout) => {
      try { return JSON.parse(stdout)?.response; } catch { return stdout; }
    },
    authCheck: (stderr) => !stderr.includes('authentication') && !stderr.includes('login')
  }
};

export async function runEngine(name: string, prompt: string): Promise<EngineResult> {
  const config = ENGINE_CONFIGS[name];
  if (!config) return { name, status: 'missing', output: '', durationMs: 0 };

  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(config.bin, config.args(prompt), {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => stdout += d);
    child.stderr.on('data', (d) => stderr += d);

    child.on('close', (code) => {
      const durationMs = Date.now() - start;

      if (config.authCheck && !config.authCheck(stderr)) {
        return resolve({
          name,
          status: 'unauthenticated',
          output: '',
          durationMs,
          error: 'Authentication required'
        });
      }

      if (code !== 0 || stderr.includes('not found') || stderr.includes('ENOENT')) {
        return resolve({
          name,
          status: stderr.includes('not found') || stderr.includes('ENOENT') ? 'missing' : 'error',
          output: '',
          durationMs,
          error: stderr.trim().split('\n').at(0) || 'Unknown error'
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

export function getAvailableEngines(): Promise<string[]> {
  return Promise.all(
    Object.keys(ENGINE_CONFIGS).map(async (name) => {
      const result = await runEngine(name, 'ping');
      return result.status === 'ok' ? name : null;
    })
  ).then(results => results.filter(Boolean) as string[]);
}
