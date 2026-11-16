(function exposeLandingLeadImport(root) {
  'use strict';
  const C = root.LandingLeadImportCore;
  let adapter, current = null, busy = false, modal, fileInput;
  const node = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const masked = value => value ? `${Array.from(value)[0]}•••` : '—';
  const context = () => ({ db: adapter.db(), storage: adapter.storage || root.localStorage, cloudExpected: adapter.cloudExpected() });

  function setBusy(value) {
    busy = value;
    node('landingImportConfirm').disabled = value || !current?.records.length;
    node('landingImportCancel').disabled = value;
    node('landingImportClose').disabled = value;
  }
  function close() { if (!busy) { modal.close(); current = null; } }

  function init(options) {
    adapter = options;
    fileInput = node('landingImportInput');
    modal = node('landingImportDialog');
    if (!fileInput || !modal) return;
    fileInput.addEventListener('change', async event => {
      const file = event.target.files[0];
      event.target.value = '';
      if (file) await openFile(file);
    });
    node('landingImportCancel').addEventListener('click', close);
    node('landingImportClose').addEventListener('click', close);
    modal.addEventListener('cancel', event => { if (busy) event.preventDefault(); else current = null; });
    node('landingImportConfirm').addEventListener('click', confirmImport);
  }

  async function openFile(file) {
    if (busy) return;
    current = null;
    if (!/\.(csv|tsv)$/i.test(file.name) || !file.size || file.size > C.MAX_BYTES) {
      adapter.notify('请选择不超过 10 MB 的 CSV／TSV。Excel 名单请先另存为 CSV UTF-8。');
      return;
    }
    node('landingImportSummary').textContent = '正在检查名单与重复资料…';
    node('landingImportSamples').innerHTML = '';
    node('landingImportStatus').textContent = '';
    node('landingImportConfirm').textContent = '确认导入到 Landing Leads';
    modal.showModal();
    setBusy(true);
    try {
      const mode = context();
      const rows = adapter.parseRows(await file.arrayBuffer());
      const existing = await C.readExisting(mode);
      current = C.planRows(rows, existing, adapter.parseDate);
      current.db = mode.db;
      current.cloudExpected = mode.cloudExpected;
      const p = current;
      node('landingImportSummary').textContent = `共 ${p.total} 行 · 可新增 ${p.records.length} · 重复跳过 ${p.duplicates} · 无效跳过 ${p.invalid.length}。保存位置：${mode.db ? '云端 Landing Leads' : '本机 Landing Leads（不会同步其他设备）'}。`;
      node('landingImportSamples').innerHTML = p.records.length ? `<div class="table-wrap"><table><thead><tr><th>新增预览（脱敏，最多 5 条）</th><th>电话</th><th>Email</th></tr></thead><tbody>${p.records.slice(0, 5).map(lead => `<tr><td>${escape(masked(lead.name))}</td><td>${lead.phone ? escape(lead.phone.slice(0, 4) + '••••' + lead.phone.slice(-3)) : '—'}</td><td>${escape(masked(lead.email))}</td></tr>`).join('')}</tbody></table></div>` : '';
      const messages = [];
      if (p.missingDate) messages.push(`${p.missingDate} 条没有可识别的原报名时间，导入后显示「未记录」。`);
      if (p.invalid.length) messages.push(p.invalid.slice(0, 5).map(item => `第 ${item.row} 行：${item.reason}`).join('；') + (p.invalid.length > 5 ? '；其余请检查原文件。' : '。'));
      if (!p.records.length) messages.push('没有可新增的记录，请检查名单或关闭此窗口。');
      node('landingImportStatus').textContent = messages.join('\n');
    } catch {
      current = null;
      node('landingImportSummary').textContent = '检查未完成，尚未导入名单。';
      node('landingImportStatus').textContent = '请确认管理员已登录、网络正常，且文件为 CSV／TSV；表头需要姓名，以及电话或 Email。';
    } finally { setBusy(false); }
  }

  async function confirmImport() {
    if (busy || !current?.records.length) return;
    const mode = context();
    if (current.db !== mode.db || current.cloudExpected !== mode.cloudExpected) {
      current = null;
      setBusy(false);
      node('landingImportStatus').textContent = '云端连接状态已改变，请关闭窗口并重新选择名单。';
      return;
    }
    setBusy(true);
    node('landingImportStatus').textContent = '正在保存，请保持页面开启…';
    try {
      const result = await C.save(current.records, { ...mode, progress: result => {
        node('landingImportStatus').textContent = `正在保存，已确认 ${result.added} 条…`;
      } });
      const skipped = current.duplicates + result.skipped;
      node('landingImportStatus').textContent = `${result.mode === 'cloud' ? '云端保存完成' : '本机保存完成'}：新增 ${result.added} 条，重复跳过 ${skipped} 条，无效跳过 ${current.invalid.length} 条。`;
      node('landingImportConfirm').textContent = '导入已完成';
      current = null;
      adapter.notify('名单已保存到 Landing Leads。');
      await adapter.refresh();
    } catch (error) {
      // Do not expose SDK error payloads or customer values, or fall back to
      // another store after a failed/uncertain cloud write.
      node('landingImportStatus').textContent = Number.isInteger(error.confirmedAdded)
        ? error.message
        : '保存未确认。请检查网络、管理员权限或本机储存空间，刷新后重新选择文件核对。';
      current = null;
    } finally { setBusy(false); }
  }

  root.LandingLeadImport = Object.freeze({ init, openFile, chooseFile() { if (!busy) fileInput?.click(); } });
})(globalThis);
