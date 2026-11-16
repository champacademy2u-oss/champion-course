(function exposeLandingLeadImportCore(root) {
  'use strict';

  const SOURCE = 'Champ Preview Landing Page';
  const COLLECTION = 'preview_leads';
  const STORAGE_KEY = 'preview_leads_static';
  const MAX_ROWS = 5000;
  const MAX_BYTES = 10 * 1024 * 1024;
  const fields = {
    name: ['full_name', 'name', '姓名', '名字', '客户姓名'],
    phone: ['phone_number', 'phone', 'phone_no', 'mobile', 'mobile_number', 'mobile_no', 'mobile_phone', 'mobile_phone_number', 'whatsapp', 'whatsapp_number', 'whatsapp_no', 'whatsapp_phone_number', 'phone_number_whatsapp', 'phone_whatsapp', 'contact', 'contact_number', 'contact_no', 'telephone', 'telephone_number', 'tel', 'tel_no', 'no_telefon', 'nombor_telefon', '电话', '电话号码', '手机', '手机号', '手机号码', '联系电话', '联络电话', '联系号码', '联络号码', 'WhatsApp号码', '电话号码WhatsApp', '联系电话WhatsApp', '電話', '電話號碼', '手機', '手機號碼', '聯絡電話'],
    email: ['email', 'email_address', 'e-mail', '邮箱', '电邮', '电子邮箱'],
    state: ['state', '州属', '州'],
    createdAt: ['created_at', 'created_time', 'submitted_at', 'registration_date', 'date', '报名时间', '报名时间（马来西亚）', '提交时间'],
  };
  const headerKey = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  const text = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const emailKey = value => text(value).toLowerCase();

  function phoneInfo(value) {
    let cleaned = text(value).normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/^p:/i, '').replace(/^'/, '').trim();
    // Excel text wrappers are parsed as numeric text, never evaluated as code.
    const wrapped = /^="([+\d\s().-]+)"$/.exec(cleaned);
    if (wrapped) cleaned = wrapped[1];
    if (!cleaned) return { valid: true, phone: '' };
    if (!/^[+\d\s().-]+$/.test(cleaned)) return { valid: false, phone: '' };
    return root.WhatsappBulkCore.normalizeMalaysiaPhone(cleaned);
  }

  function keys(lead) {
    const phone = phoneInfo(lead.phone);
    const email = emailKey(lead.email);
    return [phone.valid && phone.phone ? `phone:${phone.phone}` : '', email ? `email:${email}` : ''].filter(Boolean);
  }

  function inputError(message) {
    const error = new Error(message);
    error.inputIssue = true;
    return error;
  }

  function phoneColumns(rows) {
    const columns = (rows[0] || []).map((label, index) => ({ index, label: text(label) || `第 ${index + 1} 栏` }));
    const aliases = new Set(fields.phone.map(headerKey));
    const matches = columns.filter(column => aliases.has(headerKey(column.label)));
    return { columns, automatic: matches.length === 1 ? matches[0].index : null };
  }

  function contactIndex(existing) {
    const landing = existing.filter(lead => lead.source === SOURCE);
    const byEmail = new Map(), byPhone = new Map();
    for (const lead of landing) {
      const email = emailKey(lead.email), phone = phoneInfo(lead.phone);
      if (email) byEmail.set(email, [...(byEmail.get(email) || []), lead]);
      if (phone.valid && phone.phone) byPhone.set(phone.phone, [...(byPhone.get(phone.phone) || []), lead]);
    }
    return { seen: new Set(landing.flatMap(keys)), byEmail, byPhone };
  }

  function repairTarget(record, index, expectedId) {
    if (!record.email || !record.phone) return null;
    const matches = index.byEmail.get(emailKey(record.email)) || [];
    if (matches.length !== 1) return null;
    const target = matches[0];
    const phone = phoneInfo(record.phone);
    // Only repair records made by this importer. Never replace an existing
    // number or change a public form registration based on a CSV match.
    if (!target.id || (expectedId && target.id !== expectedId) || target.importOrigin !== 'manual_landing_import' || text(target.phone) || !phone.valid || !phone.phone) return null;
    if ((index.byPhone.get(phone.phone) || []).some(owner => owner.id !== target.id)) return null;
    return target;
  }

  function planRows(rows, existing, parseDate, options = {}) {
    if (!Array.isArray(rows) || rows.length < 2) throw inputError('名单没有资料，请检查表头与内容。');
    if (rows.length - 1 > MAX_ROWS) throw inputError('每次最多导入 5,000 行，请先拆分名单。');
    const headers = rows[0].map(headerKey);
    const mapping = {};
    for (const [field, aliases] of Object.entries(fields)) {
      if (field === 'phone' && Number.isInteger(options.phoneColumn)) {
        if (options.phoneColumn < -1 || options.phoneColumn >= headers.length) throw inputError('电话号码栏位无效，请重新选择。');
        mapping.phone = options.phoneColumn;
        continue;
      }
      const candidates = aliases.map(headerKey);
      const found = headers.map((header, index) => candidates.includes(header) ? index : -1).filter(index => index >= 0);
      if (found.length > 1) throw inputError(field === 'phone' ? '找到多个电话栏，请选择要导入的一栏。' : '同一资料有多个栏位，请保留一栏后重试。');
      mapping[field] = found[0] ?? -1;
    }
    if (mapping.name < 0 || (mapping.phone < 0 && mapping.email < 0)) {
      throw inputError('需要姓名栏，以及电话或 Email 栏。支持 full_name、phone_number、email、state 或中文表头。');
    }
    if (mapping.phone < 0 && options.phoneColumn !== -1) throw inputError('未识别电话号码栏，请先选择电话栏位；确实没有电话时，可选择「仅导入 Email」。');
    const contacts = contactIndex(existing), seen = new Set(contacts.seen), repairIds = new Set(), plannedByEmail = new Map();
    const result = { records: [], repairs: [], invalid: [], duplicates: 0, total: 0, missingDate: 0, phoneCount: 0, withoutPhone: 0, fields: Object.keys(mapping).filter(key => mapping[key] >= 0) };
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
      if (identities.some(key => seen.has(key))) {
        const planned = lead.email ? plannedByEmail.get(lead.email) : null;
        if (planned && !planned.phone && lead.phone && !seen.has(`phone:${phone.phone}`)) {
          planned.phone = lead.phone;
          identities.forEach(key => seen.add(key));
          result.withoutPhone--;
          result.phoneCount++;
          result.duplicates++;
          return;
        }
        const target = repairTarget(lead, contacts);
        if (target && !repairIds.has(target.id) && !seen.has(`phone:${phone.phone}`)) {
          repairIds.add(target.id);
          identities.forEach(key => seen.add(key));
          result.repairs.push({ id: target.id, name: lead.name, email: lead.email, phone: lead.phone });
          result.phoneCount++;
        } else result.duplicates++;
        return;
      }
      identities.forEach(key => seen.add(key));
      // Preserve the original precision and Malaysia date conventions. A missing
      // registration time must not become today's registration merely on import.
      const date = get('createdAt');
      lead.createdAt = date && parseDate(date) ? date : null;
      if (!lead.createdAt) result.missingDate++;
      result.records.push(lead);
      if (lead.email) plannedByEmail.set(lead.email, lead);
      if (lead.phone) result.phoneCount++;
      else result.withoutPhone++;
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

  async function save(records, context, repairs = []) {
    const existing = await readExisting(context);
    const contacts = contactIndex(existing), seen = new Set(contacts.seen), repairIds = new Set();
    const pending = [];
    let skipped = 0, added = 0, repaired = 0;
    const importedAt = new Date().toISOString();
    for (const [record, isRepair] of [...records.map(record => [record, false]), ...repairs.map(record => [record, true])]) {
      const identities = keys(record);
      if (!identities.length) throw new Error('名单资料已改变，请重新选择文件。');
      if (identities.some(key => seen.has(key)) || isRepair) {
        const target = repairTarget(record, contacts, isRepair ? record.id : undefined);
        const phone = phoneInfo(record.phone);
        if (target && !repairIds.has(target.id) && !seen.has(`phone:${phone.phone}`)) {
          repairIds.add(target.id);
          identities.forEach(key => seen.add(key));
          pending.push({ type: 'repair', id: target.id, email: emailKey(record.email), patch: { phone: `+${phone.phone}`, phoneImportedAt: importedAt } });
        } else skipped++;
        continue;
      }
      identities.forEach(key => seen.add(key));
      pending.push({ type: 'create', record: storedRecord(record, await recordId(record), importedAt) });
    }
    if (!context.db) {
      // One atomic localStorage write; other source groups remain byte-for-byte
      // equivalent after parsing. A quota failure is never reported as success.
      const patches = new Map(pending.filter(op => op.type === 'repair').map(op => [op.id, op.patch]));
      const additions = pending.filter(op => op.type === 'create').map(op => op.record);
      if (pending.length) context.storage.setItem(STORAGE_KEY, JSON.stringify([...existing.map(lead => patches.has(lead.id) ? { ...lead, ...patches.get(lead.id) } : lead), ...additions]));
      return { added: additions.length, repaired: patches.size, skipped, mode: 'local' };
    }
    for (let start = 0; start < pending.length; start += 100) {
      const chunk = pending.slice(start, start + 100);
      try {
        const count = await context.db.runTransaction(async transaction => {
          const refs = chunk.map(op => context.db.collection(COLLECTION).doc(op.type === 'create' ? op.record.id : op.id));
          const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
          let written = 0, filled = 0;
          snapshots.forEach((snapshot, index) => {
            const operation = chunk[index];
            if (operation.type === 'repair') {
              const target = snapshot.exists ? snapshot.data() : null;
              if (target && target.source === SOURCE && target.importOrigin === 'manual_landing_import' && !text(target.phone) && emailKey(target.email) === operation.email) {
                transaction.update(refs[index], operation.patch);
                filled++;
              }
              return;
            }
            if (snapshot.exists) {
              if (snapshot.data().source !== SOURCE) throw new Error('分类冲突');
              return;
            }
            transaction.set(refs[index], operation.record);
            written++;
          });
          return { added: written, repaired: filled };
        });
        added += count.added;
        repaired += count.repaired;
        skipped += chunk.length - count.added - count.repaired;
        context.progress?.({ added, repaired, skipped });
      } catch {
        const error = new Error(`导入未完成：已确认新增 ${added} 条、补回电话 ${repaired} 条。当前批次结果待核对，请联网刷新后重新选择名单；已有电话不会覆盖。`);
        error.confirmedAdded = added;
        error.confirmedRepaired = repaired;
        throw error;
      }
    }
    return { added, repaired, skipped, mode: 'cloud' };
  }

  root.LandingLeadImportCore = Object.freeze({ SOURCE, COLLECTION, STORAGE_KEY, MAX_ROWS, MAX_BYTES, phoneColumns, planRows, readExisting, save });
})(globalThis);
