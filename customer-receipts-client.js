import { draftInput, editableInput, receiptNumber, validId } from './customer-receipts-core.js';

export class CloudReceiptError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}
function confirmedReceipt(record) {
  try {
    if (!record || !validId(record.id) || !Number.isSafeInteger(record.revision) || record.revision < 1 || !['draft', 'issued', 'void'].includes(record.status)) throw new Error();
    if (draftInput(editableInput(record)).totalCents !== record.totalCents) throw new Error();
    if (typeof record.number !== 'string' || (record.status !== 'draft' && !receiptNumber(record.number))) throw new Error();
    if (!['brand', 'name', 'registration', 'phone', 'email'].every(key => typeof record.company?.[key] === 'string' && record.company[key].length > 0 && record.company[key].length <= 200)) throw new Error();
    if (![record.createdAt, record.updatedAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))) throw new Error();
    return record;
  } catch { throw new CloudReceiptError('云端收据资料未能确认，请刷新核对记录；本次操作可使用原编号重试。'); }
}
export class CloudReceipts {
  constructor(endpoint, token, fetcher = (...args) => fetch(...args)) { this.endpoint = endpoint; this.token = token; this.fetcher = fetcher; }
  async request(action, body, query = {}) {
    if (!this.endpoint) throw new CloudReceiptError('客户收据云端服务尚未配置。');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      let token;
      try { token = await this.token(); }
      catch { throw new CloudReceiptError('请先在 Mailbox 使用管理员账号登录。', 401); }
      if (!token) throw new CloudReceiptError('请先在 Mailbox 使用管理员账号登录。', 401);
      const url = new URL(this.endpoint); url.searchParams.set('action', action);
      for (const [key, value] of Object.entries(query)) if (value) url.searchParams.set(key, value);
      const response = await this.fetcher(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', credentials: 'omit', signal: controller.signal });
      let value;
      try { value = await response.json(); } catch { throw new CloudReceiptError('云端返回未能确认，请刷新核对收据记录。'); }
      if (!response.ok || value?.ok !== true) {
        const safe = typeof value?.error === 'string' && value.error.length < 300 ? value.error : '云端收据操作未确认，请重新核对。';
        throw new CloudReceiptError(safe, response.status);
      }
      return value;
    } catch (error) {
      if (error instanceof CloudReceiptError) throw error;
      throw new CloudReceiptError('云端收据操作未确认，请检查网络后重试同一次操作，或刷新核对记录。');
    } finally { clearTimeout(timer); }
  }
  async list() {
    const receipts = [], seen = new Set(); let cursor = '';
    do {
      const page = await this.request('list', null, { cursor });
      if (!Array.isArray(page.receipts) || typeof page.cursor !== 'string') throw new CloudReceiptError('云端收据列表格式不正确。');
      receipts.push(...page.receipts.map(confirmedReceipt)); cursor = page.cursor;
      if (cursor && seen.has(cursor)) throw new CloudReceiptError('收据分页未完成，请稍后刷新。');
      seen.add(cursor);
    } while (cursor);
    return receipts;
  }
  async get(id) { return confirmedReceipt((await this.request('get', null, { id })).receipt); }
  async mutate(action, body) { return confirmedReceipt((await this.request(action, body)).receipt); }
}
