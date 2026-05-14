import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeJson, parseGeminiJson, parseCodexJsonl } from '../registry.js';

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

describe('parseCodexJsonl', () => {
  // Real NDJSON captured 2026-05-14 from `codex exec "say hello in one word" --json </dev/null`.
  const realStream = [
    'Reading additional input from stdin...',
    JSON.stringify({ type: 'thread.started', thread_id: '019e26dd-9f71-7c33-a2b5-56d03d27f7f2' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'Hello' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 14814, cached_input_tokens: 12160, output_tokens: 5, reasoning_output_tokens: 0 } })
  ].join('\n');

  it('extracts final agent_message text and rolls reasoning into output tokens', () => {
    const r = parseCodexJsonl(realStream);
    assert.equal(r.text, 'Hello');
    assert.ok(r.usage);
    assert.equal(r.usage!.inputTokens, 14814);
    // outputTokens is output_tokens + reasoning_output_tokens (0 here).
    assert.equal(r.usage!.outputTokens, 5);
    assert.equal(r.usage!.totalTokens, 14819);
  });

  it('takes the last agent_message when the turn emits several', () => {
    const stream = [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'first' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'second' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'third (final)' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20 } })
    ].join('\n');
    const r = parseCodexJsonl(stream);
    assert.equal(r.text, 'third (final)');
  });

  it('counts reasoning_output_tokens into outputTokens (billed the same)', () => {
    const stream = [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 50, output_tokens: 10, reasoning_output_tokens: 40 } })
    ].join('\n');
    const r = parseCodexJsonl(stream);
    assert.equal(r.usage!.outputTokens, 50);   // 10 + 40
    assert.equal(r.usage!.totalTokens, 100);   // 50 + 50
  });

  it('strips the harmless "Reading additional input from stdin..." preamble in the fallback', () => {
    // No agent_message → fallback path. Without stripping, the harmless preamble
    // would leak into the synthesis prompt.
    const r = parseCodexJsonl('Reading additional input from stdin...\nReading additional input from stdin...');
    assert.equal(r.text, '');
  });

  it('skips lines that fail to parse as JSON without throwing', () => {
    const stream = [
      'random non-json garbage',
      '{ malformed',
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'survived' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })
    ].join('\n');
    const r = parseCodexJsonl(stream);
    assert.equal(r.text, 'survived');
    assert.ok(r.usage);
  });

  it('returns text without usage when no turn.completed event arrived (truncated stream)', () => {
    const stream = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'partial' } });
    const r = parseCodexJsonl(stream);
    assert.equal(r.text, 'partial');
    assert.equal(r.usage, undefined);
  });

  it('leaves totals undefined (not 0) when usage components are missing', () => {
    // turn.completed with empty usage — sawUsage=true but no numeric fields.
    // Reporting 0 would be misleading in the USAGE footer.
    const stream = [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }),
      JSON.stringify({ type: 'turn.completed', usage: {} })
    ].join('\n');
    const r = parseCodexJsonl(stream);
    assert.ok(r.usage);
    assert.equal(r.usage!.inputTokens, undefined);
    assert.equal(r.usage!.outputTokens, undefined);
    assert.equal(r.usage!.totalTokens, undefined);
  });

  it('reports outputTokens but not totalTokens when only output side is known', () => {
    // input_tokens missing, output_tokens present → we can sum the output side
    // but cannot give a meaningful grand total.
    const stream = [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }),
      JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 7, reasoning_output_tokens: 3 } })
    ].join('\n');
    const r = parseCodexJsonl(stream);
    assert.equal(r.usage!.inputTokens, undefined);
    assert.equal(r.usage!.outputTokens, 10);
    assert.equal(r.usage!.totalTokens, undefined);  // unknown without inputTokens
  });
});
