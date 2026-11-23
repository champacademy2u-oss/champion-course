import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('CRM business scripts load only after the authentication gate', async () => {
  const [html, auth] = await Promise.all([read('index.html'), read('crm-auth.js')]);

  assert.match(html, /<body class="crm-auth-pending">/);
  assert.match(html, /id="crmAuthGate"/);
  assert.match(html, /id="crmAuthPassword"[^>]*type="password"/);
  assert.match(html, /window\.CRM_APP_SCRIPTS/);
  assert.doesNotMatch(html, /<script src="\.\/app\.js/);
  assert.doesNotMatch(html, /<script src="[^\"]*(?:firebase-firestore|firebase-storage|html2canvas|html2pdf)/);
  assert.match(html, /classic:[\s\S]*firebase-firestore-compat\.js/);
  assert.ok(html.indexOf('crm-auth.js') > html.indexOf('firebase-auth-compat.js'));

  assert.match(auth, /signInWithCustomToken\(data\.customToken\)/);
  assert.match(auth, /Auth\.Persistence\.SESSION/);
  assert.match(auth, /claims\?\.admin === true && token\.claims\?\.role === "crm_shared_admin"/);
  assert.match(auth, /sign_in_provider !== "custom"/);
  assert.doesNotMatch(auth, /MAX_SHARED_SESSION_SECONDS|sessionAge > MAX_SHARED_SESSION_SECONDS/);
  assert.match(auth, /now - authTime < -MAX_CLOCK_SKEW_SECONDS/);
  assert.match(auth, /credentials: "omit"/);
  assert.match(auth, /cache: "no-store"/);
  assert.match(auth, /serviceWorker\.register\("\.\/sw\.js"\)/);
});

test('signed-out and expired sessions fail closed and remove browser copies', async () => {
  const [app, auth] = await Promise.all([read('app.js'), read('crm-auth.js')]);

  assert.doesNotMatch(app, /signInAnonymously/);
  assert.doesNotMatch(app, /enablePersistence/);
  assert.doesNotMatch(app, /Auth\.Persistence\.LOCAL/);
  assert.doesNotMatch(app, /serviceWorker\.register/);
  assert.doesNotMatch(app, /\blocalStorage\b/);
  assert.equal((app.match(/autoLoadBackupFromServer\s*\(/g) || []).length, 1, 'backup helper must never be called');
  assert.match(app, /crmSessionStorage = window\.sessionStorage/);
  assert.match(app, /window\.crmAuth\?\.lock/);

  assert.match(auth, /localStorage\.clear\(\)/);
  assert.match(auth, /sessionStorage\.clear\(\)/);
  assert.match(auth, /deleteDatabase\(name\)/);
  assert.match(auth, /auth\?\.signOut\(\)/);
  assert.match(auth, /window\.location\.reload\(\)/);
});

test('the shared password is never embedded in public source', async () => {
  const files = await Promise.all([
    read('index.html'),
    read('crm-auth.js'),
    read('app.js'),
    read('sw.js')
  ]);
  const source = files.join('\n');
  assert.doesNotMatch(source, /CRM_SHARED_LOGIN_PASSWORD\s*=\s*["'][^"']+["']/);
  assert.doesNotMatch(source, /password\s*:\s*["'][^"']+["']/);
});
