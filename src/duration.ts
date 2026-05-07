/**
 * Parses a duration string into milliseconds. Accepts:
 *   - "600"      → 600000 ms (bare integer = seconds, backwards compatible with the
 *                  pre-suffix --timeout contract)
 *   - "600s"     → 600000 ms
 *   - "10m"      → 600000 ms
 *   - "1h"       → 3600000 ms
 *   - "1500ms"   → 1500 ms
 *
 * Returns undefined for malformed input or non-positive values, so the caller can
 * fall back to engine defaults rather than silently using 0.
 */
export function parseDuration(input: string | number | undefined): number | undefined {
  if (input == null) return undefined;
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 ? input * 1000 : undefined;
  }
  const s = String(input).trim().toLowerCase();
  if (!s) return undefined;

  // Order matters: 'ms' must be checked before 's'.
  const units: [string, number][] = [
    ['ms', 1],
    ['s', 1000],
    ['m', 60_000],
    ['h', 3_600_000]
  ];
  for (const [suffix, mult] of units) {
    if (s.endsWith(suffix)) {
      const n = Number(s.slice(0, -suffix.length));
      if (!Number.isFinite(n) || n <= 0) return undefined;
      return n * mult;
    }
  }
  // Bare integer → seconds (legacy contract).
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n * 1000;
}
