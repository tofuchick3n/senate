import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  findLatestVibeSession,
  readVibeUsage,
  readVibeFinalAssistantMessage,
  resolveVibeWrapper
} from '../vibe-session-log.js';

function makeSessionRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'senate-vibe-session-'));
}

function writeSession(
  root: string,
  name: string,
  meta: unknown | null,
  messages: unknown[] | null,
  mtimeOffsetMs = 0
): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (meta !== null) fs.writeFileSync(path.join(dir, 'meta.json'), typeof meta === 'string' ? meta : JSON.stringify(meta));
  if (messages !== null) {
    const lines = messages.map(m => JSON.stringify(m)).join('\n');
    fs.writeFileSync(path.join(dir, 'messages.jsonl'), lines);
  }
  // Nudge mtime so tests can deterministically pick "latest" regardless of FS resolution.
  const ts = new Date(Date.now() + mtimeOffsetMs);
  fs.utimesSync(dir, ts, ts);
  return dir;
}

describe('findLatestVibeSession', () => {
  it('returns null when root does not exist', () => {
    assert.equal(findLatestVibeSession('/definitely/not/a/real/path/nope'), null);
  });

  it('returns null when root is empty', () => {
    const root = makeSessionRoot();
    try {
      assert.equal(findLatestVibeSession(root), null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('picks the most-recently-modified directory', () => {
    const root = makeSessionRoot();
    try {
      writeSession(root, 'older', {}, [], -10000);
      const expected = writeSession(root, 'newer', {}, [], 0);
      writeSession(root, 'oldest', {}, [], -20000);
      assert.equal(findLatestVibeSession(root), expected);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores non-directory entries at the root', () => {
    const root = makeSessionRoot();
    try {
      fs.writeFileSync(path.join(root, 'stray-file.txt'), 'not a session');
      const expected = writeSession(root, 'session_a', {}, [], 0);
      assert.equal(findLatestVibeSession(root), expected);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('readVibeUsage', () => {
  it('returns undefined when there are no sessions', () => {
    assert.equal(readVibeUsage('/no/such/root'), undefined);
  });

  it('returns undefined when meta.json is missing', () => {
    const root = makeSessionRoot();
    try {
      writeSession(root, 'session_a', null, []);
      assert.equal(readVibeUsage(root), undefined);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns undefined on malformed JSON without throwing', () => {
    const root = makeSessionRoot();
    try {
      writeSession(root, 'session_a', '{ this is not json', []);
      assert.equal(readVibeUsage(root), undefined);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns undefined when stats block is missing entirely', () => {
    const root = makeSessionRoot();
    try {
      writeSession(root, 'session_a', { session_id: 'x' }, []);
      assert.equal(readVibeUsage(root), undefined);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('extracts input/output/total tokens and never sets costUsd', () => {
    const root = makeSessionRoot();
    try {
      writeSession(root, 'session_a', {
        stats: {
          last_turn_prompt_tokens: 1200,
          last_turn_completion_tokens: 300,
          last_turn_total_tokens: 1500,
          // session_cost is a list-price equivalent on Mistral Pro (flat-rate plan).
          // Including it here proves readVibeUsage IGNORES it on purpose.
          session_cost: 0.0123
        }
      }, []);
      const usage = readVibeUsage(root);
      assert.ok(usage, 'usage should be returned');
      assert.equal(usage!.inputTokens, 1200);
      assert.equal(usage!.outputTokens, 300);
      assert.equal(usage!.totalTokens, 1500);
      assert.equal(usage!.costUsd, undefined, 'costUsd must stay undefined for vibe (Pro = flat-rate)');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('derives totalTokens by summing when only input/output are present', () => {
    const root = makeSessionRoot();
    try {
      writeSession(root, 'session_a', {
        stats: { last_turn_prompt_tokens: 100, last_turn_completion_tokens: 25 }
      }, []);
      const usage = readVibeUsage(root);
      assert.ok(usage);
      assert.equal(usage!.totalTokens, 125);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips non-numeric stats fields without throwing', () => {
    const root = makeSessionRoot();
    try {
      writeSession(root, 'session_a', {
        stats: {
          last_turn_prompt_tokens: 'oops',
          last_turn_completion_tokens: null,
          last_turn_total_tokens: false
        }
      }, []);
      assert.equal(readVibeUsage(root), undefined);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the most recent session when multiple exist', () => {
    const root = makeSessionRoot();
    try {
      writeSession(root, 'older', { stats: { last_turn_total_tokens: 999 } }, [], -10000);
      writeSession(root, 'newer', { stats: { last_turn_total_tokens: 42 } }, [], 0);
      const usage = readVibeUsage(root);
      assert.equal(usage?.totalTokens, 42);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('readVibeFinalAssistantMessage', () => {
  it('returns empty string when no session exists', () => {
    assert.equal(readVibeFinalAssistantMessage('/no/such/root'), '');
  });

  it('returns empty string when messages.jsonl is missing', () => {
    const root = makeSessionRoot();
    try {
      writeSession(root, 'session_a', {}, null);
      assert.equal(readVibeFinalAssistantMessage(root), '');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns the last assistant message content', () => {
    const root = makeSessionRoot();
    try {
      writeSession(root, 'session_a', {}, [
        { role: 'system', content: 'You are vibe.' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'first reply' },
        { role: 'tool', content: 'search result' },
        { role: 'assistant', content: 'final reply' }
      ]);
      assert.equal(readVibeFinalAssistantMessage(root), 'final reply');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips unparseable lines and empty content without throwing', () => {
    const root = makeSessionRoot();
    try {
      const dir = path.join(root, 'session_a');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'messages.jsonl'),
        [
          '{not json}',
          JSON.stringify({ role: 'assistant', content: 'real one' }),
          '',
          '{not json either}'
        ].join('\n')
      );
      assert.equal(readVibeFinalAssistantMessage(root), 'real one');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns empty string when there is no assistant message at all', () => {
    const root = makeSessionRoot();
    try {
      writeSession(root, 'session_a', {}, [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
        { role: 'tool', content: 't' }
      ]);
      assert.equal(readVibeFinalAssistantMessage(root), '');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('resolveVibeWrapper', () => {
  let savedEnv: string | undefined;
  let savedHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    savedEnv = process.env.SENATE_VIBE_WRAPPER;
    savedHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'senate-vibe-home-'));
    process.env.HOME = tmpHome;
    delete process.env.SENATE_VIBE_WRAPPER;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.SENATE_VIBE_WRAPPER;
    else process.env.SENATE_VIBE_WRAPPER = savedEnv;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns null when no env override is set and ~/tools/vibe-delegate is missing', () => {
    assert.equal(resolveVibeWrapper(), null);
  });

  it('honors $SENATE_VIBE_WRAPPER when the override file is executable', () => {
    const wrapper = path.join(tmpHome, 'my-wrapper');
    fs.writeFileSync(wrapper, '#!/usr/bin/env bash\necho hi');
    fs.chmodSync(wrapper, 0o755);
    process.env.SENATE_VIBE_WRAPPER = wrapper;
    assert.equal(resolveVibeWrapper(), wrapper);
  });

  it('returns null when $SENATE_VIBE_WRAPPER points at a non-executable file', () => {
    const wrapper = path.join(tmpHome, 'not-exec');
    fs.writeFileSync(wrapper, '#!/usr/bin/env bash\necho hi');
    fs.chmodSync(wrapper, 0o644);
    process.env.SENATE_VIBE_WRAPPER = wrapper;
    assert.equal(resolveVibeWrapper(), null);
  });

  it('returns null when $SENATE_VIBE_WRAPPER points at a missing path', () => {
    process.env.SENATE_VIBE_WRAPPER = path.join(tmpHome, 'does-not-exist');
    assert.equal(resolveVibeWrapper(), null);
  });

  it('falls back to ~/tools/vibe-delegate when no env override is set', () => {
    const toolsDir = path.join(tmpHome, 'tools');
    fs.mkdirSync(toolsDir, { recursive: true });
    const wrapper = path.join(toolsDir, 'vibe-delegate');
    fs.writeFileSync(wrapper, '#!/usr/bin/env bash\necho hi');
    fs.chmodSync(wrapper, 0o755);
    assert.equal(resolveVibeWrapper(), wrapper);
  });

  it('env override takes precedence over the ~/tools fallback', () => {
    const toolsDir = path.join(tmpHome, 'tools');
    fs.mkdirSync(toolsDir, { recursive: true });
    const fallback = path.join(toolsDir, 'vibe-delegate');
    fs.writeFileSync(fallback, '#!/usr/bin/env bash\necho fallback');
    fs.chmodSync(fallback, 0o755);

    const override = path.join(tmpHome, 'override-wrapper');
    fs.writeFileSync(override, '#!/usr/bin/env bash\necho override');
    fs.chmodSync(override, 0o755);
    process.env.SENATE_VIBE_WRAPPER = override;

    assert.equal(resolveVibeWrapper(), override);
  });
});
