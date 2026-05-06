import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Read package.json at runtime so cli.ts's `.version()` and the banner
 * stay in lockstep with it. Lazy + cached.
 */
let cached: string | null = null;
export function getVersion(): string {
  if (cached !== null) return cached;
  let resolved = 'unknown';
  try {
    // dist/version.js → ../package.json. src/version.ts → ../package.json (when run via tsx).
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    if (typeof pkg.version === 'string') resolved = pkg.version;
  } catch {
    // fall through to 'unknown'
  }
  cached = resolved;
  return cached;
}
