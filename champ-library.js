import { ACCEPT, DEFAULT_CATEGORIES, MAX_BATCH, filterFiles, formatBytes, metadata, text, validateCategories } from './champ-library-core.js';
import { CloudLibrary, LocalLibrary } from './champ-library-store.js?v=20261113-upload-check';

const root = document.querySelector('#champLibraryView');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const kinds = { video: '视频', image: '照片', pdf: 'PDF' };
const glyphs = { video: '▶', image: '▧', pdf: 'PDF' };
const date = value => new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' });
const endpoint = window.CHAMP_LIBRARY_CONFIG?.apiBaseUrl || '';
const local = new LocalLibrary();
const cloud = new CloudLibrary(endpoint, async () => {
  if (typeof zoomFirebaseAdminToken !== 'function') throw new Error('请先在 Mailbox 使用管理员账号登录。');
  return zoomFirebaseAdminToken();
});
let preferredMode;
try { preferredMode = localStorage.getItem('champ_library_mode'); } catch {}
const state = {
  mode: endpoint && preferredMode !== 'local' ? 'cloud' : 'local', files: [],
  categories: structuredClone(DEFAULT_CATEGORIES), categoryRevision: 0,
  category: 'all', kind: 'all', query: '', sort: 'newest', trash: false,
  initialized: false, loaded: false, loading: false, busy: false, failed: false,
  selected: [], editId: '', previewUrl: '', previewToken: 0, loadToken: 0
};
const store = () => state.mode === 'cloud' ? cloud : local;
const $ = selector => root.querySelector(selector);
function notice(message, error = false) {
  const box = $('#clNotice'); box.textContent = message; box.hidden = !message;
  box.classList.toggle('cl-error', error); box.setAttribute('role', error ? 'alert' : 'status');
}
function categoryOptions(selected) {
  return state.categories.map(category => `<option value="${escape(category.id)}" ${selected === category.id ? 'selected' : ''}>${escape(category.name)}</option>`).join('');
}
function mount() {
  if (state.initialized || !root) return;
  state.initialized = true;
  root.classList.add('champ-library');
  root.innerHTML = `
    <div class="cl-heading"><div><p class="cl-kicker">CHAMP ACADEMY · MATERIALS</p><h3>让好资料，随时找得到。</h3><p class="cl-muted">集中整理课程教材、营销素材与品牌文件。</p></div>
      <div class="cl-heading-actions"><button class="text-button" data-cl="categories">管理分类</button><button class="text-button primary" data-cl="upload">＋ 上传资料</button></div></div>
    <div class="cl-storage"><div><strong id="clStorageLabel"></strong><p id="clStorageHint"></p></div><div class="cl-mode"><button data-cl-mode="cloud" ${!endpoint ? 'disabled title="云端服务尚未设置"' : ''}>云端资料</button><button data-cl-mode="local">本机资料</button></div></div>
    <div id="clNotice" class="cl-notice" role="status" aria-live="polite" hidden></div>
    <div id="clMetrics" class="cl-metrics"></div>
    <div class="cl-workspace"><aside class="cl-folders"><div class="cl-folder-heading">资料分类 <button class="cl-icon-button" data-cl="categories" aria-label="管理分类">＋</button></div><div id="clCategories"></div></aside>
      <div class="cl-content"><div class="cl-toolbar"><label class="cl-search"><span aria-hidden="true">⌕</span><input id="clQuery" type="search" placeholder="搜索名称、标签或备注" aria-label="搜索资料"></label><select id="clKind" aria-label="资料类型"><option value="all">全部类型</option><option value="video">视频</option><option value="image">照片</option><option value="pdf">PDF</option></select><select id="clSort" aria-label="资料排序"><option value="newest">最新上传</option><option value="name">名称排序</option><option value="size">文件大小</option></select><button class="cl-icon-button" data-cl="refresh" aria-label="刷新资料">↻</button></div>
        <div class="cl-results"><strong id="clResultsTitle">全部资料</strong><span id="clResultsCount"></span></div><div id="clFiles" class="cl-files" aria-live="polite"></div>
        <p class="cl-drop-hint">可拖放文件到这里上传 · 视频最大 1 GB · 照片 / PDF 最大 50 MB</p></div></div>
    <dialog id="clUploadDialog" class="cl-dialog"><form id="clUploadForm"><div class="cl-dialog-head"><div><h3>上传资料</h3><p id="clUploadWhere" class="cl-muted"></p></div><button type="button" class="cl-icon-button" data-cl-close="clUploadDialog" aria-label="关闭上传窗口">×</button></div>
      <label class="cl-dropzone" id="clDropzone"><strong>＋ 选择文件，或拖放到这里</strong><span>视频、照片、PDF · 每批最多 ${MAX_BATCH} 个</span><input id="clFileInput" type="file" accept="${ACCEPT}" multiple aria-label="选择上传文件"></label>
      <div id="clQueue" class="cl-queue"></div><div class="cl-form-grid"><label>分类<select id="clUploadCategory">${categoryOptions('uncategorized')}</select></label><label>标签<input id="clUploadTags" placeholder="例如：Ryan、每周一课（逗号分隔）" maxlength="380"></label></div><label class="cl-field">备注<textarea id="clUploadNotes" rows="2" maxlength="2000" placeholder="资料用途、版本或活动名称"></textarea></label>
      <p id="clUploadStatus" class="cl-form-status" role="status" aria-live="polite"></p><div class="cl-dialog-footer"><button type="button" class="text-button" data-cl-close="clUploadDialog">关闭</button><button id="clSaveFiles" class="text-button primary" type="submit">开始保存</button></div></form></dialog>
    <dialog id="clEditDialog" class="cl-dialog"><form id="clEditForm"><div class="cl-dialog-head"><h3>编辑资料</h3><button type="button" class="cl-icon-button" data-cl-close="clEditDialog" aria-label="关闭编辑窗口">×</button></div><label class="cl-field">资料名称<input id="clEditTitle" maxlength="160" required></label><div class="cl-form-grid"><label>分类<select id="clEditCategory"></select></label><label>标签<input id="clEditTags" maxlength="380" placeholder="用逗号分隔"></label></div><label class="cl-field">备注<textarea id="clEditNotes" rows="3" maxlength="2000"></textarea></label><p id="clEditStatus" class="cl-form-status" role="status"></p><div class="cl-dialog-footer"><button type="button" class="text-button" data-cl-close="clEditDialog">取消</button><button class="text-button primary" type="submit">保存修改</button></div></form></dialog>
    <dialog id="clCategoriesDialog" class="cl-dialog"><form id="clCategoriesForm"><div class="cl-dialog-head"><div><h3>管理分类</h3><p class="cl-muted">可修改名称或新增分类；资料会保留原有归属。</p></div><button type="button" class="cl-icon-button" data-cl-close="clCategoriesDialog" aria-label="关闭分类窗口">×</button></div><div id="clCategoryFields" class="cl-category-fields"></div><label class="cl-field">新增分类<input id="clNewCategory" maxlength="40" placeholder="例如：无限杠杆 · 课件"></label><p id="clCategoryStatus" class="cl-form-status" role="status"></p><div class="cl-dialog-footer"><button type="button" class="text-button" data-cl-close="clCategoriesDialog">取消</button><button type="submit" class="text-button primary">保存分类</button></div></form></dialog>
    <dialog id="clPreviewDialog" class="cl-dialog cl-preview-dialog"><div class="cl-dialog-head"><div><h3 id="clPreviewTitle"></h3><p id="clPreviewInfo" class="cl-muted"></p></div><button class="cl-icon-button" data-cl-close="clPreviewDialog" aria-label="关闭预览">×</button></div><div id="clPreviewBody" class="cl-preview-body"></div><p id="clPreviewNotes" class="cl-preview-notes"></p><div class="cl-dialog-footer"><button class="text-button primary" data-cl="preview-download">下载原文件</button></div></dialog>`;
  root.addEventListener('click', onClick);
  $('#clQuery').addEventListener('input', event => { state.query = event.target.value; renderFiles(); });
  $('#clKind').addEventListener('change', event => { state.kind = event.target.value; renderFiles(); });
  $('#clSort').addEventListener('change', event => { state.sort = event.target.value; renderFiles(); });
  $('#clFileInput').addEventListener('change', event => selectFiles([...event.target.files]));
  $('#clUploadForm').addEventListener('submit', upload);
  $('#clEditForm').addEventListener('submit', saveEdit);
  $('#clCategoriesForm').addEventListener('submit', saveCategories);
  root.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); root.classList.add('cl-dragover'); } });
  root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget)) root.classList.remove('cl-dragover'); });
  root.addEventListener('drop', event => {
    event.preventDefault(); root.classList.remove('cl-dragover');
    if (state.busy || !state.loaded) return;
    if (event.dataTransfer.files.length) { showUpload(); selectFiles([...event.dataTransfer.files]); }
  });
  for (const dialog of root.querySelectorAll('dialog')) dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
  $('#clPreviewDialog').addEventListener('close', clearPreview);
  window.addEventListener('beforeunload', event => { if (state.busy) { event.preventDefault(); event.returnValue = ''; } });
}
function render() {
  const active = state.files.filter(file => !file.trashedAt && file.status === 'ready');
  const localMode = state.mode === 'local';
  $('#clStorageLabel').textContent = localMode ? '◉ 本机资料 · 仅当前浏览器' : '◉ 云端资料 · 管理员专用';
  $('#clStorageHint').textContent = localMode ? '原文件保存在这台设备的浏览器中；清除网站资料会移除文件，请保留原件。' : '原文件保存到云端；其他设备使用同一管理员账号登录后查看。';
  root.querySelectorAll('[data-cl-mode]').forEach(button => { button.classList.toggle('active', button.dataset.clMode === state.mode); button.disabled = state.busy || state.loading || (button.dataset.clMode === 'cloud' && !endpoint); });
  root.querySelectorAll('[data-cl="upload"], [data-cl="categories"]').forEach(button => { button.disabled = state.busy || !state.loaded; });
  $('#clMetrics').innerHTML = [[active.length, '全部资料'], ...Object.entries(kinds).map(([kind, label]) => [active.filter(file => file.kind === kind).length, label]), [formatBytes(active.reduce((sum, file) => sum + file.size, 0)), '资料大小']].map(([value, label]) => `<div><strong>${escape(value)}</strong><span>${label}</span></div>`).join('');
  const items = [{ id: 'all', name: '全部资料' }, ...state.categories];
  $('#clCategories').innerHTML = items.map(category => `<button class="cl-folder ${!state.trash && state.category === category.id ? 'active' : ''}" data-cl-category="${escape(category.id)}"><span>▱ ${escape(category.name)}</span><small>${category.id === 'all' ? active.length : active.filter(file => file.categoryId === category.id).length}</small></button>`).join('') + `<button class="cl-folder cl-trash ${state.trash ? 'active' : ''}" data-cl="trash-view"><span>♲ 回收站</span><small>${state.files.filter(file => file.trashedAt).length}</small></button>`;
  renderFiles();
}
function renderFiles() {
  const files = filterFiles(state.files, state);
  $('#clResultsTitle').textContent = state.trash ? '回收站 · 可随时恢复' : state.categories.find(category => category.id === state.category)?.name || '全部资料';
  $('#clResultsCount').textContent = `${files.length} 份资料`;
  if (state.loading) { $('#clFiles').innerHTML = '<div class="cl-empty">正在读取资料库…</div>'; return; }
  if (state.failed) { $('#clFiles').innerHTML = '<div class="cl-empty"><strong>暂时无法读取资料</strong><span>请刷新重试，或切换资料保存位置。</span><button class="text-button" data-cl="refresh">重试</button></div>'; return; }
  if (!files.length) {
    const filtered = state.query || state.kind !== 'all' || state.category !== 'all';
    $('#clFiles').innerHTML = `<div class="cl-empty"><span class="cl-empty-icon">▱</span><strong>${state.trash ? '回收站是空的' : filtered ? '没有符合条件的资料' : '建立你的 Champ 资料库'}</strong><span>${state.trash ? '移到回收站的资料可以恢复。' : filtered ? '试试其他关键词、类型或分类。' : '把课程视频、照片与 PDF 上传到这里，整理成随手可用的资料。'}</span>${!state.trash && !filtered ? '<button class="text-button primary" data-cl="upload">＋ 上传第一份资料</button>' : ''}</div>`;
    return;
  }
  $('#clFiles').innerHTML = files.map(file => `<article class="cl-card"><button class="cl-card-open" data-cl-preview="${escape(file.id)}" aria-label="预览 ${escape(file.title)}"><div class="cl-file-cover cl-${file.kind}"><span>${glyphs[file.kind]}</span><small>${kinds[file.kind]}</small></div><h4>${escape(file.title)}</h4></button><p class="cl-file-original" title="${escape(file.fileName)}">${escape(file.fileName)}</p><div class="cl-file-meta"><span>${escape(state.categories.find(category => category.id === file.categoryId)?.name || '未分类')}</span><span>${formatBytes(file.size)}</span></div><div class="cl-tags">${file.tags.slice(0, 3).map(tag => `<span>${escape(tag)}</span>`).join('')}${file.tags.length > 3 ? `<span>＋${file.tags.length - 3}</span>` : ''}</div><footer><small>${date(file.createdAt)}</small><div>${state.trash ? `<button data-cl-restore="${escape(file.id)}">恢复</button>` : `<button data-cl-edit="${escape(file.id)}">编辑</button><button data-cl-download="${escape(file.id)}">下载</button><button data-cl-trash="${escape(file.id)}" aria-label="将 ${escape(file.title)} 移到回收站" title="移到回收站">♲</button>`}</div></footer></article>`).join('');
}
async function load() {
  if (state.busy) return;
  const token = ++state.loadToken;
  state.loading = true; state.loaded = false; state.failed = false; render(); notice('');
  try {
    const result = await store().list();
    if (token !== state.loadToken) return;
    state.files = result.files; state.categories = result.categories; state.categoryRevision = result.categoryRevision; state.loaded = true;
  } catch (error) {
    if (token !== state.loadToken) return;
    state.failed = true; state.files = []; notice(error.message, true);
  } finally { if (token === state.loadToken) { state.loading = false; render(); } }
}
function showUpload() {
  if (!state.loaded || state.busy) return;
  const dialog = $('#clUploadDialog');
  if (dialog.open) return;
  state.selected = [];
  $('#clFileInput').value = ''; $('#clQueue').innerHTML = ''; $('#clUploadStatus').textContent = '';
  $('#clUploadCategory').innerHTML = categoryOptions(state.category === 'all' ? 'uncategorized' : state.category);
  $('#clUploadTags').value = ''; $('#clUploadNotes').value = '';
  $('#clUploadWhere').textContent = state.mode === 'cloud' ? '保存到云端资料' : '保存到本机资料 · 仅当前浏览器';
  dialog.showModal();
}
function selectFiles(files) {
  if (state.busy) return;
  if (files.length > MAX_BATCH) { $('#clUploadStatus').textContent = `每批最多 ${MAX_BATCH} 个文件，请重新选择。`; return; }
  state.selected = files.map(file => ({ file, status: '等待保存', done: false }));
  $('#clUploadStatus').textContent = ''; renderQueue();
}
function renderQueue() {
  $('#clQueue').innerHTML = state.selected.map(item => `<div class="cl-queue-row"><span title="${escape(item.file.name)}">${escape(item.file.name)}<small>${formatBytes(item.file.size)}</small></span><strong class="${item.done ? 'cl-saved' : ''}">${escape(item.status)}</strong></div>`).join('');
}
function busy(value) {
  state.busy = value;
  for (const control of root.querySelectorAll('dialog button, dialog input, dialog textarea, dialog select')) control.disabled = value;
  render();
}
async function upload(event) {
  event.preventDefault();
  if (state.busy) return;
  if (!state.selected.length) { $('#clUploadStatus').textContent = '请先选择要保存的文件。'; return; }
  const input = { categoryId: $('#clUploadCategory').value, tags: $('#clUploadTags').value, notes: $('#clUploadNotes').value };
  try { metadata({ title: 'check', ...input }, state.categories); } catch (error) { $('#clUploadStatus').textContent = error.message; return; }
  busy(true);
  let saved = 0, failed = 0;
  try {
    for (const item of state.selected) {
      if (item.done) { saved++; continue; }
      item.status = '正在保存…'; renderQueue();
      try {
        await store().upload(item.file, { title: text(item.file.name.replace(/\.[^.]+$/, ''), 160) || item.file.name, ...input }, percent => { item.status = `上传 ${percent}%`; renderQueue(); });
        item.done = true; item.status = state.mode === 'cloud' ? '已存云端' : '已存本机'; saved++;
      } catch (error) { item.status = error.message; failed++; }
      renderQueue();
    }
  } finally {
    busy(false);
    $('#clUploadStatus').textContent = `已保存 ${saved} / ${state.selected.length} 个文件${failed ? `，${failed} 个未确认保存，请查看各项提示，核对列表后再重试。` : '。'}${state.mode === 'local' ? ' 文件仅在当前浏览器可用。' : ''}`;
    await load();
    if (!state.failed) notice(`已保存 ${saved} 个文件到${state.mode === 'local' ? '本机资料' : '云端资料'}${failed ? `，${failed} 个未确认保存，请核对各项提示。` : '。'}`, failed > 0);
  }
}
function edit(id) {
  const file = state.files.find(item => item.id === id); if (!file) return;
  state.editId = id;
  $('#clEditTitle').value = file.title; $('#clEditCategory').innerHTML = categoryOptions(file.categoryId);
  $('#clEditTags').value = file.tags.join('，'); $('#clEditNotes').value = file.notes;
  $('#clEditStatus').textContent = ''; $('#clEditDialog').showModal();
}
async function saveEdit(event) {
  event.preventDefault(); if (state.busy) return;
  const file = state.files.find(item => item.id === state.editId); if (!file) return;
  busy(true);
  try {
    const patch = metadata({ title: $('#clEditTitle').value, categoryId: $('#clEditCategory').value, tags: $('#clEditTags').value, notes: $('#clEditNotes').value }, state.categories);
    await store().update(file.id, file.revision, patch);
    $('#clEditDialog').close(); busy(false); await load(); notice('资料修改已保存。');
  } catch (error) { $('#clEditStatus').textContent = error.message; } finally { busy(false); }
}
function showCategories() {
  if (!state.loaded || state.busy) return;
  $('#clCategoryFields').innerHTML = state.categories.map(category => `<label>${category.id === 'uncategorized' ? '默认分类' : '分类名称'}<input data-category-id="${escape(category.id)}" value="${escape(category.name)}" maxlength="40" required></label>`).join('');
  $('#clNewCategory').value = ''; $('#clCategoryStatus').textContent = ''; $('#clCategoriesDialog').showModal();
}
async function saveCategories(event) {
  event.preventDefault(); if (state.busy) return;
  busy(true);
  try {
    const items = [...root.querySelectorAll('[data-category-id]')].map(input => ({ id: input.dataset.categoryId, name: input.value }));
    const name = text($('#clNewCategory').value, 40); if (name) items.push({ id: crypto.randomUUID(), name });
    await store().categories(validateCategories(items), state.categoryRevision);
    $('#clCategoriesDialog').close(); busy(false); await load(); notice('资料分类已保存。');
  } catch (error) { $('#clCategoryStatus').textContent = error.message; } finally { busy(false); }
}
async function move(id, action) {
  if (state.busy) return;
  const file = state.files.find(item => item.id === id); if (!file) return;
  busy(true);
  try { await store().update(id, file.revision, { action }); busy(false); await load(); notice(action === 'trash' ? '资料已移到回收站，可随时恢复。' : '资料已恢复。'); }
  catch (error) { notice(error.message, true); } finally { busy(false); }
}
function clearPreview() {
  state.previewToken++;
  $('#clPreviewBody').replaceChildren();
  if (state.previewUrl.startsWith('blob:')) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = '';
}
async function preview(id) {
  const file = state.files.find(item => item.id === id); if (!file) return;
  clearPreview(); const token = state.previewToken;
  $('#clPreviewDialog').dataset.fileId = id;
  $('#clPreviewTitle').textContent = file.title;
  $('#clPreviewInfo').textContent = `${kinds[file.kind]} · ${formatBytes(file.size)} · ${file.fileName}`;
  $('#clPreviewNotes').textContent = file.notes || '';
  $('#clPreviewBody').innerHTML = '<p>正在读取原文件…</p>'; $('#clPreviewDialog').showModal();
  try {
    const url = await store().url(file);
    if (token !== state.previewToken) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
    state.previewUrl = url;
    const body = $('#clPreviewBody'); body.replaceChildren();
    if (['image/heic', 'image/heif'].includes(file.mime)) { body.textContent = 'HEIC / HEIF 已保存。部分浏览器无法直接预览，请下载原文件查看。'; return; }
    const media = document.createElement(file.kind === 'image' ? 'img' : file.kind === 'video' ? 'video' : 'iframe');
    if (file.kind === 'image') media.alt = file.title;
    if (file.kind === 'video') { media.controls = true; media.preload = 'metadata'; }
    if (file.kind === 'pdf') media.title = `${file.title} PDF 预览`;
    media.src = url;
    media.addEventListener('error', () => { body.textContent = '此浏览器无法预览这份文件，请下载原文件查看。'; });
    body.append(media);
  } catch (error) { if (token === state.previewToken) $('#clPreviewBody').textContent = error.message; }
}
async function download(id) {
  const file = state.files.find(item => item.id === id); if (!file) return;
  try {
    const url = await (state.mode === 'cloud' ? cloud.downloadUrl(file) : local.url(file));
    const link = document.createElement('a'); link.href = url; link.download = file.fileName; link.rel = 'noopener';
    if (state.mode === 'cloud') link.target = '_blank';
    document.body.append(link); link.click(); link.remove();
    if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { notice(error.message, true); }
}
function onClick(event) {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.clClose) { if (!state.busy) $(`#${button.dataset.clClose}`).close(); return; }
  if (button.dataset.clMode && !state.busy && !state.loading) {
    state.mode = button.dataset.clMode; state.category = 'all'; state.trash = false; state.files = [];
    try { localStorage.setItem('champ_library_mode', state.mode); } catch {}
    load(); return;
  }
  if (button.dataset.clCategory) { state.category = button.dataset.clCategory; state.trash = false; render(); return; }
  if (state.busy) return;
  if (button.dataset.clPreview) return preview(button.dataset.clPreview);
  if (button.dataset.clEdit) return edit(button.dataset.clEdit);
  if (button.dataset.clDownload) return download(button.dataset.clDownload);
  if (button.dataset.clTrash) return move(button.dataset.clTrash, 'trash');
  if (button.dataset.clRestore) return move(button.dataset.clRestore, 'restore');
  if (button.dataset.cl === 'upload') showUpload();
  if (button.dataset.cl === 'categories') showCategories();
  if (button.dataset.cl === 'refresh') load();
  if (button.dataset.cl === 'trash-view') { state.trash = true; state.category = 'all'; render(); }
  if (button.dataset.cl === 'preview-download') download($('#clPreviewDialog').dataset.fileId);
}
window.ChampLibrary = { open() { mount(); if (!state.loaded && !state.loading) load(); } };
// A direct link is useful for bookmarks and review without changing the existing default dashboard.
if (location.hash === '#champ-library') { window.ChampLibrary.open(); if (typeof switchView === 'function') switchView('champLibrary'); }
