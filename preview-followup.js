(function (root) {
  'use strict';
  const C = root.PreviewFollowupCore;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
  const statusLabels = { sent: '已记录私信', covered: '群公告已覆盖', due: '今天待处理', overdue: '待补处理', upcoming: '未到日期', na: '不适用／已过期', paused: '已暂停', permission: '待核实联系许可', setup: '待设置日期' };
  let api, host, sessionId = '', filter = 'due', search = '', modal, selected = null, busy = false;
  function sessions() { return [...api.sessions()].sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
  function session() { return api.sessions().find(s => s.id === sessionId); }
  function record(lead) { return lead.previewFollowup?.[sessionId]; }
  function memberLeads() { return api.leads().filter(l => record(l)); }
  function option(value, label, current) { return `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`; }
  function summary() {
    const leads = memberLeads(), tasks = leads.flatMap(l => C.tasks(l, session(), record(l)));
    return `<div class="pf-metrics"><span>本场名单 <b>${leads.length}</b></span><span>待处理通知 <b>${tasks.filter(t => ['due', 'overdue'].includes(t.status)).length}</b></span><span>已进群 <b>${leads.filter(l => C.read(record(l)).groupStatus === 'joined').length}</b></span><span>确认出席 <b>${leads.filter(l => C.read(record(l)).rsvp === 'yes').length}</b></span></div>`;
  }
  function render() {
    if (!host) return;
    // Keep edits stable while cloud snapshots arrive; refresh after closing the dialog.
    const all = sessions();
    if (!all.some(s => s.id === sessionId)) sessionId = [...all].reverse().find(s => s.date >= C.day())?.id || all[0]?.id || '';
    host.innerHTML = `<header class="pf-heading"><div><h3>每月 Preview 跟进工作台</h3><p>首次联系跟进 · 活动日期提醒 · 进群与出席确认</p></div><span class="pf-mode">${api.cloud() ? '云端保存' : '本机保存'}</span></header>
      <p class="pf-note">这是人工待办，不会自动发送消息。先核实活动与名单；打开聊天不会标记已发送。原有 Hot Lead 和 Day 1／3／7 记录保留。</p>
      <div class="pf-toolbar"><label>本场 Preview<select id="pfSession">${all.length ? all.map(s => option(s.id, `${s.date} · ${s.title}`, sessionId)).join('') : '<option>暂无活动</option>'}</select></label><button type="button" data-pf="new">＋建立 Preview</button>${session() ? '<button type="button" data-pf="settings">活动时间与链接</button><button type="button" data-pf="assign">＋关联现有 Lead</button>' : ''}</div>
      ${session() ? `${summary()}<div class="pf-toolbar"><label>显示<select id="pfFilter">${Object.entries({ due: '今天与待补处理', all: '全部通知记录', group: '未进群名单', rsvp: '待确认出席', permission: '待核实联系许可' }).map(([v, l]) => option(v, l, filter)).join('')}</select></label><label>搜索客户<input id="pfSearch" type="search" placeholder="输入姓名或课程" value="${esc(search)}"></label><button type="button" data-pf="broadcast">记录活动群公告</button><button type="button" data-pf="refresh">刷新待办</button></div><div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>客户／状态</th><th>任务</th><th>应处理日期</th><th>通知记录</th><th>操作</th></tr></thead><tbody>${rows()}</tbody></table></div>` : '<p class="pf-empty">先在 Preview Courses 建立活动，再把现有 Leads 关联到这一场。不会按课程名称自动猜测名单。</p>'}`;
  }
  function rows() {
    const result = [];
    for (const lead of memberLeads()) {
      if (search && !`${lead.name} ${lead.course || ''}`.toLowerCase().includes(search.toLowerCase())) continue;
      const r = C.read(record(lead));
      const ts = C.tasks(lead, session(), r).filter(t => filter === 'all' || filter === 'due' && ['due', 'overdue'].includes(t.status) || filter === 'group' && r.groupStatus !== 'joined' && t.key === 'group' || filter === 'rsvp' && !['yes', 'no'].includes(r.rsvp) && t.key === 'before3' || filter === 'permission' && r.permission === 'unknown' && t.key === 'first');
      for (const t of ts) result.push(`<tr><td><strong>${esc(lead.name)}</strong><small>${esc(lead.course || '未分组')}<br>${{ pending: '待进群', invited: '已发群邀请', joined: '已进群' }[r.groupStatus]} · ${{ unknown: '未确认出席', yes: '确认参加', unsure: '出席不确定', no: '无法参加' }[r.rsvp]}</small></td><td>${esc(t.label)}</td><td>${esc(t.due || '—')}</td><td><span class="pf-status pf-${t.status}">${statusLabels[t.status]}</span>${t.log ? `<small>${esc(new Date(t.log.at).toLocaleString('zh-MY', { timeZone: 'Asia/Kuala_Lumpur' }))}</small>` : ''}</td><td><button type="button" data-pf="profile" data-lead="${esc(lead.id)}">状态</button> ${['due', 'overdue'].includes(t.status) ? `<button type="button" data-pf="message" data-lead="${esc(lead.id)}" data-task="${t.key}">准备私信</button>` : ''}</td></tr>`);
    }
    return result.join('') || '<tr><td colspan="5" class="pf-empty">这个筛选下没有待办。可切换“全部通知记录”，或关联本场名单。</td></tr>';
  }
  function show(title, html) {
    modal.innerHTML = `<div class="pf-dialog"><header><h3>${esc(title)}</h3><button type="button" data-pf="close" aria-label="关闭 Preview 跟进窗口">✕</button></header>${html}<p id="pfError" role="status"></p></div>`;
    modal.showModal();
  }
  function close() { if (busy) return; modal.close(); selected = null; render(); }
  function error(e) { const el = modal.querySelector('#pfError'); if (el) el.textContent = e.message || '保存失败，请刷新确认后重试'; }
  async function save(action) {
    if (busy) return;
    busy = true; modal.querySelectorAll('button').forEach(b => b.disabled = true);
    try { await action(); busy = false; close(); api.notify(api.cloud() ? '已保存到云端' : '已保存到本机（未同步云端）'); }
    catch (e) { busy = false; modal.querySelectorAll('button').forEach(b => b.disabled = false); error(e); }
  }
  function settings() {
    selected = { session: structuredClone(session()) };
    const s = session().workflowSettings || {};
    show('活动通知设置', `<form id="pfSettings"><p>活动名称：${esc(session().title)}。日期：${esc(session().date)}。日期在 Preview Courses → Edit 修改，历史通知不会自动重发。</p><label>时间（马来西亚）<input name="time" type="time" required value="${esc(s.time || '')}"></label><label>WhatsApp 活动群链接<input name="groupUrl" type="url" placeholder="https://chat.whatsapp.com/…" value="${esc(s.groupUrl || '')}"></label><label>Zoom 入口<input name="zoomUrl" type="url" placeholder="https://…" value="${esc(s.zoomUrl || '')}"></label><button type="submit">保存设置</button></form>`);
  }
  function assign() {
    selected = { session: structuredClone(session()) };
    show('关联本场报名者', `<p>仅使用现有 Leads，不复制客户资料。先筛选，再逐位勾选本场报名者；不会自动导入其他名单。</p><label>筛选姓名／课程<input id="pfAssignSearch" type="search"></label><form id="pfAssign"><div id="pfCandidates" class="pf-candidates">${api.leads().filter(l => !record(l)).map(l => `<label data-search="${esc(`${l.name} ${l.course || ''}`.toLowerCase())}"><input type="checkbox" name="lead" value="${esc(l.id)}"> ${esc(l.name)} <small>${esc(l.course || '未分组')}</small></label>`).join('') || '<p>所有现有 Leads 已关联。新名单请先使用 Leads 导入。</p>'}</div><label>实际报名日期<input name="registeredOn" type="date" max="${C.day()}" required value="${C.day()}"></label><p>旧名单请填写实际日期。不确定的联系许可默认待核实。</p><button type="submit">关联勾选名单</button></form>`);
  }
  function profile(id) {
    const lead = api.leads().find(l => l.id === id); if (!lead) return;
    const r = C.read(record(lead)); selected = { lead, record: structuredClone(r), session: structuredClone(session()) };
    show(`${lead.name} · 本场状态`, `<form id="pfProfile"><label>本场联系许可<select name="permission">${[['unknown', '待核实'], ['allowed', '已核实同意本次活动联系'], ['stopped', '停止本场联系']].map(([v, l]) => option(v, l, r.permission)).join('')}</select></label><label>实际报名日期<input name="registeredOn" type="date" required max="${C.day()}" value="${esc(r.registeredOn)}"></label><label>进群状态<select name="groupStatus">${[['pending', '待邀请'], ['invited', '已发群链接／邀请'], ['joined', '已核实进群']].map(([v, l]) => option(v, l, r.groupStatus)).join('')}</select></label><label>出席意愿<select name="rsvp">${[['unknown', '未确认'], ['yes', '确认参加'], ['unsure', '不确定'], ['no', '无法参加（暂停本场课前提醒）']].map(([v, l]) => option(v, l, r.rsvp)).join('')}</select></label><label class="pf-check"><input name="replied" type="checkbox" ${r.replied ? 'checked' : ''}>客户已回复（停止未回复 Day 1／3／7）</label><label class="pf-check"><input name="verified" type="checkbox" required>我已核实本次修改，进群／出席意愿不代表实际到场。</label><button type="submit">保存本场状态</button></form>`);
  }
  function message(id, key) {
    const lead = api.leads().find(l => l.id === id); if (!lead) return;
    selected = { lead, record: structuredClone(C.read(record(lead))), session: structuredClone(session()), key };
    show(`${lead.name} · ${C.LABELS[key]}`, `<p>仅准备一位客户的私信。在 WhatsApp 人工发送后，再回来记录。</p><label>私信草稿<textarea id="pfDraft" rows="9">${esc(C.draft(key, lead, session()))}</textarea></label><label class="pf-check"><input id="pfReviewed" type="checkbox">已核对客户、联系许可、日期与文案</label><div class="pf-toolbar"><button type="button" data-pf="copy">复制文案</button><button type="button" data-pf="open">打开 WhatsApp</button></div><hr><label class="pf-check"><input id="pfSent" type="checkbox">我已在 WhatsApp 实际发送这条私信</label><button type="button" data-pf="sent">记录已发送（不发送消息）</button>`);
  }
  function checkDraft() {
    if (!modal.querySelector('#pfReviewed').checked) throw new Error('请先逐条核对并勾选审核');
    const text = modal.querySelector('#pfDraft').value.trim();
    if (!text || /\uFFFD|\[请填写|\{\{/.test(text)) throw new Error('请补齐草稿中的时间／链接，并检查文字');
    const liveLead = api.leads().find(l => l.id === selected.lead.id), liveSession = session();
    if (liveSession?.date !== selected.session.date || (liveSession?.workflowSettings?.revision || 0) !== (selected.session.workflowSettings?.revision || 0)) throw new Error('活动日期或链接已改变，请关闭窗口重新核对');
    const task = C.tasks(liveLead || {}, liveSession || {}, liveLead ? record(liveLead) : {}).find(t => t.key === selected.key);
    if (!liveLead || !liveSession || !['due', 'overdue'].includes(task?.status)) throw new Error('任务状态已改变，请关闭后刷新');
    return text;
  }
  function broadcast() {
    selected = { session: structuredClone(session()) };
    const keys = ['before7', 'before3', 'today'].filter(k => C.addDays(session().date, { before7: -7, before3: -3, today: 0 }[k]) === C.day());
    show('记录活动群公告', `<p>只记录你已人工发布的群公告；不打开或发送群消息。已核实在公告前进群的人会显示“群公告已覆盖”，不会伪记个人私信。</p>${keys.length ? `<form id="pfBroadcast"><label>公告节点<select name="task">${keys.map(k => option(k, C.LABELS[k], '')).join('')}</select></label><label class="pf-check"><input type="checkbox" name="verified" required>我已核实群内受众许可，并实际发布该公告</label><button type="submit">记录群公告</button></form>` : '<p>今天不在本场前 7 天、前 3 天或当天节点，无需补录过时通知。</p>'}`);
  }
  function init(adapter) {
    api = adapter; host = document.getElementById('previewFollowupRoot'); if (!host) return;
    modal = document.createElement('dialog'); modal.className = 'pf-modal'; document.body.append(modal);
    modal.addEventListener('cancel', e => { e.preventDefault(); close(); });
    host.addEventListener('change', e => { if (e.target.id === 'pfSession') sessionId = e.target.value; if (e.target.id === 'pfFilter') filter = e.target.value; render(); });
    host.addEventListener('input', e => { if (e.target.id === 'pfSearch') { search = e.target.value; host.querySelector('tbody').innerHTML = rows(); } });
    modal.addEventListener('input', e => { if (e.target.id === 'pfDraft') { modal.querySelector('#pfReviewed').checked = false; modal.querySelector('#pfSent').checked = false; } if (e.target.id === 'pfAssignSearch') modal.querySelectorAll('[data-search]').forEach(l => l.hidden = !l.dataset.search.includes(e.target.value.toLowerCase())); });
    const onClick = async e => {
      const b = e.target.closest('[data-pf]'); if (!b || busy) return;
      try {
        const action = b.dataset.pf;
        if (action === 'new') api.newSession();
        if (action === 'settings') settings();
        if (action === 'assign') assign();
        if (action === 'profile') profile(b.dataset.lead);
        if (action === 'message') message(b.dataset.lead, b.dataset.task);
        if (action === 'broadcast') broadcast();
        if (action === 'close') close();
        if (action === 'refresh') render();
        if (action === 'copy') { await navigator.clipboard.writeText(checkDraft()); modal.querySelector('#pfError').textContent = '草稿已复制；尚未记录发送。'; }
        if (action === 'open') {
          const text = checkDraft(), phone = root.WhatsappBulkCore.normalizeMalaysiaPhone(selected.lead.phone);
          if (!phone.valid || /^(0+)$/u.test(phone.phone) || /^6060|^600/.test(phone.phone)) throw new Error('请先检查客户电话号码');
          window.open(`https://api.whatsapp.com/send?phone=${phone.phone}&text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
        }
        if (action === 'sent') {
          checkDraft(); if (!modal.querySelector('#pfSent').checked) throw new Error('实际发送后才能勾选并记录');
          const x = selected;
          await save(() => api.updateRecord(x.lead.id, x.session.id, x.record.revision, (previous, lead, s) => C.markSent(lead, s, previous, x.key, 'private'), x.session));
        }
      } catch (err) { error(err); }
    };
    host.addEventListener('click', onClick); modal.addEventListener('click', onClick);
    modal.addEventListener('submit', async e => {
      e.preventDefault(); if (busy) return; const f = e.target, values = Object.fromEntries(new FormData(f)), x = selected;
      if (f.id === 'pfSettings') await save(() => api.updateSession(x.session.id, x.session.workflowSettings?.revision || 0, C.validateSettings(values), x.session.date));
      if (f.id === 'pfProfile') await save(() => api.updateRecord(x.lead.id, x.session.id, x.record.revision, previous => C.patchRecord(previous, { registeredOn: values.registeredOn, permission: values.permission, groupStatus: values.groupStatus, rsvp: values.rsvp, replied: values.replied === 'on' }), x.session));
      if (f.id === 'pfAssign') await save(async () => {
        const ids = new FormData(f).getAll('lead'); if (!ids.length) throw new Error('请先勾选本场报名者');
        for (const id of ids) {
          const checkbox = f.querySelector(`input[value="${CSS.escape(id)}"]`);
          if (checkbox.disabled) continue;
          await api.updateRecord(id, x.session.id, 0, previous => C.patchRecord(previous, { registeredOn: values.registeredOn }), x.session);
          checkbox.checked = false; checkbox.disabled = true;
        }
      });
      if (f.id === 'pfBroadcast') await save(() => api.updateSession(x.session.id, x.session.workflowSettings?.revision || 0, { broadcastTask: values.task }, x.session.date));
    });
    render();
    // Recompute calendar-day tasks in an open page, without background sends.
    setInterval(() => { if (!modal.open) render(); }, 60000);
  }
  root.PreviewFollowup = { init, render, selectSession(id) { sessionId = id; filter = 'due'; search = ''; render(); } };
})(globalThis);
