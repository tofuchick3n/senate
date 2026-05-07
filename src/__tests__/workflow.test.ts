import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasAnyResult, formatWorkflowResult, type WorkflowResult } from '../workflow.js';
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
