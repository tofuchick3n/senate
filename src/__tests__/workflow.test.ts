import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasAnyResult, sumCostUsd, formatWorkflowResult, type WorkflowResult } from '../workflow.js';
import type { EngineResult } from '../engines.js';

const makeAdvisor = (name: string, status: EngineResult['status'], output = ''): EngineResult => ({
  name,
  status,
  output,
  durationMs: 1
});

const baseResult: WorkflowResult = {
  decision: { consultAdvisors: true, advisors: ['claude', 'gemini'], executeWithVibe: false, explanation: 'test' },
  advisorResults: [],
  synthesis: null,
  executionResult: null,
  totalDurationMs: 0,
  cancelled: false
};

describe('hasAnyResult', () => {
  it('returns false when every advisor failed and there is no execution', () => {
    const result: WorkflowResult = {
      ...baseResult,
      advisorResults: [makeAdvisor('claude', 'error'), makeAdvisor('gemini', 'unauthenticated')]
    };
    assert.equal(hasAnyResult(result), false);
  });

  it('returns true when at least one advisor succeeded', () => {
    const result: WorkflowResult = {
      ...baseResult,
      advisorResults: [makeAdvisor('claude', 'error'), makeAdvisor('gemini', 'ok', '42')]
    };
    assert.equal(hasAnyResult(result), true);
  });

  it('returns true on a successful execution even if all advisors failed', () => {
    const result: WorkflowResult = {
      ...baseResult,
      advisorResults: [makeAdvisor('claude', 'error')],
      executionResult: makeAdvisor('vibe', 'ok', 'done')
    };
    assert.equal(hasAnyResult(result), true);
  });

  it('returns false when execution itself errored', () => {
    const result: WorkflowResult = {
      ...baseResult,
      executionResult: makeAdvisor('vibe', 'error')
    };
    assert.equal(hasAnyResult(result), false);
  });
});

describe('sumCostUsd', () => {
  const withCost = (name: string, costUsd: number): EngineResult => ({
    name, status: 'ok', output: '', durationMs: 1, usage: { costUsd }
  });

  it('returns null when no engine reported cost', () => {
    const result: WorkflowResult = {
      ...baseResult,
      advisorResults: [makeAdvisor('claude', 'ok'), makeAdvisor('gemini', 'ok')]
    };
    assert.equal(sumCostUsd(result), null);
  });

  it('sums advisor costs', () => {
    const result: WorkflowResult = {
      ...baseResult,
      advisorResults: [withCost('claude', 0.1234), withCost('gemini', 0.0050)]
    };
    const total = sumCostUsd(result);
    assert.ok(total !== null && Math.abs(total - 0.1284) < 1e-9, `expected ~0.1284, got ${total}`);
  });

  it('includes execution cost', () => {
    const result: WorkflowResult = {
      ...baseResult,
      advisorResults: [withCost('claude', 0.10)],
      executionResult: withCost('vibe', 0.05)
    };
    const total = sumCostUsd(result);
    assert.ok(total !== null && Math.abs(total - 0.15) < 1e-9, `expected ~0.15, got ${total}`);
  });

  it('skips engines with no cost but returns total of those that have it', () => {
    const result: WorkflowResult = {
      ...baseResult,
      advisorResults: [withCost('claude', 0.20), makeAdvisor('gemini', 'ok')]
    };
    assert.equal(sumCostUsd(result), 0.20);
  });
});

describe('formatWorkflowResult empty-result message', () => {
  it('points users at --check-engines when nothing came back', () => {
    const result: WorkflowResult = {
      ...baseResult,
      advisorResults: [makeAdvisor('claude', 'error'), makeAdvisor('gemini', 'unauthenticated')]
    };
    const out = formatWorkflowResult(result);
    assert.match(out, /No results/);
    assert.match(out, /senate --check-engines/);
    assert.match(out, /tried: claude, gemini/);
  });

  it('does not show the empty-result message when an advisor succeeded', () => {
    const result: WorkflowResult = {
      ...baseResult,
      advisorResults: [makeAdvisor('claude', 'ok', 'hello')]
    };
    const out = formatWorkflowResult(result);
    assert.doesNotMatch(out, /No results/);
  });
});
