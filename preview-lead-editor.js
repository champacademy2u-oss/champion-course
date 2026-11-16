(function exposePreviewLeadEditor(root) {
  'use strict';
  const C = root.PreviewLeadEditorCore;
  const node = id => document.getElementById(id);
  let adapter, modal, base = null, mode = null, busy = false;
  const context = () => ({ db: adapter.db(), cloudExpected: adapter.cloudExpected(), storage: adapter.storage || root.localStorage });
  function setBusy(value) {
    busy = value;
    for (const id of ['previewLeadEditSave', 'previewLeadEditCancel', 'previewLeadEditClose']) node(id).disabled = value || (id === 'previewLeadEditSave' && !base);
    for (const field of C.FIELDS) node('previewLeadEdit_' + field).disabled = value || !base;
  }
  function close() { if (!busy) { modal.close(); base = null; mode = null; for (const field of C.FIELDS) node('previewLeadEdit_' + field).value = ''; } }
  function errorText(error) { return error instanceof C.EditError ? error.message : '操作未确认，请检查网络和管理员权限，刷新后核对。'; }
  function deadline(promise) {
    let timer;
    return Promise.race([promise, new Promise((resolve, reject) => { timer = root.setTimeout(() => reject(new Error('timeout')), 20000); })]).finally(() => root.clearTimeout(timer));
  }
  async function open(id, source) {
    if (busy) return;
    base = null; mode = null;
    for (const field of C.FIELDS) node('previewLeadEdit_' + field).value = '';
    node('previewLeadEditSource').textContent = source === C.SOURCES[0] ? 'Landing Leads' : 'Preview Leads';
    node('previewLeadEditStatus').textContent = '正在读取最新资料…';
    modal.showModal(); setBusy(true);
    try {
      mode = context();
      base = await deadline(C.load(mode, id, source));
      for (const field of C.FIELDS) node('previewLeadEdit_' + field).value = base.values[field];
      node('previewLeadEditStatus').textContent = mode.db ? '保存后同步到云端；分类和跟进记录保留。' : '当前为本机模式，保存不会同步其他设备。';
    } catch (error) { base = null; node('previewLeadEditStatus').textContent = errorText(error); }
    finally { setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || !base) return;
    const currentMode = context();
    if (currentMode.db !== mode.db || currentMode.cloudExpected !== mode.cloudExpected) {
      base = null; node('previewLeadEditStatus').textContent = '连接状态已改变，请关闭后重新打开。'; setBusy(false); return;
    }
    const input = Object.fromEntries(C.FIELDS.map(field => [field, node('previewLeadEdit_' + field).value]));
    try { C.validate(input); }
    catch (error) { node('previewLeadEditStatus').textContent = errorText(error); return; }
    setBusy(true); node('previewLeadEditStatus').textContent = '正在保存…';
    try {
      const source = base.source, result = await deadline(C.save(mode, base, input));
      base = null; setBusy(false); close();
      adapter.notify(result.changed ? (result.mode === 'cloud' ? '客户资料已保存到云端。' : '客户资料已保存到本机。') : '资料没有改变。');
      try { await adapter.refresh(source); }
      catch { adapter.notify('资料已保存，请刷新名单以查看最新内容。'); }
    } catch (error) {
      base = null;
      node('previewLeadEditStatus').textContent = errorText(error) + ' 保存结果不明时，请先核对记录。';
    } finally { setBusy(false); }
  }
  function init(options) {
    adapter = options; modal = node('previewLeadEditDialog');
    if (!modal) return;
    node('previewLeadEditForm').addEventListener('submit', submit);
    node('previewLeadEditCancel').addEventListener('click', close);
    node('previewLeadEditClose').addEventListener('click', close);
    modal.addEventListener('cancel', event => { if (busy) event.preventDefault(); else { base = null; mode = null; for (const field of C.FIELDS) node('previewLeadEdit_' + field).value = ''; } });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-preview-edit]');
      if (button && !button.disabled) open(button.dataset.id, button.dataset.source);
    });
  }
  root.PreviewLeadEditor = Object.freeze({ init, open });
})(globalThis);
