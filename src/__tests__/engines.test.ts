import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickErrorLine } from '../engines.js';

describe('pickErrorLine', () => {
  it('canonicalises HTTP 429 quota errors (the actual gemini failure mode 2026-05-14)', () => {
    const realGeminiStderr = `Ripgrep is not available. Falling back to GrepTool.
Skill conflict detected: "firecrawl" from "/Users/pasare/.agents/skills/firecrawl/SKILL.md" is overriding the same skill from "/Users/pasare/.gemini/skills/firecrawl/SKILL.md".
Attempt 1 failed with status 429. Retrying with backoff... _ApiError: {"error":{"message":"{\\n  \\"error\\": {\\n    \\"code\\": 429,\\n    \\"message\\": \\"Your project has exceeded its monthly spending cap.\\",\\n    \\"status\\": \\"RESOURCE_EXHAUSTED\\"\\n  }\\n}\\n","code":429,"status":"Too Many Requests"}}
  status: 429
}`;
    const picked = pickErrorLine(realGeminiStderr);
    // Must mention 429 / quota — NOT the misleading "Ripgrep is not available" first line.
    assert.match(picked, /429|quota|rate/i);
    assert.doesNotMatch(picked, /^Ripgrep is not available/);
  });

  it('skips non-fatal warning prefixes and prefers the last meaningful line', () => {
    const out = `Ripgrep is not available. Falling back to GrepTool.
Skill conflict detected: foo overriding bar.
The model timed out after 240s of inactivity.`;
    assert.equal(
      pickErrorLine(out),
      'The model timed out after 240s of inactivity.'
    );
  });

  it('falls back to first non-empty line when everything looks like a warning', () => {
    const out = `Ripgrep is not available.\nWarning: nothing else.`;
    // Both lines match a warning prefix; we should still surface something
    // rather than 'Unknown error'.
    const picked = pickErrorLine(out);
    assert.ok(picked.length > 0);
    assert.notEqual(picked, 'Unknown error');
  });

  it('skips bare punctuation lines (e.g. JSON stack-trace tails)', () => {
    const out = `Error: connection refused\n  at fetch (node:internal)\n}\n}}`;
    // Stack frames + closing braces are noise; the human-readable error wins.
    const picked = pickErrorLine(out);
    assert.match(picked, /connection refused/);
  });

  it('truncates very long error lines so they stay readable in the dashboard', () => {
    const long = 'Error: ' + 'x'.repeat(500);
    const picked = pickErrorLine(long);
    assert.ok(picked.length <= 240, `picked length ${picked.length} should be <=240`);
    assert.match(picked, /\.\.\.$/);
  });

  it('returns Unknown error on empty input', () => {
    assert.equal(pickErrorLine(''), 'Unknown error');
    assert.equal(pickErrorLine('\n\n  \n'), 'Unknown error');
  });
});
