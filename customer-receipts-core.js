// Shared receipt rules. Company information comes from the owner's receipt template.
export const TEMPLATE_ID = 'champ-official-receipt-20261120';
export const COMPANY = Object.freeze({
  brand: 'Champ Academy',
  name: 'Champ Social Media Marketing Sdn Bhd',
  registration: '1269957-T',
  phone: '010-7790001',
  email: 'ryanlim.champ@gmail.com'
});
export const MAX_ITEMS = 12;
export const MAX_TOTAL_CENTS = 999999999;
export const DOCUMENT_TYPES = Object.freeze({
  receipt: Object.freeze({ label: 'Original Receipt', title: 'ORIGINAL RECEIPT', prefix: 'OR', numberLabel: 'Receipt No :', itemLabel: '收款内容', amountHint: '金额为本次已收款项', totalLabel: '本次已收款总额' }),
  invoice: Object.freeze({ label: 'Invoice', title: 'INVOICE', prefix: 'INV', numberLabel: 'Invoice No :', itemLabel: '开单内容', amountHint: '填写本次开单金额', totalLabel: '本次开单总额' })
});
export class ReceiptError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const fail = (message, status) => { throw new ReceiptError(message, status); };
export function documentType(value) {
  const type = value === undefined || value === '' ? 'receipt' : value;
  if (typeof type !== 'string' || !Object.hasOwn(DOCUMENT_TYPES, type)) fail('请选择 Invoice 或 Original Receipt。');
  return type;
}
export const documentInfo = value => DOCUMENT_TYPES[documentType(value)];
export const validId = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
export function cleanText(value, max, label, required = false) {
  if (typeof value !== 'string') fail(`${label}格式不正确。`);
  const text = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if ((required && !text) || text.length > max) fail(`${label}${required ? '不能为空，且' : ''}最多 ${max} 字。`);
  return text;
}
export function cents(value, label = '金额') {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(text)) fail(`${label}请填写非负数，最多两位小数，不含逗号。`);
  const [whole, fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount > MAX_TOTAL_CENTS) fail(`${label}过大。`);
  return amount;
}
export const amountInput = value => (Number(value) / 100).toFixed(2);
export const money = value => (Number(value) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function validDate(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function malaysiaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = name => parts.find(value => value.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export const displayDate = value => validDate(value) ? value.split('-').reverse().join('/') : '—';
export function receiptNumber(value) {
  const number = cleanText(value ?? '', 50, '收据号码').toUpperCase();
  if (number && !/^[A-Z0-9][A-Z0-9._\/-]{0,49}$/.test(number)) fail('收据号码只可使用英文字母、数字、点、横线、下划线及斜线。');
  return number;
}
export function draftInput(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') fail('收据资料格式不正确。');
  const type = documentType(input.type);
  const customer = cleanText(input.customer ?? '', 200, 'Bill to', true).replace(/\s+/g, ' ');
  const customerDetails = cleanText(input.customerDetails ?? '', 400, '客户补充资料');
  if (customerDetails.split('\n').length > 6) fail('客户补充资料最多填写 6 行。');
  const date = input.date;
  if (!validDate(date)) fail('请选择正确的收据日期。');
  const preparedBy = cleanText(input.preparedBy ?? '', 120, 'Prepared by').replace(/\s+/g, ' ');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > MAX_ITEMS) fail(`请填写 1 至 ${MAX_ITEMS} 项收款内容。`);
  let totalCents = 0;
  const items = input.items.map((item, index) => {
    if (!item || Array.isArray(item) || typeof item !== 'object') fail('项目格式不正确。');
    const description = cleanText(item.description ?? '', 400, `第 ${index + 1} 项内容`, true);
    if (description.split('\n').length > 8) fail(`第 ${index + 1} 项内容最多填写 8 行，可新增说明行。`);
    const rawPrice = String(item.unitPrice ?? '').trim();
    if (rawPrice === '') {
      if (String(item.qty ?? '').trim() !== '') fail('不计金额的课程说明请留空数量。');
      return { description, qty: null, unitCents: null, amountCents: null };
    }
    const rawQty = String(item.qty ?? '').trim();
    if (!/^[1-9]\d{0,2}$/.test(rawQty)) fail(`第 ${index + 1} 项数量须为 1 至 999 的整数。`);
    const qty = Number(rawQty), unitCents = cents(rawPrice, `第 ${index + 1} 项单价`), amountCents = qty * unitCents;
    totalCents += amountCents;
    if (!Number.isSafeInteger(totalCents) || totalCents > MAX_TOTAL_CENTS) fail('收据总金额过大。');
    return { description, qty, unitCents, amountCents };
  });
  return { type, customer, customerDetails, date, preparedBy, items, totalCents };
}
export function editableInput(record) {
  return {
    type: documentType(record.type), customer: record.customer, customerDetails: record.customerDetails || '', date: record.date,
    preparedBy: record.preparedBy || '',
    items: record.items.map(item => ({ description: item.description, qty: item.qty === null ? '' : String(item.qty), unitPrice: item.unitCents === null ? '' : amountInput(item.unitCents) }))
  };
}
export function newDraft(now = new Date()) {
  return { type: 'receipt', customer: '', customerDetails: '', date: malaysiaToday(now), preparedBy: '', items: [{ description: '', qty: '1', unitPrice: '' }] };
}
export function recordForPreview(input) {
  return { ...draftInput(input), id: '', number: '', status: 'draft', company: { ...COMPANY }, templateId: TEMPLATE_ID, revision: 0 };
}
export function matchesReceipt(record, query, status = 'all', type = 'all') {
  const text = String(query || '').trim().toLocaleLowerCase();
  return (status === 'all' || record.status === status) && (type === 'all' || documentType(record.type) === type) && (!text || [documentInfo(record.type).label, record.number, record.customer, ...record.items.map(item => item.description)].join('\n').toLocaleLowerCase().includes(text));
}
