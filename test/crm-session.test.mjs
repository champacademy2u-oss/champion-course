import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CRM_SHARED_ROLE,
  createCrmSessionHandler,
  passwordMatches,
  rateLimitKey
} from '../lib/crm-session.js';
import { firebaseAdminAllowed, isSharedCrmAdmin, isSharedCrmIdentity, requireAdmin } from '../api/_firebase.js';

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

function request(body, overrides = {}) {
  return {
    method: 'POST',
    body,
    headers: {
      origin: 'https://champacademy2u-oss.github.io',
      'x-forwarded-for': '203.0.113.10',
      ...(overrides.headers || {})
    },
    ...overrides
  };
}

function fakeDependencies() {
  const attempts = new Map();
  const ensured = [];
  const tokens = [];
  return {
    ensured,
    tokens,
    repository: {
      async recordAttempt({ key, success, now, maxAttempts, windowMs, blockMs }) {
        const current = attempts.get(key) || { attempts: 0, windowStartedAt: now, blockedUntil: 0 };
        if (current.blockedUntil > now) return { blocked: true, retryAfterMs: current.blockedUntil - now };
        if (success) { attempts.delete(key); return { blocked: false }; }
        const withinWindow = now - current.windowStartedAt < windowMs;
        const count = withinWindow ? current.attempts + 1 : 1;
        const value = { attempts: count, windowStartedAt: withinWindow ? current.windowStartedAt : now, blockedUntil: count >= maxAttempts ? now + blockMs : 0 };
        attempts.set(key, value);
        return value.blockedUntil > now ? { blocked: true, retryAfterMs: blockMs } : { blocked: false };
      },
      async ensureSharedAdmin(uid, role) { ensured.push({ uid, role }); }
    },
    auth: {
      async createCustomToken(uid, claims) {
        tokens.push({ uid, claims });
        return 'test-custom-token';
      }
    }
  };
}

test('password comparison and rate-limit identifiers do not expose input', () => {
  assert.equal(passwordMatches('correct', 'correct'), true);
  assert.equal(passwordMatches('wrong', 'correct'), false);
  const key = rateLimitKey('203.0.113.10', 'server-secret');
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(key, /203\.0\.113\.10|server-secret/);
});

test('shared administrator claims require the exact role and dedicated UID', () => {
  const auth_time = Math.floor(Date.now() / 1000);
  const firebase = { sign_in_provider: 'custom' };
  assert.equal(isSharedCrmAdmin({ uid: 'champ-crm-shared-admin', admin: true, role: CRM_SHARED_ROLE, auth_time, firebase }), true);
  assert.equal(isSharedCrmAdmin({ uid: 'another-user', admin: true, role: CRM_SHARED_ROLE, auth_time, firebase }), false);
  assert.equal(isSharedCrmAdmin({ uid: 'champ-crm-shared-admin', admin: true, role: 'admin', auth_time, firebase }), false);
  assert.equal(isSharedCrmAdmin({ uid: 'champ-crm-shared-admin', admin: false, role: CRM_SHARED_ROLE, auth_time, firebase }), false);
  assert.equal(isSharedCrmAdmin({ uid: 'champ-crm-shared-admin', admin: true, role: CRM_SHARED_ROLE, auth_time, firebase: { sign_in_provider: 'google.com' } }), false);
  assert.equal(isSharedCrmAdmin({ uid: 'champ-crm-shared-admin', admin: true, role: CRM_SHARED_ROLE, auth_time: auth_time - (365 * 24 * 60 * 60), firebase }), true);
  assert.equal(isSharedCrmAdmin({ uid: 'champ-crm-shared-admin', admin: true, role: CRM_SHARED_ROLE, auth_time: auth_time + 301, firebase }), false);
  assert.equal(isSharedCrmIdentity({ uid: 'champ-crm-shared-admin' }), true);
  assert.equal(isSharedCrmIdentity({ uid: 'existing-google-admin' }), false);
  assert.equal(firebaseAdminAllowed({ uid: 'champ-crm-shared-admin', admin: true, role: CRM_SHARED_ROLE, auth_time, firebase }), true);
  assert.equal(firebaseAdminAllowed({ uid: 'champ-crm-shared-admin', admin: true, role: 'admin', auth_time, firebase }), false);
  assert.equal(firebaseAdminAllowed({ uid: 'existing-google-admin', admin: true }), true);
});

