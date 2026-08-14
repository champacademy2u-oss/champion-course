import crypto from 'node:crypto';
import { db, fieldValue, now, readJson, sendJson } from './_firebase.js';
import {
  allowedPreviewLeadOrigins,
  cleanText,
  normalizePreviewLead,
  safeCommunityUrl
} from '../lib/preview-lead-core.js';

function applyCors(req, res) {
  const origin = cleanText(req.headers.origin, 300);
  const allowed = allowedPreviewLeadOrigins(process.env.PREVIEW_LEAD_ALLOWED_ORIGINS);
  if (origin && !allowed.has(origin)) {
    sendJson(res, 403, { error: '此来源不允许提交报名资料' });
    return false;
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return false;
  }
  return true;
}

async function requestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { throw new Error('资料格式不正确'); }
  }
  return readJson(req, 32 * 1024);
}

function requestIp(req) {
  return cleanText(req.headers['x-forwarded-for'], 300).split(',')[0].trim()
    || cleanText(req.socket?.remoteAddress, 100)
    || 'unknown';
}

async function enforceRateLimit(req) {
  const hour = new Date().toISOString().slice(0, 13);
  const key = crypto.createHash('sha256').update(`${hour}|${requestIp(req)}`).digest('hex');
  const ref = db().collection('preview_lead_rate_limits').doc(key);
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

function dailyLeadId(lead) {
  const malaysiaDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  return crypto.createHash('sha256')
    .update(`${lead.email}|${lead.phoneDigits}|${lead.source}|${malaysiaDate}`)
    .digest('hex');
}

export default async function handler(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const input = await requestBody(req);
    if (cleanText(input.website, 200)) return sendJson(res, 201, { ok: true, communityUrl: '' });

    const lead = normalizePreviewLead(input);
    await enforceRateLimit(req);

    const leadRef = db().collection('preview_leads').doc(dailyLeadId(lead));
    const submittedAt = now();
    const existing = await leadRef.get();
    const timestamp = fieldValue().serverTimestamp();
    await leadRef.set({
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      state: lead.state,
      source: lead.source,
      campaign: lead.campaign,
      courseDate: '2026-08-28',
      submittedAt,
      updatedAt: timestamp,
      ...(existing.exists ? {} : { createdAt: timestamp })
    }, { merge: true });

    const settings = await db().collection('settings').doc('main').get();
    return sendJson(res, 201, {
      ok: true,
      communityUrl: safeCommunityUrl(settings.get('communityUrl'))
    });
  } catch (error) {
    const message = cleanText(error?.message || '暂时无法提交报名，请稍后再试', 200);
    const status = message.includes('次数太多') ? 429 : 400;
    return sendJson(res, status, { error: message });
  }
}
