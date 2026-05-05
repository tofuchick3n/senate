import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TranscriptWriter,
  loadSession,
  listSessions,
  resolveSessionRef
} from '../transcripts.js';
import type { WorkflowResult } from '../workflow.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'senate-tx-'));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function fakeResult(): WorkflowResult {
  return {
    decision: {
      consultAdvisors: true,
      advisors: ['claude', 'vibe'],
      executeWithVibe: false,
      explanation: 'test'
    },
    advisorResults: [
      { name: 'claude', status: 'ok', output: 'hi from claude', durationMs: 100 },
      { name: 'vibe', status: 'ok', output: 'hi from vibe', durationMs: 120 }
    ],
    synthesis: null,
    executionResult: null,
    totalDurationMs: 230,
    cancelled: false
  };
}

describe('TranscriptWriter', () => {
  it('writes a session_start line on construction', () => {
    const w = new TranscriptWriter('hello', { advisors: ['claude'] }, tmpDir);
    const { start } = loadSession(w.path);
    assert.ok(start);
    assert.equal(start!.type, 'session_start');
    assert.equal(start!.prompt, 'hello');
    assert.deepEqual(start!.mode.advisors, ['claude']);
    assert.ok(start!.ts);
  });

  it('appends events and ends with the result', () => {
    const w = new TranscriptWriter('q', { advisors: ['claude', 'vibe'] }, tmpDir);
    w.appendEvent({ type: 'consult_start', advisors: ['claude', 'vibe'] });
    w.appendEvent({ type: 'engine_done', name: 'claude', status: 'ok', durationMs: 100, output: 'x' });
    w.end(fakeResult());

    const { start, end, events } = loadSession(w.path);
    assert.ok(start);
    assert.ok(end);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'consult_start');
    assert.equal(events[1].type, 'engine_done');
    assert.equal(end!.result.totalDurationMs, 230);
    assert.equal(end!.result.advisorResults.length, 2);
  });

  it('survives missing directory by creating it', () => {
    const newDir = join(tmpDir, 'nested', 'deeper');
    const w = new TranscriptWriter('q', { advisors: [] }, newDir);
    w.end(fakeResult());
    const files = readdirSync(newDir);
    assert.equal(files.length, 1);
    assert.match(files[0], /\.jsonl$/);
  });

  it('produces filename-safe sortable timestamps', () => {
    const w = new TranscriptWriter('q', { advisors: [] }, tmpDir);
    const filename = w.path.split('/').pop()!;
    // No colons or dots in the timestamp portion (would break Windows / shell).
    const tsPortion = filename.replace('.jsonl', '');
    assert.ok(!tsPortion.includes(':'), 'no colons');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(tsPortion), 'ISO-like prefix');
  });
});

describe('listSessions', () => {
  it('returns empty for missing directory', () => {
    assert.deepEqual(listSessions(join(tmpDir, 'does-not-exist')), []);
  });

  it('returns sessions newest-first', async () => {
    const w1 = new TranscriptWriter('first', { advisors: [] }, tmpDir);
    w1.end(fakeResult());
    // Sleep 5ms so the second session has a strictly later filename.
    await new Promise(r => setTimeout(r, 5));
    const w2 = new TranscriptWriter('second', { advisors: [] }, tmpDir);
    w2.end(fakeResult());

    const sessions = listSessions(tmpDir);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].prompt, 'second');
    assert.equal(sessions[1].prompt, 'first');
  });

  it('truncates prompt preview to 80 chars and collapses whitespace', () => {
    const longPrompt = 'lorem\nipsum\tdolor   sit  amet  '.repeat(10);
    const w = new TranscriptWriter(longPrompt, { advisors: [] }, tmpDir);
    w.end(fakeResult());
    const [s] = listSessions(tmpDir);
    assert.ok(s.promptPreview.length <= 80);
    assert.ok(!s.promptPreview.includes('\n'));
    assert.ok(!s.promptPreview.includes('\t'));
  });

  it('respects the limit argument', () => {
    for (let i = 0; i < 5; i++) {
      const w = new TranscriptWriter(`q${i}`, { advisors: [] }, tmpDir);
      w.end(fakeResult());
    }
    assert.equal(listSessions(tmpDir, 3).length, 3);
  });

  it('skips files that are not parseable JSONL', () => {
    // Create a junk file
    const junkPath = join(tmpDir, '999-bogus.jsonl');
    writeFileSync(junkPath, 'this is not JSON\n');
    const w = new TranscriptWriter('valid', { advisors: [] }, tmpDir);
    w.end(fakeResult());
    const sessions = listSessions(tmpDir);
    // Junk file has no session_start so it gets filtered, valid one stays.
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].prompt, 'valid');
  });
});

describe('resolveSessionRef', () => {
  it('returns null for missing path', () => {
    assert.equal(resolveSessionRef('/does/not/exist.jsonl', tmpDir), null);
  });

  it('resolves an existing path as-is', () => {
    const w = new TranscriptWriter('q', { advisors: [] }, tmpDir);
    w.end(fakeResult());
    assert.equal(resolveSessionRef(w.path, tmpDir), w.path);
  });

  it('resolves an integer index against listSessions order', async () => {
    const w1 = new TranscriptWriter('first', { advisors: [] }, tmpDir);
    w1.end(fakeResult());
    await new Promise(r => setTimeout(r, 5));
    const w2 = new TranscriptWriter('second', { advisors: [] }, tmpDir);
    w2.end(fakeResult());

    // 0 = newest = second
    assert.equal(resolveSessionRef('0', tmpDir), w2.path);
    assert.equal(resolveSessionRef('1', tmpDir), w1.path);
  });

  it('returns null for an out-of-range integer', () => {
    const w = new TranscriptWriter('only', { advisors: [] }, tmpDir);
    w.end(fakeResult());
    assert.equal(resolveSessionRef('99', tmpDir), null);
  });
});
