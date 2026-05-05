import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnrichedPrompt, type Turn } from '../repl.js';
import type { WorkflowResult } from '../workflow.js';

function turnWith(prompt: string, opts: {
  recommendation?: string;
  synthesisOutput?: string;
  advisors?: { name: string; output: string }[];
} = {}): Turn {
  const result: WorkflowResult = {
    decision: { consultAdvisors: true, advisors: ['claude'], executeWithVibe: false, explanation: 't' },
    advisorResults: (opts.advisors ?? []).map(a => ({
      name: a.name, status: 'ok' as const, output: a.output, durationMs: 100
    })),
    synthesis: opts.synthesisOutput || opts.recommendation
      ? {
          engine: 'claude',
          output: opts.synthesisOutput ?? '',
          structured: opts.recommendation
            ? { consensus: [], disagreements: [], outliers: [], recommendation: opts.recommendation }
            : null,
          durationMs: 100
        }
      : null,
    executionResult: null,
    totalDurationMs: 200,
    cancelled: false
  };
  return { prompt, result };
}

describe('buildEnrichedPrompt', () => {
  it('returns the new prompt unchanged when there are no prior turns', () => {
    assert.equal(buildEnrichedPrompt([], 'hello'), 'hello');
  });

  it('uses synthesis recommendation when available (compact, signal-rich)', () => {
    const turns = [turnWith('what is REST?', { recommendation: 'REST is an architectural style.' })];
    const out = buildEnrichedPrompt(turns, 'and GraphQL?');
    assert.match(out, /TURN 1/);
    assert.match(out, /USER: what is REST\?/);
    assert.match(out, /SENATE_RECOMMENDATION: REST is an architectural style\./);
    assert.match(out, /NEW QUESTION/);
    assert.ok(out.endsWith('and GraphQL?'));
  });

  it('falls back to synthesis prose when no structured recommendation', () => {
    const turns = [turnWith('q', { synthesisOutput: '## CONSENSUS\nfoo' })];
    const out = buildEnrichedPrompt(turns, 'next');
    assert.match(out, /SENATE_SYNTHESIS:/);
    assert.match(out, /## CONSENSUS\nfoo/);
  });

  it('falls back to raw advisor outputs when no synthesis at all', () => {
    const turns = [turnWith('q', {
      advisors: [{ name: 'claude', output: 'cl-answer' }, { name: 'vibe', output: 'vi-answer' }]
    })];
    const out = buildEnrichedPrompt(turns, 'next');
    assert.match(out, /CLAUDE: cl-answer/);
    assert.match(out, /VIBE: vi-answer/);
    assert.doesNotMatch(out, /SENATE_RECOMMENDATION/);
    assert.doesNotMatch(out, /SENATE_SYNTHESIS/);
  });

  it('includes all prior turns in chronological order', () => {
    const turns = [
      turnWith('q1', { recommendation: 'a1' }),
      turnWith('q2', { recommendation: 'a2' }),
      turnWith('q3', { recommendation: 'a3' })
    ];
    const out = buildEnrichedPrompt(turns, 'q4');
    const idx1 = out.indexOf('q1');
    const idx2 = out.indexOf('q2');
    const idx3 = out.indexOf('q3');
    const idx4 = out.indexOf('q4');
    assert.ok(idx1 < idx2 && idx2 < idx3 && idx3 < idx4, 'turns must appear in order');
    assert.match(out, /TURN 3/);
  });
});
