/**
 * Read the most-recent vibe session log to recover real token counts and
 * (when senate spawned the wrapper) the final assistant message.
 *
 * Why this exists:
 *   - vibe's `--output text` mode prints only the model's final response —
 *     no token or cost stats. Without this helper, vibe contributes nothing
 *     to senate's USAGE footer.
 *   - When senate spawns the optional wrapper at `~/tools/vibe-delegate`
 *     (see `resolveVibeWrapper`), the wrapper's stdout is a stream of
 *     `[read]/[tool]/[vibe]` event lines, not the canonical answer — we
 *     have to recover the assistant message from the session log instead.
 *
 * The vibe CLI writes to `$VIBE_HOME/logs/session/<id>/` after every run:
 *   - `meta.json`     — has `stats.last_turn_*_tokens` and a synthetic
 *                       `session_cost` (Mistral list-price, NOT actual Pro spend)
 *   - `messages.jsonl` — one JSON object per message (system/user/assistant/tool)
 *
 * "Most recent session" is determined by directory mtime. This is safe in
 * senate's flow because vibe runs at most once per senate invocation
 * (advisors run in parallel, but only one vibe is in the council).
 *
 * Mistral Pro is a flat-rate subscription. The `session_cost` field is a
 * list-price equivalent at API pricing, NOT the user's actual spend. We
 * deliberately leave `costUsd` undefined in the returned EngineUsage so
 * the USAGE footer doesn't misrepresent Pro plan billing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import type { EngineUsage } from './registry.js';

export function vibeSessionRoot(): string {
  const vibeHome = process.env.VIBE_HOME?.trim() || path.join(os.homedir(), '.vibe');
  return path.join(vibeHome, 'logs', 'session');
}

/**
 * Returns the most-recently-modified session directory, or null if the
 * session root doesn't exist / is empty / can't be read.
 */
export function findLatestVibeSession(root: string = vibeSessionRoot()): string | null {
  try {
    if (!fs.existsSync(root)) return null;
    const entries = fs.readdirSync(root);
    if (entries.length === 0) return null;

    let bestDir: string | null = null;
    let bestMtime = -Infinity;
    for (const name of entries) {
      const full = path.join(root, name);
      try {
        const st = fs.statSync(full);
        if (!st.isDirectory()) continue;
        if (st.mtimeMs > bestMtime) {
          bestMtime = st.mtimeMs;
          bestDir = full;
        }
      } catch { /* skip unreadable entry */ }
    }
    return bestDir;
  } catch {
    return null;
  }
}

/**
 * Parse `meta.json` and return real token counts. Returns undefined when the
 * file is missing, unreadable, malformed, or doesn't contain numeric stats.
 *
 * `costUsd` is deliberately left undefined — see module docs.
 */
export function readVibeUsage(root: string = vibeSessionRoot()): EngineUsage | undefined {
  const sessionDir = findLatestVibeSession(root);
  if (!sessionDir) return undefined;

  const metaPath = path.join(sessionDir, 'meta.json');
  let meta: any;
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    meta = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const stats = meta?.stats;
  if (!stats || typeof stats !== 'object') return undefined;

  const inputTokens = typeof stats.last_turn_prompt_tokens === 'number' ? stats.last_turn_prompt_tokens : undefined;
  const outputTokens = typeof stats.last_turn_completion_tokens === 'number' ? stats.last_turn_completion_tokens : undefined;
  let totalTokens: number | undefined =
    typeof stats.last_turn_total_tokens === 'number' ? stats.last_turn_total_tokens : undefined;
  if (totalTokens == null && inputTokens != null && outputTokens != null) {
    totalTokens = inputTokens + outputTokens;
  }

  if (inputTokens == null && outputTokens == null && totalTokens == null) return undefined;

  return { inputTokens, outputTokens, totalTokens };
}

/**
 * Walk `messages.jsonl` from the end and return the last assistant message's
 * content. Used when senate ran vibe via the wrapper, whose stdout is
 * streaming events rather than the canonical answer.
 *
 * Returns empty string when no assistant message can be recovered. Callers
 * should treat empty as a failure and fall back to whatever stdout they have.
 */
export function readVibeFinalAssistantMessage(root: string = vibeSessionRoot()): string {
  const sessionDir = findLatestVibeSession(root);
  if (!sessionDir) return '';

  const messagesPath = path.join(sessionDir, 'messages.jsonl');
  let raw: string;
  try {
    raw = fs.readFileSync(messagesPath, 'utf-8');
  } catch {
    return '';
  }

  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg?.role === 'assistant' && typeof msg.content === 'string' && msg.content.length > 0) {
        return msg.content;
      }
    } catch {
      // skip unparseable line
    }
  }
  return '';
}

/**
 * Resolve the vibe wrapper path: env override takes precedence, then
 * `~/tools/vibe-delegate`. Returns null when no executable wrapper exists.
 *
 * The wrapper accepts positional args `<workdir> <prompt> [max-turns]
 * [agent] [timeout-secs]`, allocates a streaming environment, and writes a
 * structured run log to `~/.local/share/delegate-runs.jsonl`. When present,
 * senate's vibe engine calls the wrapper instead of `vibe` directly and
 * recovers the canonical answer + tokens from the session log helpers above.
 */
export function resolveVibeWrapper(): string | null {
  const override = process.env.SENATE_VIBE_WRAPPER?.trim();
  const candidates = override ? [override] : [path.join(os.homedir(), 'tools', 'vibe-delegate')];
  for (const candidate of candidates) {
    try {
      const st = fs.statSync(candidate);
      // Executable check via mode bits. fs.X_OK would be cleaner but stat-only
      // keeps this fully synchronous and avoids accessSync's exception path.
      if (st.isFile() && (st.mode & 0o111)) return candidate;
    } catch { /* missing / unreadable — try next candidate */ }
  }
  return null;
}
