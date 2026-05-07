import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseDuration } from '../duration.js';

test('parseDuration: bare integer is treated as seconds (legacy contract)', () => {
  assert.equal(parseDuration('600'), 600_000);
  assert.equal(parseDuration(600), 600_000);
});

test('parseDuration: seconds suffix', () => {
  assert.equal(parseDuration('600s'), 600_000);
  assert.equal(parseDuration('1S'), 1000);
});

test('parseDuration: minutes suffix', () => {
  assert.equal(parseDuration('10m'), 600_000);
  assert.equal(parseDuration('1m'), 60_000);
});

test('parseDuration: hours suffix', () => {
  assert.equal(parseDuration('1h'), 3_600_000);
});

test('parseDuration: ms suffix is preferred over s', () => {
  assert.equal(parseDuration('1500ms'), 1500);
  // Sanity: parser must not match the trailing "s" of "ms" as the seconds unit.
  assert.notEqual(parseDuration('1500ms'), 1500 * 1000);
});

test('parseDuration: rejects malformed and non-positive values', () => {
  assert.equal(parseDuration(''), undefined);
  assert.equal(parseDuration('abc'), undefined);
  assert.equal(parseDuration('0'), undefined);
  assert.equal(parseDuration('-5s'), undefined);
  assert.equal(parseDuration('5x'), undefined);
  assert.equal(parseDuration(undefined), undefined);
});
