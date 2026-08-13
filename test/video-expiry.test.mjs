import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeExpiresAt } from '../api/_firebase.js';

test('empty expiry means the video never expires', () => {
  assert.equal(normalizeExpiresAt(''), '');
  assert.equal(normalizeExpiresAt(null), '');
});

test('Malaysia datetime-local values are stored as unambiguous ISO timestamps', () => {
  assert.equal(normalizeExpiresAt('2026-08-28T20:30'), '2026-08-28T12:30:00.000Z');
});

test('existing ISO timestamps remain the same moment', () => {
  assert.equal(normalizeExpiresAt('2026-08-28T12:30:00.000Z'), '2026-08-28T12:30:00.000Z');
});

test('invalid expiry values are rejected', () => {
  assert.throws(() => normalizeExpiresAt('not-a-date'), /观看期限格式不正确/);
});
