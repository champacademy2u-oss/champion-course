import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { DEFAULT_CATEGORIES, filterFiles, inspectFile, libraryError, matchesSignature, metadata, validateCategories, validateFile } from '../champ-library-core.js';
import { createLibraryHandler, libraryAdminAllowed, publicFile } from '../lib/champ-library-api.js';
import { CloudLibrary } from '../champ-library-store.js';
import { isRelayMessage } from '../champ-library-upload.js';

const pdf = Buffer.from('%PDF-1.4\nChamp test document\n%%EOF');
const input = { fileName: '课程.pdf', mime: 'application/pdf', size: pdf.length, title: '课程简介', categoryId: 'course', tags: ['课程'] };
test('library preserves existing CRM admin policy without accepting unverified or non-Google email claims', () => {
  const uids = new Set(['approved-uid']), emails = new Set(['owner@example.test']);
  assert.equal(libraryAdminAllowed({ uid: 'approved-uid' }, uids, emails), true);
  const google = { uid: 'new-device', email: 'OWNER@example.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
  assert.equal(libraryAdminAllowed(google, uids, emails), true);
  assert.equal(libraryAdminAllowed({ ...google, email_verified: false }, uids, emails), false);
  assert.equal(libraryAdminAllowed({ ...google, firebase: { sign_in_provider: 'password' } }, uids, emails), false);
  assert.equal(libraryAdminAllowed({ ...google, email: 'other@example.test' }, uids, emails), false);
});
function fixture(options = {}) {
  const files = new Map(); let settings; let authCalls = 0, objectReads = 0;
  let object = { ContentLength: pdf.length, ContentType: 'application/pdf', prefix: pdf };
  const repository = {
    async settings() { return settings; },
    async list() { return { files: [...files.values()].filter(file => file.status === 'ready').map(publicFile), cursor: '' }; },
    async get(id) { return files.get(id); },
    async create(file) { files.set(file.id, structuredClone(file)); },
    async mutate(id, change) { const file = change(structuredClone(files.get(id))); files.set(id, file); return file; },
    async mutateSettings(change) { settings = change(settings); return settings; }
  };
  const handler = createLibraryHandler({
    repository, allowedOrigins: () => new Set(['https://champ.example']), uuid: () => 'qa-file-1', clock: () => '2026-11-13T12:00:00.000Z',
    authenticate: async req => { authCalls++; if (req.headers.authorization !== 'Bearer approved-test') throw libraryError('未授权', 401); },
    objects: {
      uploadUrl: async () => 'https://private-store.example/upload',
      head: async () => { if (!object) throw new Error('storage secret raw-provider-error'); return object; },
      prefix: async () => { objectReads++; return object.prefix; },
      readUrl: async (_file, download) => { objectReads++; return `https://private-store.example/${download ? 'download' : 'preview'}`; }
    }, ...options
  });
  async function request(action, body, { method = body ? 'POST' : 'GET', origin = 'https://champ.example', authorization = 'Bearer approved-test', id } = {}) {
    const headers = {};
    const res = { setHeader: (key, value) => { headers[key.toLowerCase()] = value; }, end(value) { this.body = value ? JSON.parse(value) : null; } };
    await handler({ url: `/api/champ-library?action=${action}${id ? `&id=${id}` : ''}`, method, headers: { origin, authorization }, body }, res);
    return { status: res.statusCode, data: res.body, headers };
  }
  return { request, files, object: value => { object = value; }, get authCalls() { return authCalls; }, get objectReads() { return objectReads; } };
}

test('accepts actual PDFs and rejects disguised HTML, empty files and mismatched MIME', async () => {
  const file = new File([pdf], '课程.pdf', { type: 'application/pdf' });
  assert.equal((await inspectFile(file)).kind, 'pdf');
  await assert.rejects(inspectFile(new File(['<html>secret</html>'], '课程.pdf', { type: 'application/pdf' })), /内容与格式不符/);
  assert.throws(() => validateFile({ name: 'x.pdf', size: 0, type: 'application/pdf' }));
  assert.throws(() => validateFile({ name: 'x.png', size: 10, type: 'text/html' }));
  assert.throws(() => validateFile({ name: 'x.svg', size: 10, type: 'image/svg+xml' }));
  assert.throws(() => validateFile({ name: 'x.pdf', size: 51 * 1024 ** 2, type: 'application/pdf' }));
  assert.equal(validateFile({ name: 'movie.MP4', size: 1024 ** 3, type: '' }).mime, 'video/mp4');
});
test('recognizes JPEG, PNG, WebM and HEIC signatures without accepting their extensions alone', () => {
  assert.equal(matchesSignature('image/jpeg', Buffer.from([255, 216, 255, 0])), true);
  assert.equal(matchesSignature('image/png', Buffer.from('89504e470d0a1a0a', 'hex')), true);
  assert.equal(matchesSignature('video/webm', Buffer.from('1a45dfa3', 'hex')), true);
  assert.equal(matchesSignature('image/heic', Buffer.concat([Buffer.from([0,0,0,24]), Buffer.from('ftypheic0000') ])), true);
  assert.equal(matchesSignature('image/png', pdf), false);
});
test('category IDs remain stable and metadata ignores injected server fields', () => {
  assert.throws(() => validateCategories([{ id: 'x', name: 'A' }, { id: 'y', name: 'a' }]), /重复/);
  assert.throws(() => validateCategories([{ id: '../outside', name: 'A' }]));
  assert.throws(() => metadata({ title: 'x', categoryId: 'gone' }, DEFAULT_CATEGORIES), /分类已变化/);
  const result = metadata({ ...input, tags: '活动，活动,版本1', objectKey: 'private/secret', revision: 99 }, DEFAULT_CATEGORIES);
  assert.deepEqual(result.tags, ['活动', '版本1']);
  assert.equal('objectKey' in result, false);
  assert.equal('revision' in result, false);
});
test('filters combine tags, category, media type and trash without mixing unfinished uploads', () => {
  const files = [
    { id: 'one', status: 'ready', title: '宣传页', fileName: 'one.pdf', categoryId: 'marketing', kind: 'pdf', tags: ['Ryan'], createdAt: '2026-11-13', size: 20 },
    { id: 'two', status: 'ready', title: '宣传页', fileName: 'two.pdf', categoryId: 'marketing', kind: 'pdf', tags: ['Ryan'], trashedAt: '2026-11-13', createdAt: '2026-11-12', size: 30 },
    { id: 'three', status: 'uploading', title: 'Ryan', categoryId: 'marketing', kind: 'pdf', createdAt: '2026-11-13' }
  ];
  assert.deepEqual(filterFiles(files, { category: 'marketing', query: 'ryan', kind: 'pdf' }).map(file => file.id), ['one']);
  assert.deepEqual(filterFiles(files, { trash: true }).map(file => file.id), ['two']);
  assert.equal(filterFiles(files, { kind: 'video' }).length, 0);
});
test('unauthorized access and unapproved origins cannot read metadata or file URLs', async () => {
  const f = fixture();
  assert.equal((await f.request('list', null, { authorization: '' })).status, 401);
  assert.equal((await f.request('read', null, { authorization: '', id: 'qa-file-1' })).status, 401);
  const before = f.authCalls;
  assert.equal((await f.request('list', null, { origin: 'https://untrusted.example' })).status, 403);
  assert.equal(f.authCalls, before); assert.equal(f.objectReads, 0);
  assert.equal((await f.request('list', null, { method: 'OPTIONS' })).status, 204);
  assert.equal(f.authCalls, before);
});
test('an interrupted upload is invisible until verified; completion is idempotent and private', async () => {
  const f = fixture();
  const begin = await f.request('begin', input);
  assert.equal(begin.status, 200);
  assert.equal((await f.request('list')).data.files.length, 0);
  assert.equal((await f.request('read', null, { id: begin.data.id })).status, 409);
  assert.equal((await f.request('complete', { id: begin.data.id })).status, 200);
  const completed = await f.request('complete', { id: begin.data.id });
  assert.equal(completed.status, 200); assert.equal(completed.data.file.revision, 1);
  assert.equal('objectKey' in completed.data.file, false);
  assert.equal((await f.request('list')).data.files.length, 1);
  const preview = await f.request('read', null, { id: begin.data.id });
  assert.match(preview.data.url, /preview/);
  assert.equal(preview.headers['cache-control'], 'private, no-store');
});
test('server rejects incomplete and disguised uploads even when the client reports success', async () => {
  const f = fixture(); await f.request('begin', input);
  f.object({ ContentLength: 1, ContentType: 'application/pdf', prefix: pdf });
  assert.equal((await f.request('complete', { id: 'qa-file-1' })).status, 409);
  f.object({ ContentLength: pdf.length, ContentType: 'application/pdf', prefix: Buffer.from('<html>') });
  assert.equal((await f.request('complete', { id: 'qa-file-1' })).status, 400);
  assert.equal((await f.request('list')).data.files.length, 0);
  f.object(null);
  const error = await f.request('complete', { id: 'qa-file-1' });
  assert.equal(error.status, 503); assert.doesNotMatch(JSON.stringify(error.data), /secret|raw-provider/);
});
test('stale edits fail without overwriting changes; trash and restore preserve the original', async () => {
  const f = fixture(); await f.request('begin', input); await f.request('complete', { id: 'qa-file-1' });
  assert.equal((await f.request('update', { id: 'qa-file-1', revision: 1, ...input, title: '新版', categoryId: 'brand' })).status, 200);
  assert.equal((await f.request('update', { id: 'qa-file-1', revision: 1, ...input, title: '过期版本' })).status, 409);
  assert.equal(f.files.get('qa-file-1').title, '新版');
  await f.request('update', { id: 'qa-file-1', revision: 2, action: 'trash' });
  assert.equal(filterFiles((await f.request('list')).data.files).length, 0);
  assert.equal(filterFiles((await f.request('list')).data.files, { trash: true }).length, 1);
  await f.request('update', { id: 'qa-file-1', revision: 3, action: 'restore' });
  assert.equal(f.files.get('qa-file-1').trashedAt, '');
  assert.equal(f.files.get('qa-file-1').objectKey, 'champ-library/qa-file-1');
});
test('category removal and conflicting category edits are rejected', async () => {
  const f = fixture();
  const items = [...DEFAULT_CATEGORIES, { id: 'qa-custom', name: '无限杠杆课件' }];
  assert.equal((await f.request('categories', { items, revision: 0 })).status, 200);
  assert.equal((await f.request('categories', { items, revision: 0 })).status, 409);
  assert.equal((await f.request('categories', { items: DEFAULT_CATEGORIES, revision: 1 })).status, 400);
  assert.equal((await f.request('list')).data.categories.length, 7);
});
test('GET cannot perform a write and oversized metadata is rejected', async () => {
  const f = fixture();
  assert.equal((await f.request('begin', input, { method: 'GET' })).status, 405);
  assert.equal((await f.request('begin', { ...input, notes: 'x'.repeat(17000) })).status, 413);
  assert.equal(f.files.size, 0);
});
test('cloud failure never becomes local success, and malformed success responses are rejected', async () => {
  const originalFetch = globalThis.fetch, originalLocation = globalThis.location;
  globalThis.location = { href: 'https://champ.example/' };
  const cloud = new CloudLibrary('https://api.example/api/champ-library', async () => 'test-token');
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: '权限拒绝' }), { status: 403 });
    await assert.rejects(cloud.list(), /权限拒绝/);
    globalThis.fetch = async () => new Response('<html>not an API</html>', { status: 200 });
    await assert.rejects(cloud.list(), /无法确认/);
    let page = 0;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, files: [{ id: `file-${++page}` }], categories: DEFAULT_CATEGORIES, categoryRevision: 0, cursor: page === 1 ? 'next' : '' }), { status: 200 });
    assert.deepEqual((await cloud.list()).files.map(file => file.id), ['file-1', 'file-2']);
  } finally { globalThis.fetch = originalFetch; globalThis.location = originalLocation; }
});
test('service worker cache excludes private and cross-origin responses', async () => {
  const sw = await fs.readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const callback = [];
  const self = { location: new URL('https://champ.example/course/sw.js'), addEventListener(name, fn) { if (name === 'fetch') callback.push(fn); } };
  Function('self', sw)(self);
  for (const url of ['https://private-store.example/video?signature=secret', 'https://champ.example/course/api/champ-library', 'https://champ.example/course/lead-center-full-backup-test.json']) {
    let intercepted = false;
    callback[0]({ request: { method: 'GET', url }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});

test('a lost completion response retries the same file rather than uploading a duplicate', async () => {
  const originals = { fetch: globalThis.fetch, location: globalThis.location, XMLHttpRequest: globalThis.XMLHttpRequest };
  let puts = 0, begins = 0, completes = 0;
  globalThis.location = { href: 'https://champ.example/' };
  globalThis.XMLHttpRequest = class {
    constructor() { this.upload = {}; }
    open() {} setRequestHeader() {}
    send() { puts++; this.status = 200; this.onload(); }
  };
  globalThis.fetch = async url => {
    if (new URL(url).searchParams.get('action') === 'begin') { begins++; return Response.json({ ok: true, id: 'same-file', url: 'https://store.example/upload' }); }
    completes++;
    if (completes === 1) throw new TypeError('Connection lost');
    return Response.json({ ok: true, file: { id: 'same-file', status: 'ready' } });
  };
  try {
    const client = new CloudLibrary('https://api.example/library', async () => 'test', async () => { puts++; });
    assert.equal((await client.upload(new File([pdf], '课程.pdf', { type: 'application/pdf' }), input)).id, 'same-file');
    assert.deepEqual([begins, puts, completes], [1, 1, 2]);
  } finally { Object.assign(globalThis, originals); }
});

test('a failed direct upload never finalizes a file or reports success', async () => {
  const originals = { fetch: globalThis.fetch, location: globalThis.location, XMLHttpRequest: globalThis.XMLHttpRequest };
  const actions = [];
  globalThis.location = { href: 'https://champ.example/' };
  globalThis.XMLHttpRequest = class {
    constructor() { this.upload = {}; }
    open() {} setRequestHeader() {}
    send() { this.status = 403; this.onload(); }
  };
  globalThis.fetch = async url => { actions.push(new URL(url).searchParams.get('action')); return Response.json({ ok: true, id: 'qa-file', url: 'https://store.example/upload' }); };
  try {
    const client = new CloudLibrary('https://api.example/library', async () => 'test', async () => { throw libraryError('文件上传失败。'); });
    await assert.rejects(client.upload(new File([pdf], '课程.pdf', { type: 'application/pdf' }), input), /上传失败/);
    assert.deepEqual(actions, ['begin']);
  } finally { Object.assign(globalThis, originals); }
});

test('upload relay accepts responses only from its exact frame, origin and operation', () => {
  const frame = {}, origin = 'https://backend.example', id = 'operation-1';
  const event = { source: frame, origin, data: { channel: 'champ-library-upload-v1', id } };
  assert.equal(isRelayMessage(event, frame, origin, id), true);
  assert.equal(isRelayMessage({ ...event, source: {} }, frame, origin, id), false);
  assert.equal(isRelayMessage({ ...event, origin: 'https://other.example' }, frame, origin, id), false);
  assert.equal(isRelayMessage({ ...event, data: { ...event.data, id: 'other' } }, frame, origin, id), false);
});

test('backend-origin relay rejects untrusted parents and upload destinations; no signed URLs are echoed', async () => {
  const code = await fs.readFile(new URL('../public/library-upload.js', import.meta.url), 'utf8');
  const sent = []; let handler, requests = 0;
  const parent = { postMessage(payload, origin) { sent.push({ payload, origin }); } };
  const window = { addEventListener(_name, callback) { handler = callback; } };
  class Xhr {
    constructor() { this.upload = {}; }
    open(method) { assert.equal(method, 'PUT'); requests++; }
    setRequestHeader(name, value) { assert.equal(name, 'Content-Type'); assert.equal(value, 'application/pdf'); }
    send(file) { assert.equal(file.size, pdf.length); this.status = 200; this.onload(); }
  }
  vm.runInNewContext(code, { window, parent, location: { origin: 'https://backend.example' }, URL, Blob, XMLHttpRequest: Xhr });
  const data = { channel: 'champ-library-upload-v1', id: 'qa-relay', url: 'https://bucket.account.r2.cloudflarestorage.com/champ-library/qa?X-Amz-Signature=test-only', file: new Blob([pdf]), mime: 'application/pdf' };
  handler({ source: parent, origin: 'https://other.example', data });
  handler({ source: {}, origin: 'https://champacademy2u-oss.github.io', data });
  assert.equal(requests, 0); assert.equal(sent.length, 0);
  handler({ source: parent, origin: 'https://champacademy2u-oss.github.io', data: { ...data, url: 'https://other.example/champ-library/qa?X-Amz-Signature=test-only' } });
  assert.equal(requests, 0); assert.equal(sent.at(-1).payload.status, 'error');
  handler({ source: parent, origin: 'https://champacademy2u-oss.github.io', data });
  assert.equal(requests, 1);
  assert.deepEqual(sent.slice(-2).map(value => value.payload.status), ['accepted', 'complete']);
  assert.doesNotMatch(JSON.stringify(sent), /X-Amz|test-only|cloudflarestorage/);
});
