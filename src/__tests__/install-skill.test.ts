import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkill, uninstallSkill, skillStatus, getInstalledSkillDir } from '../install-skill.js';

function makeFakeBundle(root: string, body: string = '# senate skill\n'): string {
  const dir = join(root, 'bundle');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body);
  return dir;
}

describe('installSkill', () => {
  let home: string;
  let bundle: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'senate-skill-'));
    bundle = makeFakeBundle(home);
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('installs into ~/.claude/skills/senate when target is absent', () => {
    const r = installSkill({ home, sourceDir: bundle });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.replaced, false);
    assert.equal(r.targetDir, getInstalledSkillDir(home));
    assert.equal(readFileSync(join(r.targetDir, 'SKILL.md'), 'utf8'), '# senate skill\n');
  });

  it('refuses to overwrite an existing install without force', () => {
    installSkill({ home, sourceDir: bundle });
    const r = installSkill({ home, sourceDir: bundle });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, 'already-installed');
  });

  it('overwrites with --force and reports replaced=true', () => {
    installSkill({ home, sourceDir: bundle });
    const newer = makeFakeBundle(join(home, 'next'), '# v2\n');
    const r = installSkill({ home, sourceDir: newer, force: true });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.replaced, true);
    assert.equal(readFileSync(join(r.targetDir, 'SKILL.md'), 'utf8'), '# v2\n');
  });

  it('errors with missing-bundle when source has no SKILL.md', () => {
    const empty = join(home, 'empty');
    mkdirSync(empty, { recursive: true });
    const r = installSkill({ home, sourceDir: empty });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, 'missing-bundle');
  });
});

describe('uninstallSkill', () => {
  let home: string;
  let bundle: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'senate-skill-'));
    bundle = makeFakeBundle(home);
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('removes an installed skill and reports removed=true', () => {
    installSkill({ home, sourceDir: bundle });
    const r = uninstallSkill({ home });
    assert.equal(r.removed, true);
    assert.equal(existsSync(r.targetDir), false);
  });

  it('is a no-op when no skill is installed', () => {
    const r = uninstallSkill({ home });
    assert.equal(r.removed, false);
  });
});

describe('skillStatus', () => {
  let home: string;
  let bundle: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'senate-skill-'));
    bundle = makeFakeBundle(home);
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('reports absent when nothing is installed', () => {
    const s = skillStatus({ home, sourceDir: bundle });
    assert.equal(s.status, 'absent');
    assert.equal(s.installedHash, null);
    assert.notEqual(s.bundledHash, null);
  });

  it('reports matches after a fresh install', () => {
    installSkill({ home, sourceDir: bundle });
    const s = skillStatus({ home, sourceDir: bundle });
    assert.equal(s.status, 'matches');
    assert.equal(s.installedHash, s.bundledHash);
  });

  it('reports differs when the bundled skill changes after install', () => {
    installSkill({ home, sourceDir: bundle });
    const newer = makeFakeBundle(join(home, 'next'), '# upgraded\n');
    const s = skillStatus({ home, sourceDir: newer });
    assert.equal(s.status, 'differs');
    assert.notEqual(s.installedHash, s.bundledHash);
  });
});
