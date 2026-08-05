import crypto from 'node:crypto';
import { db, firebaseApp, readJson, sendJson } from '../api/_firebase.js';
import {
  DEFAULT_TIMEZONE,
  cleanText,
  duplicateRegistrationId,
  eventStartIso,
  fillTemplate,
  formatEventDate,
  publicEvent,
  safeSource,
  validateRegistration
} from './zoom-core.js';

const defaultAllowedOrigins = 'https://champacademy2u-oss.github.io,http://localhost:4175,http://127.0.0.1:4175';

function applyCors(req, res) {
  const origin = cleanText(req.headers.origin, 300);
  const allowed = new Set(String(process.env.ZOOM_ALLOWED_ORIGINS || defaultAllowedOrigins).split(',').map(value => value.trim()).filter(Boolean));
  if (origin && !allowed.has(origin)) {
    sendJson(res, 403, { error: '此来源不允许使用报名服务' });
    return false;
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-AppCheck');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return false;
  }
  return true;
}

function requireMethod(req, res, expected) {
  if (req.method === expected) return true;
  sendJson(res, 405, { error: 'Method not allowed' });
  return false;
}

function errorStatus(error) {
  if (['未授权', '管理员浏览器尚未绑定', '此浏览器没有 Zoom 管理权限'].includes(error.message)) return 401;
  if (error.message === '活动名额已满') return 409;
  if (['目前没有开放报名的活动', '本场活动已停止报名'].includes(error.message)) return 410;
  if (error.message.includes('次数太多')) return 429;
  return 400;
}

function safeError(error) {
  return cleanText(error?.message || '操作失败', 240).replace(/Bearer\s+\S+/gi, 'Bearer [hidden]');
}

async function requireZoomAdmin(req) {
  const header = cleanText(req.headers.authorization, 5000);
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new Error('未授权');
  const allowed = new Set(String(process.env.ZOOM_ADMIN_UIDS || '').split(',').map(value => value.trim()).filter(Boolean));
  if (!allowed.size) throw new Error('管理员浏览器尚未绑定');
  try {
    const decoded = await firebaseApp().auth().verifyIdToken(token);
    if (!allowed.has(decoded.uid)) throw new Error('此浏览器没有 Zoom 管理权限');
    return decoded;
  } catch {
    throw new Error('此浏览器没有 Zoom 管理权限');
  }
}

async function verifyAppCheck(req) {
  if (String(process.env.ZOOM_APP_CHECK_ENFORCED || '').toLowerCase() !== 'true') return;
  const token = cleanText(req.headers['x-firebase-appcheck'], 5000);
  if (!token) throw new Error('报名验证失败，请刷新页面再试');
  try {
    await firebaseApp().appCheck().verifyToken(token);
  } catch {
    throw new Error('报名验证失败，请刷新页面再试');
  }
}

async function enforceRateLimit(req) {
  const forwarded = cleanText(req.headers['x-forwarded-for'], 300).split(',')[0].trim();
  const ip = forwarded || cleanText(req.socket?.remoteAddress, 100) || 'unknown';
  const hour = new Date().toISOString().slice(0, 13);
  const key = crypto.createHash('sha256').update(`${hour}|${ip}`).digest('hex');
  const ref = db().collection('zoom_rate_limits').doc(key);
  await db().runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    const count = Number(snap.get('count')) || 0;
    if (count >= 10) throw new Error('报名次数太多，请稍后再试');
    transaction.set(ref, {
      count: count + 1,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    }, { merge: true });
  });
}

async function activeEventDoc() {
  const snap = await db().collection('zoom_events').where('status', '==', 'published').limit(20).get();
  return snap.docs
    .filter(doc => new Date(doc.get('startsAt')).getTime() > Date.now())
    .sort((a, b) => new Date(a.get('startsAt')) - new Date(b.get('startsAt')))[0] || null;
}

function validHttpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function eventInput(input = {}, existing = {}) {
  const title = cleanText(input.title, 120);
  const eventDate = cleanText(input.eventDate, 10);
  const eventTime = cleanText(input.eventTime, 5);
  const startsAt = eventStartIso(eventDate, eventTime);
  const joinUrl = cleanText(input.joinUrl, 1000);
  const status = ['draft', 'published', 'closed'].includes(input.status) ? input.status : 'draft';
  if (!title) throw new Error('请填写活动名称');
  if (!startsAt) throw new Error('请填写正确的活动日期和时间');
  if (status === 'published' && !validHttpsUrl(joinUrl)) throw new Error('发布前必须填写完整的 https Zoom 链接');
  if (joinUrl && !validHttpsUrl(joinUrl)) throw new Error('Zoom 链接必须以 https:// 开头');
  return {
    title,
    subtitle: cleanText(input.subtitle, 240),
    speakerName: cleanText(input.speakerName, 100),
    eventDate,
    eventTime,
    timezone: DEFAULT_TIMEZONE,
    startsAt,
    joinUrl,
    status,
    seatLimit: Math.max(0, Math.min(100000, Number(input.seatLimit) || 0)),
    registeredCount: Math.max(0, Number(existing.registeredCount) || 0),
    sendWhatsapp: input.sendWhatsapp !== false,
    sendEmail: input.sendEmail !== false,
    whatsappTemplateName: cleanText(input.whatsappTemplateName, 100) || process.env.WHATSAPP_TEMPLATE_CONFIRMATION || 'champion_zoom_confirmation',
    whatsappReminderTemplateName: cleanText(input.whatsappReminderTemplateName, 100) || process.env.WHATSAPP_TEMPLATE_REMINDER || 'champion_zoom_reminder',
    whatsappMessage: cleanText(input.whatsappMessage, 4000),
    emailSubject: cleanText(input.emailSubject, 240) || '{{event}}｜Zoom 报名确认',
    emailBody: cleanText(input.emailBody, 12000) || 'Hi {{name}}，\n\n感谢您报名 {{event}}。\n\n日期：{{date}}\n时间：{{time}}\nZoom 链接：{{zoom_link}}\n\nChampion Academy',
    reminderEmailSubject: cleanText(input.reminderEmailSubject, 240) || '提醒｜{{event}} 即将开始',
    reminderEmailBody: cleanText(input.reminderEmailBody, 12000) || 'Hi {{name}}，\n\n提醒您，{{event}} 将在 {{date}} {{time}} 开始。\n\nZoom 链接：{{zoom_link}}\n\nChampion Academy',
    updatedAt: new Date().toISOString(),
    createdAt: cleanText(existing.createdAt, 40) || new Date().toISOString()
  };
}

function templateValues(registration, event) {
  return {
    name: registration.name,
    event: event.title,
    date: formatEventDate(event),
    time: `${event.eventTime}（马来西亚时间 GMT+8）`,
    zoom_link: event.joinUrl
  };
}

async function reserveSendSlot() {
  const date = new Date().toISOString().slice(0, 10);
  const ref = db().collection('zoom_delivery_counters').doc(date);
  const limit = Math.max(1, Number(process.env.DAILY_SEND_LIMIT) || 500);
  await db().runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    const count = Number(snap.get('count')) || 0;
    if (count >= limit) throw new Error('今日自动发送已达到安全上限');
    transaction.set(ref, { count: count + 1, updatedAt: new Date().toISOString() }, { merge: true });
  });
}

async function withRetry(operation, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await operation();
      return attempt;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await new Promise(resolve => setTimeout(resolve, 250 * (2 ** (attempt - 1))));
    }
  }
  lastError.attempts = maxAttempts;
  throw lastError;
}

async function sendWhatsapp(registration, event, stage) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || '';
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  if (!token || !phoneNumberId) throw new Error('WhatsApp Cloud API 尚未配置');
  const values = templateValues(registration, event);
  const templateName = stage === 'confirmation' ? event.whatsappTemplateName : event.whatsappReminderTemplateName;
  await reserveSendSlot();
  const response = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v21.0'}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: registration.phone.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: templateName,
        language: { code: process.env.WHATSAPP_LANGUAGE || 'zh_CN' },
        components: [{
          type: 'body',
          parameters: [values.name, values.event, values.date, values.time, values.zoom_link]
            .map(text => ({ type: 'text', text: cleanText(text, 1000) }))
        }]
      }
    })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(cleanText(data?.error?.message, 220) || `WhatsApp 发送失败（${response.status}）`);
  }
}

