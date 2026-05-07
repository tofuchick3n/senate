// Skill install/uninstall/status helpers.
// Extracted from cli.ts so it can be unit-tested with a tmp HOME.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export type Status = 'absent' | 'matches' | 'differs';

export function resolveBundledSkillDir(): string {
  // cli.ts/install-skill.ts live at src/* (dev) or dist/* (built). The
  // bundled skill is one level up from this module's dir in both layouts.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'skills', 'senate');
}

export function getInstalledSkillDir(home: string = os.homedir()): string {
  return path.join(home, '.claude', 'skills', 'senate');
}

function hashDir(dir: string): string {
  // Stable content hash across all files in the directory tree.
  // Stream file bytes through the hash incrementally so this stays
  // O(1) memory regardless of bundle size.
  const hash = crypto.createHash('sha256');
  const walk = (d: string, rel: string) => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const stat = fs.statSync(full);
      const relPath = path.join(rel, name);
      if (stat.isDirectory()) walk(full, relPath);
      else {
        hash.update(relPath + '\0');
        hash.update(fs.readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir, '');
  return hash.digest('hex');
}

export type InstallResult =
  | { ok: true; targetDir: string; replaced: boolean }
  | { ok: false; code: 'missing-bundle' | 'already-installed'; targetDir: string; sourceDir: string };

export function installSkill(
  options: { force?: boolean; home?: string; sourceDir?: string } = {}
): InstallResult {
  const sourceDir = options.sourceDir ?? resolveBundledSkillDir();
  const targetDir = getInstalledSkillDir(options.home);

  if (!fs.existsSync(sourceDir) || !fs.existsSync(path.join(sourceDir, 'SKILL.md'))) {
    return { ok: false, code: 'missing-bundle', targetDir, sourceDir };
  }

  const exists = fs.existsSync(targetDir);
  if (exists && !options.force) {
    return { ok: false, code: 'already-installed', targetDir, sourceDir };
  }

  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  return { ok: true, targetDir, replaced: exists };
}

export type UninstallResult = { removed: boolean; targetDir: string };

export function uninstallSkill(options: { home?: string } = {}): UninstallResult {
  const targetDir = getInstalledSkillDir(options.home);
  const existed = fs.existsSync(targetDir);
  fs.rmSync(targetDir, { recursive: true, force: true });
  return { removed: existed, targetDir };
}

export type SkillStatus = {
  status: Status;
  installedDir: string;
  bundledDir: string;
  installedHash: string | null;
  bundledHash: string | null;
};

export function skillStatus(options: { home?: string; sourceDir?: string } = {}): SkillStatus {
  const installedDir = getInstalledSkillDir(options.home);
  const bundledDir = options.sourceDir ?? resolveBundledSkillDir();
  const bundledHash = fs.existsSync(bundledDir) ? hashDir(bundledDir) : null;
  const installedHash = fs.existsSync(installedDir) ? hashDir(installedDir) : null;

  let status: Status;
  if (!installedHash) status = 'absent';
  else if (installedHash === bundledHash) status = 'matches';
  else status = 'differs';

  return { status, installedDir, bundledDir, installedHash, bundledHash };
}
