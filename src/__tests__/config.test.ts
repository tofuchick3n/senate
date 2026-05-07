import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.js';

function withTempHome(fn: (home: string) => void) {
  const home = mkdtempSync(join(tmpdir(), 'senate-config-'));
  try {
    mkdirSync(join(home, '.senate'), { recursive: true });
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('loadConfig: returns empty when no file exists', () => {
  withTempHome((home) => {
    const cfg = loadConfig(home);
    assert.deepEqual(cfg, {});
  });
});

test('loadConfig: reads advisors from ~/.senate/config.json', () => {
  withTempHome((home) => {
    writeFileSync(join(home, '.senate', 'config.json'), JSON.stringify({ advisors: ['claude', 'vibe'] }));
    const cfg = loadConfig(home);
    assert.deepEqual(cfg.advisors, ['claude', 'vibe']);
  });
});

test('loadConfig: falls back to ~/.senate/config (no extension)', () => {
  withTempHome((home) => {
    writeFileSync(join(home, '.senate', 'config'), JSON.stringify({ advisors: ['gemini'] }));
    const cfg = loadConfig(home);
    assert.deepEqual(cfg.advisors, ['gemini']);
  });
});

test('loadConfig: prefers config.json over extension-less config', () => {
  withTempHome((home) => {
    writeFileSync(join(home, '.senate', 'config.json'), JSON.stringify({ advisors: ['claude'] }));
    writeFileSync(join(home, '.senate', 'config'), JSON.stringify({ advisors: ['vibe'] }));
    const cfg = loadConfig(home);
    assert.deepEqual(cfg.advisors, ['claude']);
  });
});

test('loadConfig: corrupt JSON returns empty (best-effort)', () => {
  withTempHome((home) => {
    writeFileSync(join(home, '.senate', 'config.json'), '{ this is not json');
    const cfg = loadConfig(home);
    assert.deepEqual(cfg, {});
  });
});

test('loadConfig: trims and drops empty/non-string entries', () => {
  withTempHome((home) => {
    writeFileSync(join(home, '.senate', 'config.json'), JSON.stringify({ advisors: ['  claude ', '', 7, 'vibe'] }));
    const cfg = loadConfig(home);
    assert.deepEqual(cfg.advisors, ['claude', 'vibe']);
  });
});

test('loadConfig: empty advisors array is dropped (not surfaced as [])', () => {
  withTempHome((home) => {
    writeFileSync(join(home, '.senate', 'config.json'), JSON.stringify({ advisors: [] }));
    const cfg = loadConfig(home);
    assert.equal(cfg.advisors, undefined);
  });
});
