(function exposePreviewLeadEditorCore(root) {
  'use strict';
  const SOURCES = Object.freeze(['Champ Preview Landing Page', 'Champ Learning Landing Page']);
  const FIELDS = Object.freeze(['name', 'phone', 'email', 'state']);
  const STORAGE_KEY = 'preview_leads_static';
  class EditError extends Error {}
  const fail = message => { throw new EditError(message); };
  const value = input => String(input ?? '');
  const clean = input => value(input).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  function guard(context, id, source) {
    if (!SOURCES.includes(source) || !id || typeof id !== 'string' || id.length > 256 || id.includes('/')) fail('名单记录不正确，请刷新重试。');
    if (context.cloudExpected && !context.db) fail('云端尚未连接，请先完成管理员登录。');
  }
  function values(record) { return Object.fromEntries(FIELDS.map(field => [field, value(record[field])])); }
  function recordSnapshot(id, source, record) {
    if (!record || record.source !== source) fail('记录已删除或分类已改变，请刷新名单。');
    return { id, source, values: values(record) };
  }
  function localRecords(context) {
    const records = JSON.parse(context.storage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(records)) fail('本机名单格式不正确，请先检查备份。');
    return records;
  }
  async function load(context, id, source) {
    guard(context, id, source);
    if (context.db) {
      const snapshot = await context.db.collection('preview_leads').doc(id).get({ source: 'server' });
      return recordSnapshot(id, source, snapshot.exists ? snapshot.data() : null);
    }
    return recordSnapshot(id, source, localRecords(context).find(record => record.id === id));
  }
  function validate(input) {
    const name = clean(input.name), email = clean(input.email).toLowerCase(), state = clean(input.state);
    let phone = clean(input.phone).normalize('NFKC').replace(/^p:/i, '').trim();
    if (!name || name.length > 200) fail('请填写姓名（最多 200 字）。');
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) fail('请填写正确的 Email，或留空。');
    if (state.length > 80) fail('州属请勿超过 80 字。');
    if (phone) {
      if (phone.length > 40 || !/^[+\d\s().-]+$/.test(phone)) fail('请填写正确的电话，或留空。');
      const normalized = root.WhatsappBulkCore.normalizeMalaysiaPhone(phone);
      if (!normalized.valid) fail('请填写正确的电话，或留空。');
      phone = '+' + normalized.phone;
    }
    if (!phone && !email) fail('电话和 Email 至少填写一项。');
    return { name, phone, email, state };
  }
  async function save(context, base, input) {
    guard(context, base?.id, base?.source);
    const next = validate(input);
    const patch = Object.fromEntries(FIELDS.filter(field => next[field] !== base.values[field]).map(field => [field, next[field]]));
    if (!Object.keys(patch).length) return { changed: false, mode: context.db ? 'cloud' : 'local' };
    function check(record) {
      const current = recordSnapshot(base.id, base.source, record);
      if (FIELDS.some(field => current.values[field] !== base.values[field])) fail('资料已被其他窗口修改。请关闭后重新打开，核对再保存。');
    }
    const update = { ...patch, contactUpdatedAt: new Date().toISOString() };
    if (context.db) {
      const ref = context.db.collection('preview_leads').doc(base.id);
      await context.db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        check(snapshot.exists ? snapshot.data() : null);
        transaction.update(ref, update);
      });
    } else {
      const records = localRecords(context), record = records.find(record => record.id === base.id);
      check(record);
      context.storage.setItem(STORAGE_KEY, JSON.stringify(records.map(item => item.id === base.id ? { ...item, ...update } : item)));
    }
    return { changed: true, mode: context.db ? 'cloud' : 'local' };
  }
  root.PreviewLeadEditorCore = Object.freeze({ SOURCES, FIELDS, EditError, load, validate, save });
})(globalThis);
