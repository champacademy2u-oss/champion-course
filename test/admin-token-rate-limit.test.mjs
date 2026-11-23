import assert from 'node:assert/strict';
import test from 'node:test';
import { createLegacyAdminTokenHandler } from '../lib/admin-token.js';

function response() {
  const headers = new Map();
  return {
    statusCode: 0,
    body: '',
    setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
    end(value = '') { this.body = String(value); },
    header(name) { return headers.get(String(name).toLowerCase()); }
  };
}

function request(password, method = 'POST', ip = '203.0.113.90') {
  return {
    method,
    headers: {
      'x-forwarded-for': ip
    },
    body: { password }
  };
}

function dependencies() {
  const attempts = new Map();
  const keys = [];
  return {
    keys,
    repository: {
      async recordAttempt({ key, success, now, maxAttempts, windowMs, blockMs }) {
        keys.push(key);
        const current = attempts.get(key) || {
          attempts: 0,
          windowStartedAt: now,
          blockedUntil: 0
        };
        if (current.blockedUntil > now) {
          return { blocked: true, retryAfterMs: current.blockedUntil - now };
        }
        if (success) {
          attempts.delete(key);
          return { blocked: false };
        }
        const withinWindow = now - current.windowStartedAt < windowMs;
        const count = withinWindow ? current.attempts + 1 : 1;
        const next = {
          attempts: count,
          windowStartedAt: withinWindow ? current.windowStartedAt : now,
          blockedUntil: count >= maxAttempts ? now + blockMs : 0
        };
        attempts.set(key, next);
        return next.blockedUntil > now
          ? { blocked: true, retryAfterMs: blockMs }
          : { blocked: false };
      }
    },
    readInput: async req => req.body
  };
}

test('legacy admin login fails closed without a configured server password', async () => {
  const deps = dependencies();
  const handler = createLegacyAdminTokenHandler({
    secret: '',
    repository: deps.repository,
    createSession: () => 'session',
    readInput: deps.readInput
  });
  const res = response();
  await handler(request('anything'), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.header('cache-control'), 'no-store, max-age=0');
  assert.doesNotMatch(res.body, /anything|session/);
});

test('legacy admin failures are limited with a non-reversible IP key', async () => {
  const deps = dependencies();
  let now = 1_800_000_000_000;
  const handler = createLegacyAdminTokenHandler({
    secret: 'server-only-test-secret',
    repository: deps.repository,
    createSession: () => 'session',
    readInput: deps.readInput,
    clock: () => now,
    maxAttempts: 3,
    blockMs: 60_000
  });

  for (let index = 0; index < 2; index += 1) {
    const res = response();
    await handler(request('wrong'), res);
    assert.equal(res.statusCode, 401);
    now += 100;
  }
  const blocked = response();
  await handler(request('wrong'), blocked);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.header('retry-after'), '60');
  assert.match(deps.keys[0], /^[a-f0-9]{64}$/);
  assert.doesNotMatch(deps.keys[0], /203\.0\.113\.90|server-only-test-secret/);

  const otherIp = response();
  await handler(request('wrong', 'POST', '203.0.113.91'), otherIp);
  assert.equal(otherIp.statusCode, 401);
  assert.notEqual(deps.keys.at(-1), deps.keys[0]);
});

test('a valid legacy admin login clears failures and returns a no-store session', async () => {
  const deps = dependencies();
  const handler = createLegacyAdminTokenHandler({
    secret: 'server-only-test-secret',
    repository: deps.repository,
    createSession: () => 'test-admin-session',
    readInput: deps.readInput
  });

  const failed = response();
  await handler(request('wrong'), failed);
  assert.equal(failed.statusCode, 401);

  const success = response();
  await handler(request('server-only-test-secret'), success);
  assert.equal(success.statusCode, 200);
  assert.deepEqual(JSON.parse(success.body), { token: 'test-admin-session' });
  assert.equal(success.header('cache-control'), 'no-store, max-age=0');

  const nextFailure = response();
  await handler(request('wrong'), nextFailure);
  assert.equal(nextFailure.statusCode, 401);
});

test('legacy admin login rejects oversized input and unsupported methods', async () => {
  const deps = dependencies();
  const handler = createLegacyAdminTokenHandler({
    secret: 'server-only-test-secret',
    repository: deps.repository,
    createSession: () => 'session',
    readInput: deps.readInput
  });

  const oversized = response();
  await handler(request('x'.repeat(257)), oversized);
  assert.equal(oversized.statusCode, 401);
  assert.equal(deps.keys.length, 0);

  const method = response();
  await handler(request('', 'GET'), method);
  assert.equal(method.statusCode, 405);
});
