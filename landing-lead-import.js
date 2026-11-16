(function exposeLandingLeadImport(root) {
  'use strict';
  const C = root.LandingLeadImportCore;
  let adapter, current = null, session = null, busy = false, modal, fileInput;
  const node = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const masked = value => value ? `${Array.from(value)[0]}•••` : '—';
  const context = () => ({ db: adapter.db(), storage: adapter.storage || root.localStorage, cloudExpected: adapter.cloudExpected() });

  function setBusy(value) {
    busy = value;
    node('landingImportConfirm').disabled = value || !((current?.records.length || 0) + (current?.repairs.length || 0));
    node('landingImportCancel').disabled = value;
    node('landingImportClose').disabled = value;
    node('landingImportPhoneColumn').disabled = value;
  }
  function close() { if (!busy) { modal.close(); current = null; session = null; } }

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
    modal.addEventListener('cancel', event => { if (busy) event.preventDefault(); else { current = null; session = null; } });
    node('landingImportConfirm').addEventListener('click', confirmImport);
    node('landingImportPhoneColumn').addEventListener('change', () => { if (!busy) { preparePlan(); setBusy(false); } });
  }

  function preparePlan() {
    current = null;
    node('landingImportSamples').innerHTML = '';
    if (!session) return;
    const selected = node('landingImportPhoneColumn').value;
    if (selected === '') {
      node('landingImportSummary').textContent = '请先确认电话号码栏位，尚未导入名单。';
      node('landingImportStatus').textContent = '未自动识别到唯一的电话栏。请选择原文件的电话栏；确实没有电话时，选择「没有电话栏，仅导入 Email」。';
      return;
    }
    try {
      current = C.planRows(session.rows, session.existing, adapter.parseDate, { phoneColumn: Number(selected) });
      current.db = session.mode.db;
      current.cloudExpected = session.mode.cloudExpected;
      const p = current;
      node('landingImportSummary').textContent = `共 ${p.total} 行 · 可新增 ${p.records.length} · 可补回电话 ${p.repairs.length} · 重复跳过 ${p.duplicates} · 无效跳过 ${p.invalid.length}。本批可保存电话 ${p.phoneCount} 条。保存位置：${session.mode.db ? '云端 Landing Leads' : '本机 Landing Leads（不会同步其他设备）'}。`;
      const samples = [...p.repairs.map(lead => ({ ...lead, action: '补回电话' })), ...p.records.map(lead => ({ ...lead, action: '新增' }))];
      node('landingImportSamples').innerHTML = samples.length ? `<div class="table-wrap"><table><thead><tr><th>处理</th><th>名单预览（脱敏）</th><th>电话</th><th>Email</th></tr></thead><tbody>${samples.slice(0, 5).map(lead => `<tr><td>${lead.action}</td><td>${escape(masked(lead.name))}</td><td>${lead.phone ? escape(lead.phone.slice(0, 4) + '••••' + lead.phone.slice(-3)) : '—'}</td><td>${escape(masked(lead.email))}</td></tr>`).join('')}</tbody></table></div>` : '';
      const messages = [];
      if (p.repairs.length) messages.push('补回电话只用于同 Email、电话原本空白的历史导入记录；保留原跟进状态。');
      if (p.withoutPhone) messages.push(`${p.withoutPhone} 条没有电话号码，将仅保存 Email；请核对所选栏位。`);
      if (p.missingDate) messages.push(`${p.missingDate} 条没有可识别的原报名时间，导入后显示「未记录」。`);
      if (p.invalid.length) messages.push(p.invalid.slice(0, 5).map(item => `第 ${item.row} 行：${item.reason}`).join('；') + (p.invalid.length > 5 ? '；其余请检查原文件。' : '。'));
      if (!samples.length) messages.push('没有可新增或补回电话的记录，请检查名单或关闭此窗口。');
      node('landingImportStatus').textContent = messages.join('\n');
    } catch (error) {
      current = null;
      node('landingImportSummary').textContent = '检查未完成，尚未导入名单。';
      node('landingImportStatus').textContent = error.inputIssue === true ? error.message : '名单资料无法识别，请检查表头与格式。';
    }
  }

  async function openFile(file) {
    if (busy) return;
    current = null;
    session = null;
    if (!/\.(csv|tsv)$/i.test(file.name) || !file.size || file.size > C.MAX_BYTES) {
      adapter.notify('请选择不超过 10 MB 的 CSV／TSV。Excel 名单请先另存为 CSV UTF-8。');
      return;
    }
    node('landingImportSummary').textContent = '正在检查名单与重复资料…';
    node('landingImportSamples').innerHTML = '';
    node('landingImportStatus').textContent = '';
    node('landingImportConfirm').textContent = '确认导入到 Landing Leads';
    node('landingImportPhoneColumn').innerHTML = '<option value="">正在检查栏位…</option>';
    modal.showModal();
    setBusy(true);
    try {
      const mode = context();
      const rows = adapter.parseRows(await file.arrayBuffer());
      const existing = await C.readExisting(mode);
      const columns = C.phoneColumns(rows);
      node('landingImportPhoneColumn').innerHTML = '<option value="">请选择电话号码栏位</option>' + columns.columns.map(column => `<option value="${column.index}">${escape(column.label)}</option>`).join('') + '<option value="-1">没有电话栏，仅导入 Email</option>';
      node('landingImportPhoneColumn').value = columns.automatic === null ? '' : String(columns.automatic);
      session = { rows, existing, mode };
      preparePlan();
    } catch {
      current = null;
      session = null;
      node('landingImportSummary').textContent = '检查未完成，尚未导入名单。';
      node('landingImportStatus').textContent = '请确认管理员已登录、网络正常，且文件为 CSV／TSV；表头需要姓名，以及电话或 Email。';
    } finally { setBusy(false); }
  }

  async function confirmImport() {
    if (busy || !((current?.records.length || 0) + (current?.repairs.length || 0))) return;
    const mode = context();
    if (current.db !== mode.db || current.cloudExpected !== mode.cloudExpected) {
      current = null;
      session = null;
      setBusy(false);
      node('landingImportStatus').textContent = '云端连接状态已改变，请关闭窗口并重新选择名单。';
      return;
    }
    setBusy(true);
    node('landingImportStatus').textContent = '正在保存，请保持页面开启…';
    try {
      const result = await C.save(current.records, { ...mode, progress: result => {
        node('landingImportStatus').textContent = `正在保存，已确认新增 ${result.added} 条、补回电话 ${result.repaired || 0} 条…`;
      } }, current.repairs);
      const skipped = current.duplicates + result.skipped;
      node('landingImportStatus').textContent = `${result.mode === 'cloud' ? '云端保存完成' : '本机保存完成'}：新增 ${result.added} 条，补回电话 ${result.repaired || 0} 条，重复跳过 ${skipped} 条，无效跳过 ${current.invalid.length} 条。`;
      node('landingImportConfirm').textContent = '导入已完成';
      current = null;
      session = null;
      adapter.notify('名单已保存到 Landing Leads。');
      await adapter.refresh();
    } catch (error) {
      // Do not expose SDK error payloads or customer values, or fall back to
      // another store after a failed/uncertain cloud write.
      node('landingImportStatus').textContent = Number.isInteger(error.confirmedAdded)
        ? error.message
        : '保存未确认。请检查网络、管理员权限或本机储存空间，刷新后重新选择文件核对。';
      current = null;
      session = null;
    } finally { setBusy(false); }
  }

  root.LandingLeadImport = Object.freeze({ init, openFile, chooseFile() { if (!busy) fileInput?.click(); } });
})(globalThis);
