import crypto from 'node:crypto';
import { COMPANY, TEMPLATE_ID, ReceiptError, cleanText, documentInfo, documentType, draftInput, fail, validId } from '../customer-receipts-core.js';

// UID or verified Google-email allowlists match the existing CRM administrator policy.
export function receiptAdminAllowed(decoded, uids, emails) {
  return typeof decoded?.uid === 'string' && (uids.has(decoded.uid) || (decoded.email_verified === true
    && decoded.firebase?.sign_in_provider === 'google.com'
    && emails.has(String(decoded.email || '').trim().toLowerCase())));
}
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const numberKey = number => fingerprint(number.toUpperCase());
const publicRecord = record => {
  if (!record) return null;
  const { lastOperation, createdBy, updatedBy, ...value } = record;
  return value;
};

export function createReceiptService({ repository, clock = () => new Date().toISOString() }) {
  return {
    async list(cursor = '') { return repository.list(cursor); },
    async get(id) {
      if (!validId(id)) fail('收据 ID 不正确。');
      const record = await repository.get(id);
      if (!record) fail('找不到这张收据。', 404);
      return publicRecord(record);
    },
    async mutate(action, body, uid) {
      if (!['save', 'issue', 'void'].includes(action)) fail('不支持的收据操作。', 404);
      if (!validId(body.id) || !validId(body.operationId) || !Number.isSafeInteger(body.revision) || body.revision < 0) fail('收据版本或操作 ID 不正确，请重新打开记录。');
      const fields = action === 'save' ? draftInput(body.input) : action === 'void' ? { reason: cleanText(body.reason ?? '', 300, '作废原因', true) } : {};
      const hash = fingerprint({ action, fields, revision: body.revision });
      const operation = { id: body.operationId, hash };
      return publicRecord(await repository.transact(body.id, async tx => {
        const current = tx.current;
        if (current?.lastOperation?.id === operation.id) {
          if (current.lastOperation.hash !== hash) fail('同一次操作的内容已改变，请刷新核对。', 409);
          return current;
        }
        if ((!current && body.revision !== 0) || (current && current.revision !== body.revision)) fail('收据已在其他页面修改，请重新打开最新记录。', 409);
        if (!current && action !== 'save') fail('请先保存收据草稿。', 409);
        const at = clock();
        let next;
        if (action === 'save') {
          if (current && current.status !== 'draft') fail('已签发或作废的收据不能改写。', 409);
          next = { ...(current || { id: body.id, company: { ...COMPANY }, templateId: TEMPLATE_ID, status: 'draft', number: '', createdAt: at, createdBy: uid }), ...fields };
        } else if (action === 'issue') {
          if (current.status !== 'draft') fail('这张收据已签发或作废，请重新打开。', 409);
          const type = documentType(current.type), info = documentInfo(type);
          if (current.totalCents <= 0) fail(type === 'invoice' ? '签发前请填写有效的开单金额。' : '签发前须填写本次实际收到的金额。');
          const year = current.date.slice(0, 4), series = `${type}-${year}`;
          const counter = await tx.counter(series);
          let sequence = counter.sequence || 0, number, owner;
          for (let attempt = 0; attempt < 100; attempt++) {
            sequence++;
            if (!Number.isSafeInteger(sequence) || sequence > 999999) fail('本年度自动编号已用完，请联系管理员处理。', 409);
            number = `${info.prefix}-${year}-${String(sequence).padStart(6, '0')}`;
            owner = await tx.number(numberKey(number));
            if (!owner) break;
          }
          if (owner) fail('自动编号暂时无法分配，请刷新核对后重试。', 409);
          // All Firestore reads finish before writes begin.
          tx.reserveNumber(numberKey(number), { id: current.id, number, createdAt: at });
          tx.setCounter(series, { sequence, updatedAt: at });
          next = { ...current, type, number, status: 'issued', issuedAt: at };
        } else {
          if (current.status !== 'issued') fail('只有已签发的收据可以作废。', 409);
          next = { ...current, status: 'void', voidReason: fields.reason, voidedAt: at };
        }
        next = { ...next, revision: (current?.revision || 0) + 1, updatedAt: at, updatedBy: uid, lastOperation: operation };
        tx.put(next);
        return next;
      }));
    }
  };
}

export function createReceiptHandler({ authenticate, repository, allowedOrigins, clock }) {
  const service = createReceiptService({ repository, clock });
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
    const origin = String(req.headers.origin || '');
    if (origin && !allowedOrigins().has(origin)) return send(403, { error: '此来源不允许访问客户收据。' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    try {
      if (!['GET', 'POST'].includes(req.method)) fail('不支持的请求方式。', 405);
      const uid = await authenticate(req);
      const url = new URL(req.url, 'https://local'), action = url.searchParams.get('action') || 'list';
      if (req.method === 'GET') {
        if (action === 'get') return send(200, { ok: true, receipt: await service.get(url.searchParams.get('id')) });
        if (action !== 'list') fail('此操作须使用 POST。', 405);
        const cursor = url.searchParams.get('cursor') || '';
        if (cursor && !validId(cursor)) fail('分页标记不正确。');
        const page = await service.list(cursor);
        return send(200, { ok: true, receipts: page.receipts.map(publicRecord), cursor: page.cursor });
      }
      let body;
      const raw = typeof req.body === 'object' && req.body !== null ? JSON.stringify(req.body) : String(req.body || '{}');
      if (Buffer.byteLength(raw) > 24576) fail('收据资料过长。', 413);
      try { body = JSON.parse(raw); } catch { fail('收据资料格式不正确。'); }
      if (!body || Array.isArray(body) || typeof body !== 'object') fail('收据资料格式不正确。');
      return send(200, { ok: true, receipt: await service.mutate(action, body, uid) });
    } catch (error) {
      return send(error instanceof ReceiptError ? error.status : 503, { error: error instanceof ReceiptError ? error.message : '云端收据操作未确认，请检查网络和管理员权限后核对记录。' });
    }
  };
}
