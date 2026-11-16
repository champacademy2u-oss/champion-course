(function exposeLandingLeadImportCore(root) {
  'use strict';

  const SOURCE = 'Champ Preview Landing Page';
  const COLLECTION = 'preview_leads';
  const STORAGE_KEY = 'preview_leads_static';
  const MAX_ROWS = 5000;
  const MAX_BYTES = 10 * 1024 * 1024;
  const fields = {
    name: ['full_name', 'name', '姓名', '名字', '客户姓名'],
    phone: ['phone_number', 'phone', 'mobile', 'mobile_number', 'whatsapp', 'whatsapp_number', 'contact_number', '电话', '电话号码', '手机', '手机号', '手机号码', '联系电话', '联络号码'],
    email: ['email', 'email_address', 'e-mail', '邮箱', '电邮', '电子邮箱'],
    state: ['state', '州属', '州'],
    createdAt: ['created_at', 'created_time', 'submitted_at', 'registration_date', 'date', '报名时间', '报名时间（马来西亚）', '提交时间'],
  };
  const headerKey = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  const text = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const emailKey = value => text(value).toLowerCase();

  function phoneInfo(value) {
    const cleaned = text(value).replace(/^p:/i, '');
    if (!cleaned) return { valid: true, phone: '' };
    if (!/^[+\d\s().-]+$/.test(cleaned)) return { valid: false, phone: '' };
    return root.WhatsappBulkCore.normalizeMalaysiaPhone(cleaned);
  }

  function keys(lead) {
    const phone = phoneInfo(lead.phone);
    const email = emailKey(lead.email);
    return [phone.valid && phone.phone ? `phone:${phone.phone}` : '', email ? `email:${email}` : ''].filter(Boolean);
  }

  function planRows(rows, existing, parseDate) {
    if (!Array.isArray(rows) || rows.length < 2) throw new Error('名单没有资料，请检查表头与内容。');
    if (rows.length - 1 > MAX_ROWS) throw new Error('每次最多导入 5,000 行，请先拆分名单。');
    const headers = rows[0].map(headerKey);
    const mapping = {};
    for (const [field, aliases] of Object.entries(fields)) {
      const candidates = aliases.map(headerKey);
      const found = headers.map((header, index) => candidates.includes(header) ? index : -1).filter(index => index >= 0);
      if (found.length > 1) throw new Error('同一资料有多个栏位，请保留一栏后重试。');
      mapping[field] = found[0] ?? -1;
    }
    if (mapping.name < 0 || (mapping.phone < 0 && mapping.email < 0)) {
      throw new Error('需要姓名栏，以及电话或 Email 栏。支持 full_name、phone_number、email、state 或中文表头。');
    }
    const seen = new Set(existing.filter(lead => lead.source === SOURCE).flatMap(keys));
    const result = { records: [], invalid: [], duplicates: 0, total: 0, missingDate: 0, fields: Object.keys(mapping).filter(key => mapping[key] >= 0) };
    rows.slice(1).forEach((row, index) => {
      if (!row.some(cell => text(cell))) return;
      result.total++;
      const get = field => mapping[field] >= 0 ? text(row[mapping[field]]) : '';
      const name = get('name'), email = emailKey(get('email')), rawPhone = get('phone');
      const phone = phoneInfo(rawPhone);
      let reason = '';
      if (!name || name.length > 200) reason = '姓名缺失或过长';
      else if (!rawPhone && !email) reason = '缺少电话与 Email';
      else if (!phone.valid) reason = '电话号码格式无效';
      else if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) reason = 'Email 格式无效';
      if (reason) { result.invalid.push({ row: index + 2, reason }); return; }
      const lead = { name, phone: phone.phone ? `+${phone.phone}` : '', email, state: get('state').slice(0, 80) };
      const identities = keys(lead);
      if (identities.some(key => seen.has(key))) { result.duplicates++; return; }
      identities.forEach(key => seen.add(key));
      // Preserve the original precision and Malaysia date conventions. A missing
      // registration time must not become today's registration merely on import.
      const date = get('createdAt');
      lead.createdAt = date && parseDate(date) ? date : null;
      if (!lead.createdAt) result.missingDate++;
      result.records.push(lead);
    });
    return result;
  }

  function storedRecord(record, id, importedAt) {
    return {
      id, name: record.name, phone: record.phone, email: record.email, state: record.state,
      createdAt: record.createdAt, importedAt, source: SOURCE, importOrigin: 'manual_landing_import',
      funnelStage: 'new_lead', rsvpStatus: 'unknown', whatsappStatus: 'not_contacted',
      whatsappConsent: false, emailConsent: false,
    };
  }

  async function recordId(record) {
    const input = new TextEncoder().encode(`${SOURCE}|${keys(record)[0]}`);
    const hash = await root.crypto.subtle.digest('SHA-256', input);
    return `landing_import_${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  async function readExisting({ db, storage, cloudExpected }) {
    if (cloudExpected && !db) throw new Error('云端尚未连接，请等待管理员登录完成后重试。');
    if (db) {
      // Never trust an incomplete offline query for duplicate detection.
      const snapshot = await db.collection(COLLECTION).get({ source: 'server' });
      return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    }
    const records = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(records)) throw new Error('本机名单格式不正确，请先检查备份。');
    return records;
  }

  async function save(records, context) {
    const existing = await readExisting(context);
    const seen = new Set(existing.filter(lead => lead.source === SOURCE).flatMap(keys));
    const pending = [];
    let skipped = 0, added = 0;
    const importedAt = new Date().toISOString();
    for (const record of records) {
      const identities = keys(record);
      if (!identities.length) throw new Error('名单资料已改变，请重新选择文件。');
      if (identities.some(key => seen.has(key))) { skipped++; continue; }
      identities.forEach(key => seen.add(key));
      pending.push(storedRecord(record, await recordId(record), importedAt));
    }
    if (!context.db) {
      // One atomic localStorage write; other source groups remain byte-for-byte
      // equivalent after parsing. A quota failure is never reported as success.
      if (pending.length) context.storage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...pending]));
      return { added: pending.length, skipped, mode: 'local' };
    }
    for (let start = 0; start < pending.length; start += 100) {
      const chunk = pending.slice(start, start + 100);
      try {
        const count = await context.db.runTransaction(async transaction => {
          const refs = chunk.map(lead => context.db.collection(COLLECTION).doc(lead.id));
          const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
          let written = 0;
          snapshots.forEach((snapshot, index) => {
            if (snapshot.exists) {
              if (snapshot.data().source !== SOURCE) throw new Error('分类冲突');
              return;
            }
            transaction.set(refs[index], chunk[index]);
            written++;
          });
          return written;
        });
        added += count;
        skipped += chunk.length - count;
        context.progress?.({ added, skipped });
      } catch {
        const error = new Error(`导入未完成：已确认保存 ${added} 条。当前批次结果待核对，请联网刷新后重新选择名单；已存在的记录会跳过。`);
        error.confirmedAdded = added;
        throw error;
      }
    }
    return { added, skipped, mode: 'cloud' };
  }

  root.LandingLeadImportCore = Object.freeze({ SOURCE, COLLECTION, STORAGE_KEY, MAX_ROWS, MAX_BYTES, planRows, readExisting, save });
})(globalThis);