function htmlEmail(text) {
  return cleanText(text, 12000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

async function sendEmail(registration, event, stage) {
  const apiKey = process.env.RESEND_API_KEY || '';
  const from = process.env.EMAIL_FROM || '';
  if (!apiKey || !from) throw new Error('Email 发送服务尚未配置');
  const values = templateValues(registration, event);
  const reminder = stage !== 'confirmation';
  await reserveSendSlot();
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [registration.email],
      subject: fillTemplate(reminder ? event.reminderEmailSubject : event.emailSubject, values),
      html: `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#18212b">${htmlEmail(fillTemplate(reminder ? event.reminderEmailBody : event.emailBody, values))}</div>`
    })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(cleanText(data?.message, 220) || `Email 发送失败（${response.status}）`);
  }
}

async function deliverStage(registrationRef, registration, event, stage) {
  const current = registration.deliveries?.[stage] || {};
  const result = {
    whatsapp: event.sendWhatsapp === false ? 'disabled' : current.whatsapp === 'sent' ? 'sent' : 'pending',
    email: event.sendEmail === false ? 'disabled' : current.email === 'sent' ? 'sent' : 'pending',
    attempts: { ...(current.attempts || {}) },
    errors: { ...(current.errors || {}) },
    attemptedAt: new Date().toISOString()
  };
  for (const [channel, send] of [['whatsapp', sendWhatsapp], ['email', sendEmail]]) {
    if (result[channel] !== 'pending') continue;
    try {
      result.attempts[channel] = await withRetry(() => send(registration, event, stage));
      result[channel] = 'sent';
      delete result.errors[channel];
    } catch (error) {
      result[channel] = 'failed';
      result.attempts[channel] = Number(error.attempts) || 3;
      result.errors[channel] = safeError(error);
    }
  }
  if (['sent', 'disabled'].includes(result.whatsapp) && ['sent', 'disabled'].includes(result.email)) {
    result.completedAt = new Date().toISOString();
  }
  await registrationRef.update({ [`deliveries.${stage}`]: result, updatedAt: new Date().toISOString() });
  return result;
}

async function getActiveZoomEventHandler(req, res) {
  if (!applyCors(req, res) || !requireMethod(req, res, 'GET')) return;
  try {
    const doc = await activeEventDoc();
    if (!doc) return sendJson(res, 404, { error: '目前没有开放报名的活动' });
    return sendJson(res, 200, { event: publicEvent({ id: doc.id, ...doc.data() }) });
  } catch (error) {
    return sendJson(res, 400, { error: safeError(error) });
  }
}

async function registerForZoomHandler(req, res) {
  if (!applyCors(req, res) || !requireMethod(req, res, 'POST')) return;
  try {
    await verifyAppCheck(req);
    await enforceRateLimit(req);
    const input = await readJson(req);
    const person = validateRegistration(input);
    const eventDoc = await activeEventDoc();
    if (!eventDoc) throw new Error('目前没有开放报名的活动');
    const eventId = eventDoc.id;
    const eventRef = eventDoc.ref;
    const registrationId = duplicateRegistrationId(eventId, person.email, person.phone);
    const registrationRef = db().collection('zoom_registrations').doc(registrationId);
    let created = false;
    let registration;
    await db().runTransaction(async transaction => {
      const [freshEventDoc, existingDoc] = await Promise.all([transaction.get(eventRef), transaction.get(registrationRef)]);
      const event = freshEventDoc.data();
      if (!freshEventDoc.exists || event.status !== 'published' || new Date(event.startsAt).getTime() <= Date.now()) {
        throw new Error('本场活动已停止报名');
      }
      if (existingDoc.exists) {
        registration = { id: existingDoc.id, ...existingDoc.data() };
        return;
      }
      const seatLimit = Number(event.seatLimit) || 0;
      const registeredCount = Number(event.registeredCount) || 0;
      if (seatLimit > 0 && registeredCount >= seatLimit) throw new Error('活动名额已满');
      const timestamp = new Date().toISOString();
      registration = {
        id: registrationId,
        eventId,
        name: person.name,
        email: person.email,
        phone: person.phone,
        consentAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        source: safeSource(input),
        deliveries: {}
      };
      transaction.create(registrationRef, registration);
      transaction.update(eventRef, { registeredCount: registeredCount + 1, updatedAt: timestamp });
      created = true;
    });
    if (!created) {
      return sendJson(res, 200, {
        ok: true,
        duplicate: true,
        message: '您已经报名本场活动，请查看之前收到的 WhatsApp 和 Email。',
        delivery: registration.deliveries?.confirmation || null
      });
    }
    const event = { id: eventDoc.id, ...eventDoc.data() };
    const delivery = await deliverStage(registrationRef, registration, event, 'confirmation');
    return sendJson(res, 201, {
      ok: true,
      duplicate: false,
      message: '报名成功，Zoom 资料已安排发送到您的 WhatsApp 和 Email。',
      delivery: { whatsapp: delivery.whatsapp, email: delivery.email }
    });
  } catch (error) {
    return sendJson(res, errorStatus(error), { error: safeError(error) });
  }
}

