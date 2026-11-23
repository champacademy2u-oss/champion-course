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

export default async function handler(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const input = await requestBody(req);
    if (cleanText(input.website, 200)) return sendJson(res, 201, { ok: true, communityUrl: '' });

    const lead = normalizePreviewLead(input);
    await enforceRateLimit(req);

    // Every valid form submission is a separate registration. Do not derive the
    // document id from contact details: the same person may register more than
    // once and every submission must be counted independently.
    const leadRef = db().collection('preview_leads').doc(crypto.randomUUID());
    const submittedAt = now();
    const timestamp = fieldValue().serverTimestamp();
    const summitOffer = cleanText(input.campaignId, 80) === 'champ-summit-2027'
      ? { campaignId: 'champ-summit-2027', currency: 'MYR', amountMinor: 0, paymentStatus: 'free' }
      : {};
    await leadRef.create({
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      state: lead.state,
      source: lead.source,
      campaign: lead.campaign,
      courseDate: lead.courseDate,
      ...summitOffer,
      submittedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

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
