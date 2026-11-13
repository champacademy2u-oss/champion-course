import { DEFAULT_CATEGORIES, libraryError, matchesSignature, metadata, validId, validateCategories, validateFile } from '../champ-library-core.js';

// Match the existing CRM's UID or verified Google-email administrator policy.
export function libraryAdminAllowed(decoded, uids, emails) {
  return uids.has(decoded.uid) || (decoded.email_verified === true
    && decoded.firebase?.sign_in_provider === 'google.com'
    && emails.has(String(decoded.email || '').trim().toLowerCase()));
}

// Dependencies are injected so permissions, interrupted uploads and conflicts can be tested without live data.
export function createLibraryHandler({ authenticate, repository, objects, uuid, clock = () => new Date().toISOString(), allowedOrigins }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, payload) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
    };
    const origin = String(req.headers.origin || '');
    if (origin && !allowedOrigins().has(origin)) return send(403, { error: '此来源不允许访问资料库。' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (!['GET', 'POST'].includes(req.method)) return send(405, { error: '不支持的操作。' });
    try {
      await authenticate(req);
      const url = new URL(req.url, 'https://local');
      const action = url.searchParams.get('action') || 'list';
      const reads = ['list', 'read', 'download'];
      if ((reads.includes(action) ? 'GET' : 'POST') !== req.method) throw libraryError('此操作的请求方式不正确。', 405);
      let body = {};
      if (req.method === 'POST') {
        const raw = typeof req.body === 'object' && req.body !== null ? JSON.stringify(req.body) : String(req.body || '{}');
        if (Buffer.byteLength(raw) > 16384) throw libraryError('资料太长。', 413);
        try { body = JSON.parse(raw); } catch { throw libraryError('资料格式不正确。'); }
        if (!body || Array.isArray(body) || typeof body !== 'object') throw libraryError('资料格式不正确。');
      }
      const settings = await repository.settings();
      const categories = settings?.items || structuredClone(DEFAULT_CATEGORIES);
      const categoryRevision = settings?.revision || 0;
      if (action === 'list') {
        const cursor = url.searchParams.get('cursor') || '';
        if (cursor && !validId(cursor)) throw libraryError('分页标记不正确。');
        const page = await repository.list(cursor);
        return send(200, { ok: true, ...page, categories, categoryRevision });
      }
      if (action === 'categories') {
        const items = validateCategories(body.items);
        const value = await repository.mutateSettings(current => {
          if ((current?.revision || 0) !== body.revision) throw libraryError('分类已被修改，请刷新后重试。', 409);
          if ((current?.items || DEFAULT_CATEGORIES).some(item => !items.some(value => value.id === item.id))) throw libraryError('已有分类请改名，不能直接移除。');
          return { items, revision: body.revision + 1 };
        });
        return send(200, { ok: true, ...value });
      }
      if (action === 'begin') {
        const validated = validateFile(body);
        const info = metadata(body, categories);
        const id = uuid(), at = clock();
        const file = { id, ...validated, ...info, objectKey: `champ-library/${id}`, status: 'uploading', revision: 0, trashedAt: '', createdAt: at, updatedAt: at };
        // Confirm storage is configured before reserving a document.
        const uploadUrl = await objects.uploadUrl(file);
        await repository.create(file);
        return send(200, { ok: true, id, url: uploadUrl });
      }
      const id = req.method === 'GET' ? url.searchParams.get('id') : body.id;
      if (!validId(id)) throw libraryError('资料 ID 不正确。');
      const file = await repository.get(id);
      if (!file) throw libraryError('找不到这份资料。', 404);
      if (action === 'complete') {
        if (file.status === 'ready') return send(200, { ok: true, file: publicFile(file) });
        if (file.status !== 'uploading') throw libraryError('这份上传已失效，请重新上传。', 409);
        const head = await objects.head(file.objectKey);
        if (Number(head.ContentLength) !== file.size || head.ContentType !== file.mime) throw libraryError('文件尚未完整上传或格式不符，请重新上传。', 409);
        if (!matchesSignature(file.mime, await objects.prefix(file.objectKey))) throw libraryError('文件内容与格式不符，未加入资料库。');
        const ready = await repository.mutate(id, current => {
          if (current.status === 'ready') return current;
          if (current.status !== 'uploading') throw libraryError('上传状态已变化，请刷新。', 409);
          return { ...current, status: 'ready', revision: 1, updatedAt: clock() };
        });
        return send(200, { ok: true, file: publicFile(ready) });
      }
      if (file.status !== 'ready') throw libraryError('这份资料尚未上传完成。', 409);
      if (action === 'read' || action === 'download') {
        const readUrl = await objects.readUrl(file, action === 'download');
        return send(200, { ok: true, url: readUrl });
      }
      if (action === 'update') {
        const updated = await repository.mutate(id, current => {
          if (current.revision !== body.revision) throw libraryError('资料已被其他页面修改，请刷新后重试。', 409);
          const patch = body.action === 'trash' ? { trashedAt: clock() } : body.action === 'restore' ? { trashedAt: '' } : metadata(body, categories);
          return { ...current, ...patch, revision: current.revision + 1, updatedAt: clock() };
        });
        return send(200, { ok: true, file: publicFile(updated) });
      }
      throw libraryError('不支持的资料库操作。', 404);
    } catch (error) {
      // Do not send provider errors, object keys, credentials or SDK diagnostics to clients.
      return send(error.status || 503, { error: error.status ? error.message : '云端资料库暂时无法使用，请稍后重试。' });
    }
  };
}
export function publicFile(file) {
  const { objectKey, ...record } = file;
  return record;
}
