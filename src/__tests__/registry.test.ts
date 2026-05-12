import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveBin,
  getEngineConfig,
  getDefaultAdvisors,
  getSynthesisPriority,
  getAuthPatterns,
  listEngineNames,
  buildVibeEntry
} from '../registry.js';

describe('resolveBin', () => {
  beforeEach(() => {
    delete process.env.SENATE_TEST_BIN;
  });
  afterEach(() => {
    delete process.env.SENATE_TEST_BIN;
  });

  it('falls back to defaultBinName when no env var is set', () => {
    assert.deepEqual(resolveBin('test', 'test-default'), ['test-default', false]);
  });

  it('uses SENATE_<NAME>_BIN env override when set', () => {
    process.env.SENATE_TEST_BIN = '/custom/path/test';
    assert.deepEqual(resolveBin('test', 'test-default'), ['/custom/path/test', true]);
  });

  it('treats empty / whitespace env override as unset', () => {
    process.env.SENATE_TEST_BIN = '   ';
    assert.deepEqual(resolveBin('test', 'test-default'), ['test-default', false]);
  });

  it('trims whitespace from a real override value', () => {
    process.env.SENATE_TEST_BIN = '  /usr/local/bin/test  ';
    assert.deepEqual(resolveBin('test', 'test-default'), ['/usr/local/bin/test', true]);
  });

  it('uppercases the name for the env var lookup', () => {
    process.env.SENATE_CLAUDE_BIN = '/x/claude';
    try {
      assert.deepEqual(resolveBin('claude', 'claude'), ['/x/claude', true]);
    } finally {
      delete process.env.SENATE_CLAUDE_BIN;
    }
  });
});

describe('registry contents', () => {
  it('lists exactly the three known engines', () => {
    assert.deepEqual(listEngineNames(), ['claude', 'gemini', 'vibe']);
  });

  it('default advisors are claude and gemini (vibe is execution-only, opt-in advisor)', () => {
    assert.deepEqual(getDefaultAdvisors(), ['claude', 'gemini']);
  });

  it('synthesis priority places claude first, vibe last (vibe is fallback only)', () => {
    const priority = getSynthesisPriority();
    assert.equal(priority[0], 'claude', 'claude must lead synthesis — best at structured output');
    assert.equal(priority[priority.length - 1], 'vibe', 'vibe is fallback only');
    assert.deepEqual(priority, ['claude', 'gemini', 'vibe']);
  });

  it('returns undefined for unknown engine names', () => {
    assert.equal(getEngineConfig('notreal'), undefined);
  });

  it('claude entry carries expected metadata', () => {
    const c = getEngineConfig('claude');
    assert.ok(c);
    assert.equal(c!.name, 'claude');
    assert.equal(c!.defaultBinName, 'claude');
    assert.equal(c!.inSynthesisPriority, true);
    assert.equal(c!.inDefaultAdvisors, true);
    assert.ok(c!.healthCheckTimeoutMs > 0);
    // Args include --permission-mode bypassPermissions to avoid prompts in -p mode.
    const args = c!.args('hello');
    assert.ok(args.includes('--permission-mode'));
    assert.ok(args.includes('bypassPermissions'));
  });

  it('gemini entry sets the trust-workspace env var and is a default advisor', () => {
    const g = getEngineConfig('gemini');
    assert.ok(g);
    assert.equal(g!.env?.GEMINI_CLI_TRUST_WORKSPACE, 'true');
    assert.equal(g!.inDefaultAdvisors, true, 'gemini was promoted from opt-in to default advisor');
  });

  it('vibe is NOT in default advisors (execution grunt, not advisor)', () => {
    const v = getEngineConfig('vibe');
    assert.ok(v);
    assert.equal(v!.inDefaultAdvisors, false);
    assert.equal(v!.inSynthesisPriority, true, 'vibe still eligible to lead synthesis as last-resort fallback');
  });

  // The direct-mode args assertion (--trust, --max-turns, --max-price) lives in the
  // `buildVibeEntry wrapper detection` describe at the bottom of this file — that suite
  // can isolate HOME/env to force direct mode, which is necessary because the module-load
  // vibe entry switches to wrapper mode when `~/tools/vibe-delegate` exists on the runner.

  it('vibe entry has parseUsage wired so the USAGE footer can show its tokens', () => {
    const v = getEngineConfig('vibe');
    assert.ok(v);
    assert.equal(typeof v!.parseUsage, 'function', 'vibe must expose parseUsage to surface real session-log tokens');
  });

  it('every engine has an advisorInactivityMs configured', () => {
    for (const name of listEngineNames()) {
      const e = getEngineConfig(name);
      assert.ok(e);
      assert.ok(e!.advisorInactivityMs > 0, `${name} must have a positive advisorInactivityMs`);
    }
  });

  it('claude and gemini have generous advisor timeouts (JSON output buffers full response)', () => {
    assert.ok(getEngineConfig('claude')!.advisorInactivityMs >= 60000);
    assert.ok(getEngineConfig('gemini')!.advisorInactivityMs >= 60000);
  });
});

