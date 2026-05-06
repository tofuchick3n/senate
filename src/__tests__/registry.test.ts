import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveBin,
  getEngineConfig,
  getDefaultAdvisors,
  getSynthesisPriority,
  getAuthPatterns,
  listEngineNames
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
