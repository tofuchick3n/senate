import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeJson, parseGeminiJson } from '../registry.js';

describe('parseClaudeJson', () => {
  it('extracts text and usage from a complete claude JSON response', () => {
    const stdout = JSON.stringify({
      type: 'result',
      result: 'Four',
      usage: { input_tokens: 6, output_tokens: 8 },
      total_cost_usd: 0.1226665
    });
    const r = parseClaudeJson(stdout);
    assert.equal(r.text, 'Four');
    assert.ok(r.usage);
    assert.equal(r.usage!.inputTokens, 6);
    assert.equal(r.usage!.outputTokens, 8);
    assert.equal(r.usage!.totalTokens, 14);
    assert.equal(r.usage!.costUsd, 0.1226665);
  });

  it('falls back to raw stdout when JSON has no result field', () => {
    const r = parseClaudeJson('{"type":"foo"}');
    assert.equal(r.text, '{"type":"foo"}');
    assert.equal(r.usage, undefined);
  });

  it('returns text without usage when usage block is missing', () => {
    const r = parseClaudeJson('{"result":"hi"}');
    assert.equal(r.text, 'hi');
    assert.equal(r.usage, undefined);
  });

  it('handles malformed JSON gracefully', () => {
    const r = parseClaudeJson('not json at all');
    assert.equal(r.text, 'not json at all');
    assert.equal(r.usage, undefined);
  });

  it('skips usage fields that are not numbers', () => {
    const r = parseClaudeJson('{"result":"x","usage":{"input_tokens":"oops"},"total_cost_usd":"nope"}');
    assert.equal(r.text, 'x');
    assert.ok(r.usage);
    assert.equal(r.usage!.inputTokens, undefined);
    assert.equal(r.usage!.costUsd, undefined);
  });
});

describe('parseGeminiJson', () => {
  it('extracts response text and summed token stats', () => {
    const stdout = JSON.stringify({
      response: 'Four.',
      stats: {
        models: {
          'gemini-2.5-flash-lite': {
            tokens: { input: 990, candidates: 32, total: 1147 }
          }
        }
      }
    });
    const r = parseGeminiJson(stdout);
    assert.equal(r.text, 'Four.');
    assert.ok(r.usage);
    assert.equal(r.usage!.inputTokens, 990);
    assert.equal(r.usage!.outputTokens, 32);
    assert.equal(r.usage!.totalTokens, 1147);
  });

  it('strips leading non-JSON noise (skill conflict warnings, etc.)', () => {
    const stdout = 'Skill conflict detected: foo\nRipgrep is not available.\n' + JSON.stringify({
      response: 'hi',
      stats: { models: { m1: { tokens: { input: 10, candidates: 5, total: 15 } } } }
    });
    const r = parseGeminiJson(stdout);
    assert.equal(r.text, 'hi');
    assert.equal(r.usage!.totalTokens, 15);
  });

  it('sums tokens across multiple models when they all reported', () => {
    const stdout = JSON.stringify({
      response: 'x',
      stats: {
        models: {
          a: { tokens: { input: 10, candidates: 2, total: 12 } },
          b: { tokens: { input: 5, candidates: 3, total: 8 } }
        }
      }
    });
    const r = parseGeminiJson(stdout);
    assert.equal(r.usage!.inputTokens, 15);
    assert.equal(r.usage!.outputTokens, 5);
    assert.equal(r.usage!.totalTokens, 20);
  });

  it('returns text without usage when stats block is missing', () => {
    const r = parseGeminiJson('{"response":"hi"}');
    assert.equal(r.text, 'hi');
    assert.equal(r.usage, undefined);
  });

  it('handles malformed JSON gracefully', () => {
    const r = parseGeminiJson('not json');
    assert.equal(r.text, 'not json');
    assert.equal(r.usage, undefined);
  });
});
