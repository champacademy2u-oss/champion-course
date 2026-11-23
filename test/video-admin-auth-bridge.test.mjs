import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('CRM sends video authorization only to the exact owned iframe', async () => {
  const [html, app] = await Promise.all([read('index.html'), read('app.js')]);
  assert.match(html, /id="videoRoomAdminFrame"/);
  assert.match(app, /event\.origin !== VIDEO_ADMIN_ORIGIN/);
  assert.match(app, /event\.source !== frame\.contentWindow/);
  assert.match(app, /postMessage\(\{ type: VIDEO_AUTH_RESPONSE, nonce, token \}, VIDEO_ADMIN_ORIGIN\)/);
  assert.doesNotMatch(app, /postMessage\([^\n]+,\s*["']\*["']\)/);
});

test('embedded video console keeps the CRM token in memory and validates its parent', async () => {
  const admin = await read('public/admin.html');
  assert.match(admin, /event\.origin !== CRM_PARENT_ORIGIN/);
  assert.match(admin, /event\.source !== window\.parent/);
  assert.match(admin, /window\.parent\.postMessage\(\{ type: VIDEO_AUTH_REQUEST, nonce \}, CRM_PARENT_ORIGIN\)/);
  assert.match(admin, /let adminToken = isEmbeddedInCrm \? ''/);
  assert.doesNotMatch(admin, /sessionStorage\.setItem\('videoRoomAdminToken', token\)[\s\S]{0,300}requestParentToken/);
});

test('direct video console is frame-restricted and cannot use a public-admin bypass', async () => {
  const [admin, vercel] = await Promise.all([read('public/admin.html'), read('vercel.json')]);
  assert.doesNotMatch(admin, /isPublicAdmin/);
  const config = JSON.parse(vercel);
  const policy = config.headers?.find(item => item.source === '/admin')?.headers
    ?.find(item => item.key === 'Content-Security-Policy')?.value;
  assert.equal(policy, "frame-ancestors 'self' https://champacademy2u-oss.github.io");
});