test('video APIs preserve only an explicitly allowlisted verified Google owner', () => {
  const previousEmails = process.env.CRM_ADMIN_EMAILS;
  process.env.CRM_ADMIN_EMAILS = 'owner@example.test';
  try {
    assert.equal(firebaseAdminAllowed({
      uid: 'owner-google-uid', email: 'OWNER@example.test', email_verified: true,
      firebase: { sign_in_provider: 'google.com' }
    }), true);
    assert.equal(firebaseAdminAllowed({
      uid: 'owner-google-uid', email: 'owner@example.test', email_verified: false,
      firebase: { sign_in_provider: 'google.com' }
    }), false);
    assert.equal(firebaseAdminAllowed({
      uid: 'anonymous-legacy-uid', email: 'owner@example.test', email_verified: true,
      firebase: { sign_in_provider: 'anonymous' }
    }), false);
  } finally {
    if (previousEmails === undefined) delete process.env.CRM_ADMIN_EMAILS;
    else process.env.CRM_ADMIN_EMAILS = previousEmails;
  }
});

test('CRM login rejects missing or unapproved origins before checking a password', async () => {
  const deps = fakeDependencies();
  const handler = createCrmSessionHandler({ secret: 'server-only-test-password', auth: deps.auth, repository: deps.repository });
  const res = response();
  await handler(request({ password: 'server-only-test-password' }, { headers: { origin: '' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(deps.tokens.length, 0);
});

test('CRM login fails closed when the server secret is missing', async () => {
  const deps = fakeDependencies();
  const handler = createCrmSessionHandler({ secret: '', auth: deps.auth, repository: deps.repository });
  const res = response();
  await handler(request({ password: 'anything' }), res);
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(res.body, /anything/);
});

test('CRM login rate-limits repeated failures and returns no token', async () => {
  const deps = fakeDependencies();
  let now = 1_700_000_000_000;
  const handler = createCrmSessionHandler({
    secret: 'server-only-test-password', auth: deps.auth, repository: deps.repository,
    clock: () => now, maxAttempts: 3, blockMs: 60_000
  });
  for (let index = 0; index < 2; index += 1) {
    const res = response();
    await handler(request({ password: 'wrong' }), res);
    assert.equal(res.statusCode, 401);
    now += 100;
  }
  const blocked = response();
  await handler(request({ password: 'wrong' }), blocked);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.header('retry-after'), '60');
  assert.equal(deps.tokens.length, 0);
});

test('valid password provisions one exact shared role and mints a custom token', async () => {
  const deps = fakeDependencies();
  const handler = createCrmSessionHandler({
    secret: 'server-only-test-password', uid: 'shared-test-uid',
    auth: deps.auth, repository: deps.repository
  });
  const res = response();
  await handler(request({ password: 'server-only-test-password' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(deps.ensured, [{ uid: 'shared-test-uid', role: CRM_SHARED_ROLE }]);
  assert.deepEqual(deps.tokens, [{ uid: 'shared-test-uid', claims: { admin: true, role: CRM_SHARED_ROLE } }]);
  assert.deepEqual(JSON.parse(res.body), { customToken: 'test-custom-token', expiresIn: 3600 });
  assert.equal(res.header('cache-control'), 'no-store, max-age=0');
});

test('deployment sources contain no real shared password or client-side password constant', async () => {
  const files = ['../api/crm-session.js', '../lib/crm-session.js', '../.env.vercel.example'];
  const source = (await Promise.all(files.map(file => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /CRM_SHARED_LOGIN_PASSWORD\s*=\s*(?!replace-in-vercel-only)/);
  assert.doesNotMatch(source, /password\s*:\s*["'][^"']+["']/i);
});

test('Vercel routes the CRM session through an existing function within the Hobby limit', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const functions = config.builds.filter(build => build.use === '@vercel/node');
  assert.ok(functions.length <= 12, `expected at most 12 serverless functions, found ${functions.length}`);
  assert.ok(!functions.some(build => build.src === 'api/crm-session.js'));
  assert.deepEqual(config.routes[0], {
    src: '/api/crm-session',
    dest: '/api/admin-token.js?mode=crm-session'
  });
  const adminTokenSource = await readFile(new URL('../api/admin-token.js', import.meta.url), 'utf8');
  assert.match(adminTokenSource, /mode \|\| ''\) === 'crm-session'/);
  assert.match(adminTokenSource, /return crmSessionHandler\(req, res\)/);
});

test('Firestore rules reject ordinary authenticated users and keep login metadata server-only', async () => {
  const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /function isCrmAdmin\(\)/);
  assert.match(rules, /crm_admins\/\$\(request\.auth\.uid\)/);
  assert.match(rules, /request\.auth\.token\.admin == true/);
  assert.match(rules, /request\.auth\.token\.role == 'crm_shared_admin'/);
  assert.match(rules, /request\.auth\.token\.firebase\.sign_in_provider == 'custom'/);
  assert.doesNotMatch(rules, /request\.time\.toMillis\(\) \/ 1000 - request\.auth\.token\.auth_time <= 43200/);
  assert.match(rules, /request\.auth\.token\.auth_time - request\.time\.toMillis\(\) \/ 1000 <= 300/);
  assert.match(rules, /match \/crm_admins\/\{document\} \{ allow read, write: if false; \}/);
  assert.match(rules, /match \/crm_login_rate_limits\/\{document\} \{ allow read, write: if false; \}/);
  assert.doesNotMatch(rules, /function signedIn\(\)/);
});

test('public Ebook leads are create-only and strictly validated', async () => {
  const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /function isValidPublicLandingLead\(document\)/);
  assert.match(rules, /sign_in_provider == 'anonymous'/);
  assert.match(rules, /data\.keys\(\)\.hasOnly/);
  assert.match(rules, /document == data\.id/);
  assert.match(rules, /data\.phone\.matches\('\^\\\\\+\[0-9\]\{7,15\}\$'\)/);
  assert.match(rules, /allow read, update, delete: if isCrmAdmin\(\);/);
  assert.match(rules, /allow create: if isCrmAdmin\(\) \|\| isValidPublicLandingLead\(document\);/);
  assert.doesNotMatch(rules, /match \/landing_leads\/\{document\} \{ allow read, write: if request\.auth/);
});

test('legacy admin endpoints cannot be made public and have no default password', async () => {
  const firebaseSource = await readFile(new URL('../api/_firebase.js', import.meta.url), 'utf8');
  const adminTokenSource = await readFile(new URL('../api/admin-token.js', import.meta.url), 'utf8');
  const adminTokenCore = await readFile(new URL('../lib/admin-token.js', import.meta.url), 'utf8');
  assert.doesNotMatch(firebaseSource, /public-admin|ADMIN_LOGIN_DISABLED\s*\|\|/);
  assert.doesNotMatch(adminTokenSource, /admin123/);
  assert.match(adminTokenCore, /passwordMatches\(/);
  assert.match(adminTokenCore, /send\(res, 503/);
  const previous = process.env.ADMIN_LOGIN_DISABLED;
  process.env.ADMIN_LOGIN_DISABLED = 'true';
  try {
    await assert.rejects(requireAdmin({ headers: {} }), /未授权/);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_LOGIN_DISABLED;
    else process.env.ADMIN_LOGIN_DISABLED = previous;
  }
});

test('Firebase Storage applies the same exact shared role without an artificial read-age cutoff', async () => {
  const rules = await readFile(new URL('../firebase-rules/storage.rules', import.meta.url), 'utf8');
  assert.match(rules, /request\.auth\.uid != 'champ-crm-shared-admin'/);
  assert.match(rules, /request\.auth\.token\.role == 'crm_shared_admin'/);
  assert.match(rules, /request\.auth\.token\.firebase\.sign_in_provider == 'custom'/);
  assert.doesNotMatch(rules, /request\.time\.toMillis\(\) \/ 1000 - request\.auth\.token\.auth_time <= 43200/);
  assert.match(rules, /request\.auth\.token\.auth_time - request\.time\.toMillis\(\) \/ 1000 <= 300/);
});

test('every protected CRM API uses the unified shared-admin authorization path', async () => {
  const directSharedAuthFiles = [
    '../lib/email-campaign-api.js',
    '../lib/zoom-api.js',
    '../api/champ-library.js',
    '../api/customer-receipts.js'
  ];
  for (const file of directSharedAuthFiles) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /isSharedCrmAdmin\(decoded\)/, `${file} must accept only the exact shared role`);
    assert.match(source, /isSharedCrmIdentity\(decoded\)/, `${file} must reject downgraded shared claims`);
    assert.match(source, /verifyIdToken\(token, true\)/, `${file} must verify revocation`);
  }

  const requireAdminFiles = [
    '../api/admin-data.js',
    '../api/settings.js',
    '../api/upload-url.js',
    '../api/videos.js'
  ];
  for (const file of requireAdminFiles) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /requireAdmin\(req\)/, `${file} must use the unified Firebase admin verifier`);
  }
});