async function adminZoomDataHandler(req, res) {
  if (!applyCors(req, res) || !requireMethod(req, res, 'GET')) return;
  try {
    await requireZoomAdmin(req);
    const [eventsSnap, registrationsSnap] = await Promise.all([
      db().collection('zoom_events').orderBy('createdAt', 'desc').limit(30).get(),
      db().collection('zoom_registrations').orderBy('createdAt', 'desc').limit(300).get()
    ]);
    return sendJson(res, 200, {
      events: eventsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      registrations: registrationsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      legacy: null,
      service: {
        whatsappConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
        emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
      }
    });
  } catch (error) {
    return sendJson(res, errorStatus(error), { error: safeError(error) });
  }
}

async function saveZoomEventHandler(req, res) {
  if (!applyCors(req, res) || !requireMethod(req, res, 'PUT')) return;
  try {
    await requireZoomAdmin(req);
    const input = await readJson(req);
    const eventId = cleanText(input.id, 120) || db().collection('zoom_events').doc().id;
    const ref = db().collection('zoom_events').doc(eventId);
    const currentSnap = await ref.get();
    const event = eventInput(input, currentSnap.exists ? currentSnap.data() : {});
    const publishedSnap = event.status === 'published'
      ? await db().collection('zoom_events').where('status', '==', 'published').limit(30).get()
      : null;
    const batch = db().batch();
    publishedSnap?.docs.filter(doc => doc.id !== eventId).forEach(doc => {
      batch.set(doc.ref, { status: 'closed', updatedAt: new Date().toISOString() }, { merge: true });
    });
    batch.set(ref, event, { merge: true });
    await batch.commit();
    return sendJson(res, currentSnap.exists ? 200 : 201, { ok: true, event: { id: eventId, ...event } });
  } catch (error) {
    return sendJson(res, errorStatus(error), { error: safeError(error) });
  }
}

async function resendZoomNotificationHandler(req, res) {
  if (!applyCors(req, res) || !requireMethod(req, res, 'POST')) return;
  try {
    await requireZoomAdmin(req);
    const input = await readJson(req);
    const registrationId = cleanText(input.registrationId, 120);
    const registrationRef = db().collection('zoom_registrations').doc(registrationId);
    const registrationSnap = await registrationRef.get();
    if (!registrationSnap.exists) throw new Error('找不到报名记录');
    const registration = { id: registrationSnap.id, ...registrationSnap.data(), deliveries: { ...registrationSnap.get('deliveries'), confirmation: {} } };
    const eventSnap = await db().collection('zoom_events').doc(registration.eventId).get();
    if (!eventSnap.exists) throw new Error('找不到活动资料');
    const delivery = await deliverStage(registrationRef, registration, { id: eventSnap.id, ...eventSnap.data() }, 'confirmation');
    return sendJson(res, 200, { ok: true, delivery });
  } catch (error) {
    return sendJson(res, errorStatus(error), { error: safeError(error) });
  }
}

export {
  adminZoomDataHandler,
  getActiveZoomEventHandler,
  registerForZoomHandler,
  resendZoomNotificationHandler,
  saveZoomEventHandler
};
