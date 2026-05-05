import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import type { WorkflowEvent, WorkflowResult } from './workflow.js';

/**
 * Persistent transcripts for senate sessions.
 *
 * Each session is a single JSONL file in `~/.senate/sessions/`. Lines:
 *   - {type:'session_start', ts, prompt, mode}                 // first line
 *   - {type:'engine_done'|'consult_done'|...}                  // workflow events
 *   - {type:'session_end', ts, result}                         // final line, full WorkflowResult
 *
 * Reading back: see `loadSession`. Listing: `listSessions`.
 */

export const DEFAULT_SESSIONS_DIR = join(homedir(), '.senate', 'sessions');

export type SessionStartLine = {
  type: 'session_start';
  ts: string;
  prompt: string;
  mode: { consult?: boolean; execute?: boolean; advisors?: string[]; smart?: boolean; synthesize?: boolean };
};

export type SessionEndLine = {
  type: 'session_end';
  ts: string;
  result: WorkflowResult;
};

export type TranscriptLine = SessionStartLine | SessionEndLine | WorkflowEvent;

export type TranscriptSummary = {
  path: string;
  ts: string;
  prompt: string;
  promptPreview: string;
  advisors: string[];
  cancelled: boolean;
  durationMs: number;
};

let filenameCounter = 0;
function tsForFilename(d: Date = new Date()): string {
  // Sortable, filename-safe ISO-8601 (no colons): 2026-05-06T18-30-12-345Z
  // Append a per-process counter to avoid collisions when sessions are written within the same ms.
  filenameCounter = (filenameCounter + 1) % 1000;
  const suffix = String(filenameCounter).padStart(3, '0');
  return `${d.toISOString().replace(/[:.]/g, '-')}-${suffix}`;
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Streaming writer. Construct, then call appendEvent() for each WorkflowEvent,
 * then end() with the final WorkflowResult.
 *
 * Failures are swallowed (logged once) — a transcript is best-effort, never
 * blocking. We don't want disk problems to kill the user's senate run.
 */
export class TranscriptWriter {
  readonly path: string;
  private warned = false;

  constructor(prompt: string, mode: SessionStartLine['mode'], dir: string = DEFAULT_SESSIONS_DIR) {
    const ts = new Date().toISOString();
    const filename = `${tsForFilename()}.jsonl`;
    this.path = join(dir, filename);

    try {
      ensureDir(dir);
      const start: SessionStartLine = { type: 'session_start', ts, prompt, mode };
      writeFileSync(this.path, JSON.stringify(start) + '\n');
    } catch (err: any) {
      this.warn(`could not start transcript at ${this.path}: ${err.message}`);
    }
  }

  appendEvent(event: WorkflowEvent): void {
    try {
      appendFileSync(this.path, JSON.stringify(event) + '\n');
    } catch (err: any) {
      this.warn(`transcript append failed: ${err.message}`);
    }
  }

  end(result: WorkflowResult): void {
    try {
      const end: SessionEndLine = { type: 'session_end', ts: new Date().toISOString(), result };
      appendFileSync(this.path, JSON.stringify(end) + '\n');
    } catch (err: any) {
      this.warn(`transcript end failed: ${err.message}`);
    }
  }

  private warn(msg: string) {
    if (this.warned) return;
    this.warned = true;
    process.stderr.write(`[transcript] ${msg}\n`);
  }
}

/**
 * Load a session JSONL file. Returns the parsed lines plus convenience accessors
 * for the start/end records (which always exist if the writer wasn't aborted).
 */
export function loadSession(path: string): {
  lines: TranscriptLine[];
  start: SessionStartLine | null;
  end: SessionEndLine | null;
  events: WorkflowEvent[];
} {
  const raw = readFileSync(path, 'utf8');
  const lines: TranscriptLine[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      lines.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines — don't blow up on a corrupt transcript.
    }
  }
  const start = (lines.find(l => l.type === 'session_start') as SessionStartLine | undefined) ?? null;
  const end = (lines.find(l => l.type === 'session_end') as SessionEndLine | undefined) ?? null;
  const events = lines.filter(l => l.type !== 'session_start' && l.type !== 'session_end') as WorkflowEvent[];
  return { lines, start, end, events };
}

/**
 * Summarize the most recent N sessions, newest first.
 * Skips files that fail to parse (stale / corrupt) rather than throwing.
 */
export function listSessions(dir: string = DEFAULT_SESSIONS_DIR, limit: number = 20): TranscriptSummary[] {
  let files: string[];
  try {
    // Filenames are ISO-8601-derived + per-process counter — lexicographic sort = chronological.
    // Sort newest-first so we can stop reading once the limit is reached.
    files = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .reverse();
  } catch {
    return []; // dir doesn't exist yet — no sessions
  }

  const summaries: TranscriptSummary[] = [];
  for (const f of files) {
    if (summaries.length >= limit) break;
    const path = join(dir, f);
    try {
      const { start, end } = loadSession(path);
      if (!start) continue;
      const result = end?.result;
      summaries.push({
        path,
        ts: start.ts,
        prompt: start.prompt,
        promptPreview: start.prompt.replace(/\s+/g, ' ').slice(0, 80),
        advisors: result?.advisorResults.map(r => r.name) ?? start.mode.advisors ?? [],
        cancelled: result?.cancelled ?? false,
        durationMs: result?.totalDurationMs ?? 0
      });
    } catch {
      // skip
    }
  }
  return summaries;
}

/**
 * Resolve a `--resume` argument. Either an integer index into listSessions(),
 * or a literal path. Returns the absolute path.
 */
export function resolveSessionRef(ref: string, dir: string = DEFAULT_SESSIONS_DIR): string | null {
  // Pure integer? Treat as index into the listing.
  if (/^\d+$/.test(ref)) {
    const idx = parseInt(ref, 10);
    const sessions = listSessions(dir, idx + 1);
    return sessions[idx]?.path ?? null;
  }
  // Otherwise treat as a path. Verify it exists and is a regular file (not a directory).
  try {
    return statSync(ref).isFile() ? ref : null;
  } catch {
    return null;
  }
}
