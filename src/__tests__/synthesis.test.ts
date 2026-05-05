import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, parseStructured, renderSynthesis } from '../synthesis.js';

describe('extractJson', () => {
  it('returns inner content of a ```json fenced block', () => {
    const text = 'Sure, here is the JSON:\n```json\n{"a":1}\n```\nDone.';
    assert.equal(extractJson(text), '{"a":1}');
  });

  it('returns inner content of an unlabelled ``` fence', () => {
    const text = '```\n{"b":2}\n```';
    assert.equal(extractJson(text), '{"b":2}');
  });

  it('falls back to first { ... last } when no fence', () => {
    const text = 'preamble {"c":3} trailing';
    assert.equal(extractJson(text), '{"c":3}');
  });

  it('returns trimmed input when no braces and no fence', () => {
    assert.equal(extractJson('  no braces here  '), 'no braces here');
  });

  it('handles nested objects when no fence is present', () => {
    const text = 'note: {"a":{"b":1},"c":2} end';
    assert.equal(extractJson(text), '{"a":{"b":1},"c":2}');
  });
});

describe('parseStructured', () => {
  it('parses a complete well-formed JSON object', () => {
    const raw = JSON.stringify({
      consensus: ['agree on x', 'agree on y'],
      disagreements: [
        { topic: 'choice of db', positions: [{ engine: 'CLAUDE', stance: 'postgres' }, { engine: 'GEMINI', stance: 'mongo' }] }
      ],
      outliers: [{ engine: 'VIBE', note: 'suggested sqlite' }],
      recommendation: 'go with postgres'
    });
    const s = parseStructured(raw);
    assert.ok(s);
    assert.equal(s!.consensus.length, 2);
    assert.equal(s!.disagreements.length, 1);
    assert.equal(s!.disagreements[0].topic, 'choice of db');
    assert.equal(s!.disagreements[0].positions.length, 2);
    assert.equal(s!.outliers.length, 1);
    assert.equal(s!.recommendation, 'go with postgres');
  });

  it('parses fenced JSON output (```json ... ```)', () => {
    const raw = '```json\n' + JSON.stringify({
      consensus: [], disagreements: [], outliers: [], recommendation: 'meh'
    }) + '\n```';
    const s = parseStructured(raw);
    assert.ok(s);
    assert.equal(s!.recommendation, 'meh');
  });

  it('returns null on completely malformed JSON', () => {
    assert.equal(parseStructured('this is not json at all'), null);
  });

  it('coerces missing fields to safe defaults', () => {
    const s = parseStructured('{"recommendation":"only this field"}');
    assert.ok(s);
    assert.deepEqual(s!.consensus, []);
    assert.deepEqual(s!.disagreements, []);
    assert.deepEqual(s!.outliers, []);
    assert.equal(s!.recommendation, 'only this field');
  });

  it('drops non-string entries from consensus[]', () => {
    const s = parseStructured('{"consensus":["ok",42,null,"also ok"]}');
    assert.ok(s);
    assert.deepEqual(s!.consensus, ['ok', 'also ok']);
  });

  it('coerces malformed disagreement positions to strings', () => {
    const raw = JSON.stringify({
      disagreements: [{ topic: null, positions: [{ engine: 1, stance: { x: 'y' } }] }]
    });
    const s = parseStructured(raw);
    assert.ok(s);
    // null coerces to '' via `?? ''`, not the literal string 'null' — keeps the renderer clean.
    assert.equal(s!.disagreements[0].topic, '');
    assert.equal(s!.disagreements[0].positions[0].engine, '1');
    // stance becomes "[object Object]" — not pretty, but at least typed-string and won't break the renderer.
    assert.equal(typeof s!.disagreements[0].positions[0].stance, 'string');
  });
});

describe('renderSynthesis', () => {
  it('renders a complete structured object into the canonical four sections', () => {
    const out = renderSynthesis({
      consensus: ['point one', 'point two'],
      disagreements: [
        { topic: 'API style', positions: [{ engine: 'CLAUDE', stance: 'REST' }, { engine: 'GEMINI', stance: 'GraphQL' }] }
      ],
      outliers: [{ engine: 'VIBE', note: 'gRPC' }],
      recommendation: 'pick REST'
    });
    assert.match(out, /## CONSENSUS/);
    assert.match(out, /## DISAGREEMENTS/);
    assert.match(out, /## OUTLIERS/);
    assert.match(out, /## RECOMMENDATION/);
    assert.match(out, /point one/);
    assert.match(out, /API style/);
    assert.match(out, /CLAUDE: REST/);
    assert.match(out, /VIBE: gRPC/);
    assert.match(out, /pick REST/);
  });

  it('renders empty sections as "None." rather than blank', () => {
    const out = renderSynthesis({
      consensus: [], disagreements: [], outliers: [], recommendation: ''
    });
    // Outliers + disagreements should both say None.
    const lines = out.split('\n');
    const disIdx = lines.findIndex(l => l === '## DISAGREEMENTS');
    const outIdx = lines.findIndex(l => l === '## OUTLIERS');
    assert.equal(lines[disIdx + 1], 'None.');
    assert.equal(lines[outIdx + 1], 'None.');
  });
});
