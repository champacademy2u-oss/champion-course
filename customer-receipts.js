import { COMPANY, MAX_ITEMS, displayDate, documentInfo, documentType, draftInput, editableInput, matchesReceipt, money, newDraft, recordForPreview } from './customer-receipts-core.js';
import { CloudReceipts } from './customer-receipts-client.js';
import { pageSvg, receiptLayout, receiptPdf } from './customer-receipts-document.js';
import { LOGO_DATA, SIGNATURE_DATA } from './customer-receipts-brand.js';

const root = document.getElementById('customerReceiptsView');
const $ = selector => root.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const labels = { draft: '草稿', issued: '已签发', void: '已作废' };
const cloud = new CloudReceipts(window.CUSTOMER_RECEIPTS_CONFIG?.apiBaseUrl || '', async () => {
  if (typeof zoomFirebaseAdminToken !== 'function') throw new Error('请先在 Mailbox 使用管理员账号登录。');
  return zoomFirebaseAdminToken();
});
const state = { mounted: false, loaded: false, loading: false, busy: false, receipts: [], query: '', filter: 'all', typeFilter: 'all', record: null, input: null, original: '', pending: null, preview: null, signatureData: SIGNATURE_DATA || '' };
function message(value, error = false) { const node = $('#crNotice'); node.textContent = value; node.hidden = !value; node.classList.toggle('cr-error', error); }
function dialogMessage(value, error = false) { const node = $('#crDialogStatus'); node.textContent = value; node.classList.toggle('cr-error', error); }
function safeError(error) { return typeof error?.message === 'string' && error.message.length < 300 ? error.message : '操作未确认，请刷新核对收据记录。'; }
function mount() {
  if (state.mounted || !root) return;
  state.mounted = true; root.classList.add('customer-receipts');
  root.innerHTML = `
    <div class="cr-heading"><div><p class="cr-kicker">CHAMP ACADEMY · BILLING</p><h3>Invoice / Original Receipt</h3><p class="cr-muted">选择单据类型，系统自动编号，并保留 Champ Academy 的公司资料。</p></div><button class="text-button primary" data-cr="new" id="crNew" disabled>＋ 新增客户单据</button></div>
    <div class="cr-company"><span class="cr-company-icon" aria-hidden="true">▤</span><div><strong>${escape(COMPANY.name)} · ${escape(COMPANY.registration)}</strong><p>Tel: ${escape(COMPANY.phone)}　 Email: ${escape(COMPANY.email)}</p></div><span class="cr-template-tag">固定公司资料</span></div>
    <div class="cr-signature-setting"><div><strong>金色签名</strong><span id="crSignatureStatus">待加入原签名图片</span></div><button type="button" class="text-button" data-cr="signature">选择签名原图</button><input id="crSignatureFile" type="file" accept="image/png,image/jpeg,image/webp" hidden></div>
    <p id="crNotice" class="cr-notice" role="status" aria-live="polite" hidden></p>
    <div id="crMetrics" class="cr-metrics"></div>
    <div class="cr-panel"><div class="cr-toolbar"><label><span class="cr-sr">搜索单据</span><input id="crSearch" type="search" placeholder="搜索客户、单据号码或课程" autocomplete="off"></label><label><span class="cr-sr">单据类型</span><select id="crTypeFilter"><option value="all">全部类型</option><option value="invoice">Invoice</option><option value="receipt">Original Receipt</option></select></label><label><span class="cr-sr">单据状态</span><select id="crFilter"><option value="all">全部状态</option><option value="draft">草稿</option><option value="issued">已签发</option><option value="void">已作废</option></select></label><button class="text-button" data-cr="refresh">刷新</button></div>
      <div class="cr-table-wrap"><table><thead><tr><th>单据类型 / 编号 / 客户</th><th>日期</th><th>金额（RM）</th><th>状态</th><th>操作</th></tr></thead><tbody id="crRows"></tbody></table></div><p id="crCount" class="cr-count"></p></div>
    <dialog id="crDialog" class="cr-dialog" aria-labelledby="crDialogTitle" aria-describedby="crDialogStatus"><div class="cr-dialog-heading"><div><p class="cr-kicker" id="crDocumentKicker">ORIGINAL RECEIPT</p><h3 id="crDialogTitle">新增客户单据</h3></div><button type="button" class="text-button" data-cr="close" aria-label="关闭单据窗口">✕</button></div>
      <div class="cr-editor-layout"><form id="crForm" novalidate><div id="crReadonly" class="cr-readonly" hidden></div><fieldset id="crFields"><legend class="cr-sr">客户与单据内容</legend><div class="cr-fields"><label>单据类型<select id="crDocumentType"><option value="receipt">Original Receipt</option><option value="invoice">Invoice</option></select></label><div class="cr-auto-number"><span>系统自动编号</span><strong id="crNumber">签发时自动生成</strong></div><label class="cr-span">Bill to · 客户 / 公司名称<input id="crCustomer" maxlength="200" required autocomplete="off" placeholder="填写客户或公司名称"></label><label class="cr-span">客户补充资料（选填）<textarea id="crCustomerDetails" rows="2" maxlength="400" placeholder="公司地址或其他需显示在单据上的资料"></textarea></label><label>单据日期<input id="crDate" type="date" required></label></div>
      <div class="cr-items-heading"><strong id="crItemLabel">收款内容</strong><small id="crAmountHint">金额为本次已收款项</small></div><div id="crItems"></div><div class="cr-item-actions"><button class="text-button" type="button" data-cr="add">＋ 开单项目</button><button class="text-button" type="button" data-cr="note">＋ 课程说明行</button></div><p class="cr-help">数量 × 单价自动合计。不计金额的说明行保留原模板「-」显示。</p><label class="cr-prepared">Prepared by · 经办人（选填）<input id="crPreparedBy" maxlength="120" autocomplete="off"></label></fieldset><div class="cr-total"><span id="crTotalLabel">本次已收款总额</span><strong id="crTotal">RM 0.00</strong></div><p id="crDialogStatus" role="status" aria-live="polite"></p><div id="crRecovery" class="cr-recovery" hidden><button type="button" class="text-button" data-cr="retry">重试同一次操作</button><button type="button" class="text-button" data-cr="reconcile">核对云端记录</button></div><div class="cr-dialog-actions"><button type="button" class="text-button" data-cr="close">关闭</button><button type="button" class="text-button" data-cr="pdf" id="crPdf">下载草稿 PDF</button><button type="submit" class="text-button" id="crSave">保存草稿</button><button type="button" class="text-button primary" data-cr="issue" id="crIssue">签发单据</button><button type="button" class="text-button cr-danger" data-cr="void" id="crVoid" hidden>作废单据</button></div></form><aside class="cr-preview"><div class="cr-preview-heading"><strong>单据预览</strong><span>A4 · PDF</span></div><div id="crPreview"></div></aside></div></dialog>`;
  if (state.signatureData) $('#crSignatureStatus').textContent = '已配置默认金色签名 · Invoice 和 Original Receipt 自动使用';
  $('#crSearch').addEventListener('input', event => { state.query = event.target.value; renderList(); });
  $('#crFilter').addEventListener('change', event => { state.filter = event.target.value; renderList(); });
  $('#crTypeFilter').addEventListener('change', event => { state.typeFilter = event.target.value; renderList(); });
  $('#crDocumentType').addEventListener('change', () => { syncInput(); renderPreview(); });
  $('#crSignatureFile').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) throw new Error('请选择 1 MB 以内的 PNG、JPG 或 WebP 原签名图片。');
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('签名图片未能读取，请重新选择。')); reader.readAsDataURL(file); });
      await setSignature(data);
    } catch (error) { message(safeError(error), true); }
    finally { event.target.value = ''; }
  });
  $('#crForm').addEventListener('submit', async event => { event.preventDefault(); await saveDraft(); });
  $('#crForm').addEventListener('input', event => { if (!state.busy && !state.pending && state.input && state.record?.status !== 'issued' && state.record?.status !== 'void') { syncInput(); renderPreview(); } });
  $('#crDialog').addEventListener('cancel', event => { event.preventDefault(); close(); });
  root.addEventListener('click', async event => {
    const action = event.target.closest('[data-cr]');
    if (!action || action.disabled || state.busy) return;
    try {
      const kind = action.dataset.cr;
      if (kind === 'new') openNew();
      if (kind === 'refresh') await load();
      if (kind === 'signature') $('#crSignatureFile').click();
      if (kind === 'open') await openRecord(action.dataset.id);
      if (kind === 'close') close();
      if (kind === 'add' || kind === 'note') addItem(kind === 'note');
      if (kind === 'remove') removeItem(Number(action.dataset.index));
      if (kind === 'issue') await issue();
      if (kind === 'void') await voidReceipt();
      if (kind === 'pdf') await download();
      if (kind === 'retry' && state.pending) await mutation(state.pending.action, state.pending.body);
      if (kind === 'reconcile') await reconcile();
    } catch (error) { dialogMessage(safeError(error), true); }
  });
}
function renderList() {
  const records = state.receipts.filter(record => matchesReceipt(record, state.query, state.filter, state.typeFilter)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const issued = state.receipts.filter(record => record.status === 'issued');
  const sum = type => money(issued.filter(record => documentType(record.type) === type).reduce((total, record) => total + record.totalCents, 0));
  $('#crMetrics').innerHTML = `<div><span>Original Receipt · 已收款</span><strong>RM ${sum('receipt')}</strong></div><div><span>Invoice · 开单金额</span><strong>RM ${sum('invoice')}</strong></div><div><span>待签发草稿</span><strong>${state.receipts.filter(record => record.status === 'draft').length}</strong></div>`;
  $('#crRows').innerHTML = state.loading ? '<tr><td colspan="5" class="cr-empty">正在读取云端单据…</td></tr>' : !state.loaded ? '<tr><td colspan="5" class="cr-empty">云端尚未连接。请使用现有管理员账号登录后刷新。</td></tr>' : !records.length ? `<tr><td colspan="5" class="cr-empty"><strong>${state.query || state.filter !== 'all' || state.typeFilter !== 'all' ? '没有符合条件的单据' : '新增第一张客户单据'}</strong><span>${state.query || state.filter !== 'all' || state.typeFilter !== 'all' ? '试试其他关键词、类型或状态。' : '保留固定公司资料，只需填写客户与开单内容。'}</span></td></tr>` : records.map(record => `<tr><td><strong>${escape(documentInfo(record.type).label)}</strong><span class="cr-customer-name">${escape(record.number || '未签发草稿')}</span><span class="cr-customer-name">${escape(record.customer)}</span></td><td>${escape(displayDate(record.date))}</td><td class="cr-money">${money(record.totalCents)}</td><td><span class="cr-status cr-status-${escape(record.status)}">${escape(labels[record.status] || record.status)}</span></td><td><button type="button" class="text-button" data-cr="open" data-id="${escape(record.id)}">${record.status === 'draft' ? '编辑 / 预览' : '查看 / 下载'}</button></td></tr>`).join('');
  $('#crCount').textContent = state.loaded ? `共 ${records.length} 张 · Invoice 与 Original Receipt 分别统计 · 仅管理员可读取` : '';
  $('#crNew').disabled = !state.loaded || state.loading;
}
async function load() {
  if (state.loading || state.busy) return;
  state.loading = true; state.loaded = false; renderList(); message('');
  try { state.receipts = await cloud.list(); state.loaded = true; }
  catch (error) { state.receipts = []; message(safeError(error), true); }
  finally { state.loading = false; renderList(); }
}
function formInput() {
  return { type: $('#crDocumentType').value, customer: $('#crCustomer').value, customerDetails: $('#crCustomerDetails').value, date: $('#crDate').value, preparedBy: $('#crPreparedBy').value,
    items: [...$('#crItems').querySelectorAll('[data-cr-item]')].map(row => ({ description: row.querySelector('[data-cr-field="description"]').value, qty: row.querySelector('[data-cr-field="qty"]').value, unitPrice: row.querySelector('[data-cr-field="unitPrice"]').value })) };
}
function syncInput() { state.input = formInput(); }
function fillForm() {
  const input = state.input;
  for (const [id, key] of [['crDocumentType', 'type'], ['crCustomer', 'customer'], ['crCustomerDetails', 'customerDetails'], ['crDate', 'date'], ['crPreparedBy', 'preparedBy']]) $('#' + id).value = input[key] || '';
  renderItems(); renderPreview(); setBusy(state.busy);
}
function renderItems() {
  $('#crItems').innerHTML = state.input.items.map((item, index) => `<div class="cr-item" data-cr-item><label class="cr-item-description">内容<textarea rows="2" maxlength="400" data-cr-field="description" aria-label="第 ${index + 1} 项内容" required>${escape(item.description)}</textarea></label><label>数量<input inputmode="numeric" data-cr-field="qty" value="${escape(item.qty)}" aria-label="第 ${index + 1} 项数量" maxlength="3"></label><label>单价（RM）<input inputmode="decimal" data-cr-field="unitPrice" value="${escape(item.unitPrice)}" aria-label="第 ${index + 1} 项单价" maxlength="11"></label><button class="cr-remove" type="button" data-cr="remove" data-index="${index}" aria-label="移除第 ${index + 1} 项" ${state.input.items.length === 1 ? 'disabled' : ''}>×</button></div>`).join('');
}
function renderPreview() {
  let record;
  const info = documentInfo(state.input?.type || state.record?.type);
  $('#crDocumentKicker').textContent = info.title; $('#crItemLabel').textContent = info.itemLabel; $('#crAmountHint').textContent = info.amountHint; $('#crTotalLabel').textContent = info.totalLabel;
  $('#crNumber').textContent = state.record?.number || `${info.prefix}-${state.input?.date?.slice(0, 4) || 'YYYY'}-自动流水号`;
  $('#crIssue').textContent = '签发 ' + info.label;
  try {
    record = state.record?.status !== 'draft' && state.record ? state.record : { ...recordForPreview(state.input), id: state.record?.id || '', company: state.record?.company || COMPANY };
    state.preview = record;
    $('#crTotal').textContent = 'RM ' + money(record.totalCents);
    $('#crPreview').innerHTML = receiptLayout(record).pages.map(page => `<div class="cr-paper">${pageSvg(page, LOGO_DATA, state.signatureData)}</div>`).join('');
  } catch (error) {
    state.preview = null; $('#crTotal').textContent = '—';
    $('#crPreview').innerHTML = `<div class="cr-preview-empty"><strong>填写后生成收据预览</strong><p>${escape(safeError(error))}</p></div>`;
  }
  $('#crPdf').disabled = !state.preview || state.busy || !!state.pending;
}
function updateRecord(record) {
  state.record = record; state.input = editableInput(record); state.original = JSON.stringify(state.input);
  const index = state.receipts.findIndex(item => item.id === record.id);
  if (index < 0) state.receipts.push(record); else state.receipts[index] = record;
  fillForm(); renderList();
}
function setBusy(value) {
  state.busy = value;
  const immutable = state.record && state.record.status !== 'draft', blocked = value || !!state.pending;
  $('#crFields').disabled = blocked || immutable;
  for (const button of $('#crDialog').querySelectorAll('button')) button.disabled = value;
  $('#crSave').hidden = !!immutable; $('#crIssue').hidden = !!immutable; $('#crVoid').hidden = state.record?.status !== 'issued';
  $('#crSave').disabled = blocked; $('#crIssue').disabled = blocked;
  $('#crVoid').disabled = blocked;
  $('#crPdf').textContent = !state.record || state.record.status === 'draft' ? '下载草稿 PDF' : '下载 ' + documentInfo(state.record.type).label;
  $('#crPdf').disabled = blocked || !state.preview;
  $('#crRecovery').hidden = !state.pending;
  for (const button of $('#crDialog').querySelectorAll('[data-cr="close"]')) button.disabled = value || !!state.pending;
  $('#crReadonly').hidden = !immutable;
  $('#crReadonly').textContent = state.record?.status === 'void' ? '此单据已作废：' + state.record.voidReason : immutable ? '此单据已签发，公司资料、内容及编号已固定。如有错误，请作废后另开单据。' : '';
  if (!blocked && !immutable) { for (const button of $('#crItems').querySelectorAll('[data-cr="remove"]')) button.disabled = state.input?.items.length === 1; }
}
function openNew() {
  state.record = null; state.pending = null; state.input = newDraft(); state.original = JSON.stringify(state.input);
  $('#crDialogTitle').textContent = '新增客户单据'; dialogMessage(''); fillForm(); $('#crDialog').showModal(); $('#crCustomer').focus();
}
async function openRecord(id) {
  state.record = null; state.input = null; state.pending = null;
  setBusy(true); message('正在读取最新收据…');
  try { const record = await cloud.get(id); updateRecord(record); $('#crDialogTitle').textContent = record.number || '编辑收据草稿'; dialogMessage(''); message(''); $('#crDialog').showModal(); }
  catch (error) { message(safeError(error), true); }
  finally { setBusy(false); }
}
function close() {
  if (state.busy || state.pending) return;
  if ((!state.record || state.record.status === 'draft') && JSON.stringify(formInput()) !== state.original && !window.confirm('本次修改尚未保存。关闭并放弃这些修改？')) return;
  $('#crDialog').close(); state.record = null; state.input = null; state.preview = null; $('#crPreview').innerHTML = ''; $('#crItems').innerHTML = '';
  for (const id of ['crCustomer', 'crCustomerDetails', 'crDate', 'crPreparedBy']) $('#' + id).value = '';
}
function addItem(note) {
  if (!state.input || state.pending || state.record && state.record.status !== 'draft') return;
  syncInput();
  if (state.input.items.length >= MAX_ITEMS) { dialogMessage(`每张收据最多 ${MAX_ITEMS} 项。`, true); return; }
  state.input.items.push({ description: '', qty: note ? '' : '1', unitPrice: '' }); renderItems(); renderPreview();
}
function removeItem(index) { if (state.input.items.length < 2 || state.pending) return; syncInput(); state.input.items.splice(index, 1); renderItems(); renderPreview(); }
async function mutation(action, body) {
  state.pending = { action, body }; setBusy(true); dialogMessage(action === 'save' ? '正在保存草稿…' : action === 'issue' ? '正在签发收据…' : '正在作废收据…');
  try {
    const record = await cloud.mutate(action, body); state.pending = null; updateRecord(record);
    $('#crDialogTitle').textContent = record.number || '编辑单据草稿';
    dialogMessage(action === 'save' ? '草稿已保存到云端。' : action === 'issue' ? `${documentInfo(record.type).label} ${record.number} 已签发，可下载 PDF。` : '单据已作废，原号码及记录保留。');
    return record;
  } catch (error) {
    if (error.status >= 400 && error.status < 500) state.pending = null;
    dialogMessage(safeError(error) + (state.pending ? ' 本次操作编号已保留，请先重试或核对。' : ''), true);
    return null;
  } finally { setBusy(false); }
}
function bodyFor(input) {
  if (!state.record) state.record = { id: crypto.randomUUID(), status: 'draft', revision: 0 };
  return { id: state.record.id, revision: state.record.revision, operationId: crypto.randomUUID(), ...(input ? { input } : {}) };
}
async function saveDraft() {
  if (state.busy || state.pending || state.record && state.record.status !== 'draft') return null;
  try { syncInput(); draftInput(state.input); return await mutation('save', bodyFor(state.input)); }
  catch (error) { dialogMessage(safeError(error), true); return null; }
}
async function issue() {
  if (state.busy || state.pending || state.record && state.record.status !== 'draft') return;
  syncInput();
  let fields;
  try { fields = draftInput(state.input); if (fields.totalCents <= 0) throw new Error(fields.type === 'invoice' ? '请填写有效的开单金额。' : '请填写本次实际收到的金额。'); }
  catch (error) { dialogMessage(safeError(error), true); return; }
  if (!window.confirm(`签发给「${fields.customer}」的 ${documentInfo(fields.type).label}，金额 RM ${money(fields.totalCents)}？系统将自动编号，签发后内容及号码固定。`)) return;
  const record = await saveDraft(); if (record) await mutation('issue', bodyFor());
}
async function voidReceipt() {
  if (state.record?.status !== 'issued' || state.pending) return;
  const reason = window.prompt(`作废 ${state.record.number}，原记录及号码将保留。请输入作废原因：`);
  if (reason === null) return;
  if (!reason.trim() || reason.trim().length > 300) { dialogMessage('请填写 1 至 300 字的作废原因。', true); return; }
  await mutation('void', { ...bodyFor(), reason });
}
async function reconcile() {
  if (!state.pending || state.busy) return;
  setBusy(true);
  try { const record = await cloud.get(state.pending.body.id); state.pending = null; updateRecord(record); dialogMessage('已从云端重新核对，请检查当前状态和内容。'); }
  catch (error) { dialogMessage(safeError(error) + ' 可重试同一次操作；不要另开重复收据。', true); }
  finally { setBusy(false); }
}
async function download() {
  if (state.busy || state.pending || !state.preview) return;
  setBusy(true); dialogMessage('正在生成 PDF…');
  try {
    let record;
    if (state.record?.revision > 0 && state.record.status !== 'draft') { record = await cloud.get(state.record.id); updateRecord(record); }
    else { syncInput(); record = recordForPreview(state.input); }
    const pdf = await receiptPdf(record, { logoData: LOGO_DATA, signatureData: state.signatureData, jsPDF: window.jspdf?.jsPDF });
    const prefix = record.status === 'draft' ? 'DRAFT-' : record.status === 'void' ? 'VOID-' : '';
    const file = `${prefix}${record.number || 'Champ-' + documentInfo(record.type).prefix}`.replace(/[^A-Za-z0-9._-]/g, '_') + '.pdf';
    const url = URL.createObjectURL(pdf.output('blob')), anchor = document.createElement('a');
    anchor.href = url; anchor.download = file; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    dialogMessage(record.status === 'draft' ? '已生成带 DRAFT 水印的草稿 PDF，尚未签发。' : record.status === 'void' ? '已生成带 VOID 水印的作废收据 PDF。' : 'PDF 已生成，请在浏览器下载记录中查看。');
  } catch (error) { dialogMessage(safeError(error), true); }
  finally { setBusy(false); }
}
async function open() { mount(); if (root && !state.loaded && !state.loading) await load(); }
async function setSignature(data) {
  mount();
  if (state.busy || state.pending) throw new Error('请等待当前单据操作完成后加入签名。');
  if (typeof data !== 'string' || data.length > 1500000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) throw new Error('请使用原签名的 PNG、JPG 或 WebP 图片。');
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('签名图片格式不正确，未加入单据。')); image.src = data; });
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16000000) throw new Error('签名图片尺寸过大，请使用清晰的签名局部原图。');
  state.signatureData = data;
  $('#crSignatureStatus').textContent = '已加入本次浏览器预览和 PDF（原图比例保留）';
  if (state.input) renderPreview();
}
if (root) {
  window.CustomerReceipts = Object.freeze({ open, setSignature });
  if (location.hash === '#customer-receipts') { window.switchView?.('customerReceipts'); open(); }
}
