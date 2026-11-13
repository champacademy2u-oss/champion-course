import { DEFAULT_CATEGORIES, inspectFile, metadata, validateCategories, libraryError } from './champ-library-core.js';
import { uploadThroughRelay } from './champ-library-upload.js?v=20261113-upload-check';

// Files are stored as Blobs in IndexedDB, never as temporary object URLs or localStorage strings.
export class LocalLibrary {
  constructor(name = 'champ-material-library-v1') { this.name = name; }
  async database() {
    if (!this.connection) this.connection = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(libraryError('此浏览器不支持本机文件保存，请使用 Chrome。'));
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => {
        for (const store of ['files', 'blobs', 'settings']) request.result.createObjectStore(store, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(libraryError('无法打开本机资料库，请检查浏览器的储存权限。'));
      request.onblocked = () => reject(libraryError('请关闭其他资料库页面，再重试。'));
    });
    return this.connection;
  }
  async read(store, id) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, 'readonly');
      const request = id == null ? transaction.objectStore(store).getAll() : transaction.objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(libraryError('读取本机资料失败。'));
    });
  }
  async list() {
    const [files, settings] = await Promise.all([this.read('files'), this.read('settings', 'categories')]);
    return { files, categories: settings?.items || structuredClone(DEFAULT_CATEGORIES), categoryRevision: settings?.revision || 0 };
  }
  async write(stores, action) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(stores, 'readwrite');
      let value, reason;
      const fail = error => { reason = error; transaction.abort(); };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = transaction.onerror = () => reject(reason || libraryError(transaction.error?.name === 'QuotaExceededError' ? '本机储存空间不足；文件未保存，请释放空间或改用云端。' : '本机保存失败，资料未变更。'));
      try { action(transaction, result => { value = result; }, fail); } catch (error) { fail(error); }
    });
  }
  async upload(file, input) {
    const validated = await inspectFile(file);
    const { categories } = await this.list();
    const at = new Date().toISOString();
    const record = { id: crypto.randomUUID(), ...validated, ...metadata(input, categories), status: 'ready', revision: 1, createdAt: at, updatedAt: at, trashedAt: '' };
    await this.write(['files', 'blobs'], (tx, done) => {
      tx.objectStore('files').add(record);
      tx.objectStore('blobs').add({ id: record.id, data: file });
      done(record);
    });
    return record;
  }
  async update(id, revision, patch) {
    const { categories } = await this.list();
    return this.write(['files'], (tx, done, fail) => {
      const store = tx.objectStore('files');
      const request = store.get(id);
      request.onsuccess = () => {
        const current = request.result;
        if (!current || current.revision !== revision) return fail(libraryError('资料已被修改，请刷新后重试。', 409));
        try {
          const changes = patch.action === 'trash' ? { trashedAt: new Date().toISOString() } : patch.action === 'restore' ? { trashedAt: '' } : metadata(patch, categories);
          const updated = { ...current, ...changes, revision: current.revision + 1, updatedAt: new Date().toISOString() };
          store.put(updated); done(updated);
        } catch (error) { fail(error); }
      };
    });
  }
  async categories(items, revision) {
    const validated = validateCategories(items);
    return this.write(['settings'], (tx, done, fail) => {
      const store = tx.objectStore('settings');
      const request = store.get('categories');
      request.onsuccess = () => {
        const current = request.result;
        if ((current?.revision || 0) !== revision) return fail(libraryError('分类已被修改，请刷新后重试。', 409));
        // Classification IDs are stable: rename or append; no accidental orphaning.
        if ((current?.items || DEFAULT_CATEGORIES).some(item => !validated.some(value => value.id === item.id))) return fail(libraryError('已有分类请改名，不能直接移除。'));
        const value = { id: 'categories', items: validated, revision: revision + 1 };
        store.put(value); done(value);
      };
    });
  }
  async url(file) {
    const stored = await this.read('blobs', file.id);
    if (!stored?.data) throw libraryError('找不到本机原文件。');
    return URL.createObjectURL(stored.data);
  }
}

export class CloudLibrary {
  constructor(endpoint, token, transport = uploadThroughRelay) { this.endpoint = endpoint; this.token = token; this.transport = transport; }
  async request(action, body, query = {}) {
    const url = new URL(this.endpoint, location.href);
    url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { Authorization: `Bearer ${await this.token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw libraryError(data.error || (response.status === 404 ? '云端资料库尚未发布，可先切换到本机资料。' : '云端操作失败，请重试。'), response.status);
    if (data.ok !== true) throw libraryError('云端资料库返回了无法确认的结果，请刷新后重试。');
    return data;
  }
  async list() {
    let cursor = '', result, files = [];
    do {
      result = await this.request('list', null, cursor ? { cursor } : {});
      files.push(...result.files);
      cursor = result.cursor;
    } while (cursor);
    return { ...result, files };
  }
  update(id, revision, patch) { return this.request('update', { id, revision, ...patch }); }
  categories(items, revision) { return this.request('categories', { items, revision }); }
  async url(file) { return (await this.request('read', null, { id: file.id })).url; }
  async downloadUrl(file) { return (await this.request('download', null, { id: file.id })).url; }
  async upload(file, input, progress = () => {}) {
    const validated = await inspectFile(file);
    const pending = await this.request('begin', { ...validated, ...input });
    let uploaded = false;
    try {
      await this.transport({ endpoint: this.endpoint, url: pending.url, file, mime: validated.mime, onProgress: progress });
      uploaded = true;
      const result = await this.request('complete', { id: pending.id });
      progress(100); return result.file;
    } catch (error) {
      // A lost final response can mean completion succeeded: retry only the
      // idempotent finalize step, never create a second upload or delete a ready object.
      if (uploaded && (!error.status || error.status >= 500)) {
        try {
          const recovered = await this.request('complete', { id: pending.id });
          progress(100); return recovered.file;
        } catch { throw libraryError('暂时无法确认云端是否已保存，请刷新资料列表核对后再重试。'); }
      }
      throw error;
    }
  }
}