describe('getAuthPatterns (per-engine, no cross-contamination)', () => {
  it('returns empty array for unknown engines', () => {
    assert.deepEqual(getAuthPatterns('notreal'), []);
  });

  it('gemini has its api-key pattern', () => {
    assert.ok(getAuthPatterns('gemini').includes('must specify the gemini_api_key'));
  });

  it('claude does NOT have the gemini api-key pattern (no cross-contamination)', () => {
    // This is the regression test for the bug fixed in #4: previously a global pattern list
    // could classify a claude error as 'unauthenticated' if its stderr happened to contain
    // a gemini-specific string.
    assert.ok(!getAuthPatterns('claude').includes('must specify the gemini_api_key'));
  });

  it('vibe has its setup pattern', () => {
    assert.ok(getAuthPatterns('vibe').includes('please run vibe --setup'));
  });

  it('all engines accept the generic "authentication failed" pattern', () => {
    for (const name of ['claude', 'vibe', 'gemini']) {
      assert.ok(
        getAuthPatterns(name).includes('authentication failed'),
        `${name} should match "authentication failed"`
      );
    }
  });
});

describe('buildVibeEntry wrapper detection (Option A)', () => {
  let savedEnv: string | undefined;
  let savedHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    savedEnv = process.env.SENATE_VIBE_WRAPPER;
    savedHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'senate-wrap-'));
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

  it('direct mode: bin is "vibe" and args use the -p flag-stew when no wrapper is present', () => {
    const e = buildVibeEntry();
    assert.equal(e.defaultBinName, 'vibe', 'falls back to vibe on PATH');
    const args = e.args('hello');
    assert.ok(args.includes('-p'), 'direct mode passes prompt via -p');
    assert.ok(args.includes('--trust'));
    assert.ok(args.includes('--max-turns'));
  });

  it('wrapper mode: bin is the wrapper path and args are positional (workdir, prompt, max-turns)', () => {
    const wrapper = path.join(tmpHome, 'stub-wrapper');
    fs.writeFileSync(wrapper, '#!/usr/bin/env bash\necho stub');
    fs.chmodSync(wrapper, 0o755);
    process.env.SENATE_VIBE_WRAPPER = wrapper;

    const e = buildVibeEntry();
    assert.equal(e.defaultBinName, wrapper, 'bin should be the resolved wrapper path');
    const args = e.args('a-prompt');
    assert.ok(!args.includes('-p'), 'wrapper mode must NOT pass -p — positional only');
    assert.ok(!args.includes('--trust'), 'wrapper handles --trust internally');
    assert.equal(args[1], 'a-prompt', 'second positional arg is the prompt');
    assert.equal(args.length, 3, 'wrapper expects exactly (workdir, prompt, max-turns)');
  });

  it('wrapper mode: still wires parseUsage so the USAGE footer is populated', () => {
    const wrapper = path.join(tmpHome, 'stub-wrapper');
    fs.writeFileSync(wrapper, '#!/usr/bin/env bash\necho stub');
    fs.chmodSync(wrapper, 0o755);
    process.env.SENATE_VIBE_WRAPPER = wrapper;

    const e = buildVibeEntry();
    assert.equal(typeof e.parseUsage, 'function');
  });
});
