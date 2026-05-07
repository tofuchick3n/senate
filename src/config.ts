/**
 * User config at ~/.senate/config.json (also accepts ~/.senate/config without extension).
 *
 * Currently a single field:
 *   { "advisors": ["claude", "gemini", "vibe"] }
 *
 * Used as the default for `-a/--advisors` when the user doesn't pass it on the CLI.
 * Falls back to the registry's default-advisors list if no config is present or it
 * doesn't define `advisors`. IO/parse failures are silent (best-effort) so a corrupt
 * config can never block a run — caller just gets undefined.
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type SenateConfig = {
  advisors?: string[];
};

export function configPath(home: string = homedir()): string {
  return join(home, '.senate', 'config.json');
}

/** Reads ~/.senate/config.json (preferred) or ~/.senate/config (fallback). Returns {} on any failure. */
export function loadConfig(home: string = homedir()): SenateConfig {
  const candidates = [configPath(home), join(home, '.senate', 'config')];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw);
      return sanitize(parsed);
    } catch {
      // Corrupt config — silently ignore. The caller falls back to defaults.
      return {};
    }
  }
  return {};
}

function sanitize(parsed: unknown): SenateConfig {
  if (!parsed || typeof parsed !== 'object') return {};
  const out: SenateConfig = {};
  const advisors = (parsed as any).advisors;
  if (Array.isArray(advisors)) {
    const cleaned = advisors
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
    if (cleaned.length > 0) out.advisors = cleaned;
  }
  return out;
}
