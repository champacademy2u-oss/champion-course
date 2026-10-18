(function (root) {
  'use strict';
  const LABELS = Object.freeze({ first: '首次 WhatsApp', confirmation: '报名确认', group: '活动群邀请', follow1: '首联后 Day 1', follow3: '首联后 Day 3', follow7: '首联后 Day 7', before7: '活动前 7 天', before3: '活动前 3 天', today: '活动当天通知' });
  function day(value = new Date()) {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
  function validDate(s) { const d = new Date(`${s}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s; }
  function addDays(s, n) {
    if (!validDate(s)) return '';
    const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
  }
  function read(value = {}) {
    return { ...value, registeredOn: validDate(value.registeredOn) ? value.registeredOn : '', permission: ['allowed', 'stopped'].includes(value.permission) ? value.permission : 'unknown',
      groupStatus: ['invited', 'joined'].includes(value.groupStatus) ? value.groupStatus : 'pending',
      rsvp: ['yes', 'unsure', 'no'].includes(value.rsvp) ? value.rsvp : 'unknown', replied: value.replied === true,
      logs: Array.isArray(value.logs) ? value.logs.filter(l => LABELS[l.task] && ['private', 'group'].includes(l.channel) && Number.isFinite(Date.parse(l.at))) : [], revision: Number(value.revision) || 0 };
  }
  function mergeMaps(a = {}, b = {}) {
    const out = { ...a };
    for (const [key, incoming] of Object.entries(b || {})) {
      const existing = out[key];
      if (!existing || (incoming.updatedAt || '') > (existing.updatedAt || '') || ((incoming.updatedAt || '') === (existing.updatedAt || '') && (incoming.revision || 0) > (existing.revision || 0))) out[key] = incoming;
    }
    return out;
  }
  function stopped(lead, rec) { return rec.permission === 'stopped' || ['opted_out', 'unsubscribed', 'lost', 'not_interested'].includes(lead.status); }
  function tasks(lead, session, raw, now = new Date()) {
    const r = read(raw), today = day(now), joined = r.registeredOn;
    const first = r.logs.find(l => l.task === 'first' && l.channel === 'private');
    const broadcasts = Array.isArray(session.workflowSettings?.broadcasts) ? session.workflowSettings.broadcasts : [];
    return Object.keys(LABELS).map(key => {
      const offset = { follow1: 1, follow3: 3, follow7: 7, before7: -7, before3: -3, today: 0 }[key];
      const eventTask = ['before7', 'before3', 'today'].includes(key), follow = key.startsWith('follow');
      const due = eventTask ? addDays(session.date, offset) : follow ? (first ? addDays(day(first.at), offset) : '') : joined;
      const log = r.logs.find(l => l.task === key);
      const broadcast = eventTask && r.groupStatus === 'joined' && r.groupJoinedAt ? broadcasts.find(l => l.task === key && l.eventDate === session.date && l.at >= r.groupJoinedAt) : null;
      let status;
      if (log) status = 'sent';
      else if (broadcast) status = 'covered';
      else if (stopped(lead, r)) status = 'paused';
      else if (!joined || !validDate(session.date)) status = 'setup';
      else if (eventTask && (joined > due || today > due)) status = 'na';
      else if (eventTask && r.rsvp === 'no') status = 'paused';
      else if (follow && (!first || r.replied || ['interested', 'converted'].includes(lead.status))) status = 'paused';
      else if (follow && (today > session.date || due >= session.date)) status = 'na';
      else if (key === 'group' && r.groupStatus === 'joined') status = 'na';
      else if (today > session.date) status = 'na';
      else if (r.permission !== 'allowed') status = 'permission';
      else if (due > today) status = 'upcoming';
      // At most the latest unanswered follow-up is actionable; never catch up all missed messages.
      else if (follow && Object.entries({ follow1: 1, follow3: 3, follow7: 7 }).some(([k, n]) => n > offset && addDays(day(first.at), n) <= today && addDays(day(first.at), n) < session.date)) status = 'na';
      else status = due < today ? 'overdue' : 'due';
      return { key, label: LABELS[key], due, status, log: log || broadcast || null };
    });
  }
  function safeUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
  function draft(key, lead, session) {
    const s = session.workflowSettings || {}, name = lead.name || '您好';
    const info = `《${session.title}》\n📅 ${session.date}\n🕗 ${s.time || '[请填写活动时间]'}（马来西亚时间）\n📍 线上 Zoom`;
    if (key === 'first') return `Hi ${name}，你好 😊\n我是 Sim，来自 Champ Academy。\n收到你对《${session.title}》的报名资料，想与你确认一下：你目前最想解决的是引流、成交，还是团队执行？`;
    if (key === 'confirmation') return `Hi ${name}，你的报名资料已登记 ✅\n${info}\n\n方便的话，请回复是否能参加。我们会在活动前发送上课通知。`;
    if (key === 'group') return `Hi ${name}，这是《${session.title}》的活动 WhatsApp 群邀请：\n${safeUrl(s.groupUrl) || '[请填写活动群链接]'}\n\n你可以自愿加入，接收本次活动资料与上课通知。`;
    if (key.startsWith('follow')) return `Hi ${name}，你好 😊\n想与你确认《${session.title}》的活动资料是否有收到？如有课程或参加方式的问题，可以直接告诉我。若不需要本次提醒，也请告诉我。`;
    const intro = key === 'before7' ? '距离活动还有一周，提醒你预留时间 😊' : key === 'before3' ? '还有 3 天就到我们的活动了 😊 你当天方便参加吗？' : '今天就是我们的活动 😊';
    return `Hi ${name}，${intro}\n\n${info}${key === 'today' ? `\n\nZoom 入口：${safeUrl(s.zoomUrl) || '[请填写 Zoom 链接]'}` : '\n\n可以先准备一个目前生意上最想解决的问题，带到课堂一起思考。'}`;
  }
  function validateSettings(s) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time || '')) throw new Error('请填写有效活动时间');
    for (const key of ['groupUrl', 'zoomUrl']) if (s[key] && !safeUrl(s[key])) throw new Error('群邀请与 Zoom 链接必须使用有效 HTTPS 地址');
    return { time: s.time, groupUrl: s.groupUrl || '', zoomUrl: s.zoomUrl || '' };
  }
  function patchRecord(previous, patch, now = new Date()) {
    const old = read(previous), next = read({ ...old, ...patch });
    if (!validDate(next.registeredOn) || next.registeredOn > day(now)) throw new Error('报名日期必须是今天或过去的有效日期');
    next.groupJoinedAt = next.groupStatus === 'joined' ? (old.groupStatus === 'joined' && old.groupJoinedAt ? old.groupJoinedAt : new Date(now).toISOString()) : '';
    return { ...next, revision: old.revision + 1, updatedAt: new Date(now).toISOString() };
  }
  function markSent(lead, session, previous, key, channel, now = new Date()) {
    const old = read(previous), task = tasks(lead, session, old, now).find(t => t.key === key);
    if (!task || !['due', 'overdue'].includes(task.status)) throw new Error('该任务现在不可记录发送，请刷新检查日期、许可或重复通知');
    if (channel !== 'private') throw new Error('个人任务只记录私信；群公告请使用活动群公告入口');
    const result = patchRecord(old, key === 'group' && old.groupStatus !== 'joined' ? { groupStatus: 'invited' } : {}, now);
    result.logs = [...old.logs, { task: key, channel, at: new Date(now).toISOString(), eventDate: session.date }];
    return result;
  }
  root.PreviewFollowupCore = Object.freeze({ LABELS, day, validDate, addDays, read, mergeMaps, stopped, tasks, draft, validateSettings, patchRecord, markSent });
})(globalThis);
