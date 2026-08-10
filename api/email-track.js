import { db } from './_firebase.js';
import { cleanText, validateHttpsUrl, verifyEmailTrackingToken } from '../lib/email-campaign-core.js';

const PIXEL = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');

function trackingSecret() {
  const value = cleanText(process.env.EMAIL_TRACKING_SECRET, 1000);
  if (!value) throw new Error('Tracking is not configured');
  return value;
}

function sendPixel(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', String(PIXEL.length));
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(PIXEL);
}

function renderError(res) {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end('<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>链接无效</title></head><body style="font-family:Arial,sans-serif;padding:40px"><h1>链接无效</h1><p>这个 Email 链接无效或已经无法使用。</p></body></html>');
}

async function updateRecipientEvent(campaignId, recipientId, kind) {
  const recipientRef = db().collection('email_campaigns').doc(campaignId).collection('recipients').doc(recipientId);
  await db().runTransaction(async transaction => {
    const snap = await transaction.get(recipientRef);
    if (!snap.exists || !snap.get('emailHash')) throw new Error('Recipient not found');
    const timestamp = new Date().toISOString();
    const currentStatus = snap.get('status') || 'sent';
    if (kind === 'open') {
      transaction.set(recipientRef, {
        status: currentStatus === 'sent' ? 'opened' : currentStatus,
        firstOpenedAt: snap.get('firstOpenedAt') || timestamp,
        lastOpenedAt: timestamp,
        openCount: (Number(snap.get('openCount')) || 0) + 1,
        updatedAt: timestamp
      }, { merge: true });
      return;
    }
    transaction.set(recipientRef, {
      status: 'clicked',
      firstClickedAt: snap.get('firstClickedAt') || timestamp,
      lastClickedAt: timestamp,
      clickCount: (Number(snap.get('clickCount')) || 0) + 1,
      updatedAt: timestamp
    }, { merge: true });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return renderError(res);
  const url = new URL(req.url, 'https://local');
  const action = cleanText(url.searchParams.get('action'), 20);
  if (!['open', 'click'].includes(action)) return renderError(res);
  try {
    const token = cleanText(url.searchParams.get('token'), 4000);
    const { campaignId, recipientId } = verifyEmailTrackingToken(token, trackingSecret(), action);
    await updateRecipientEvent(campaignId, recipientId, action);
    if (action === 'open') return sendPixel(res);
    const campaignSnap = await db().collection('email_campaigns').doc(campaignId).get();
    if (!campaignSnap.exists) throw new Error('Campaign not found');
    const destination = validateHttpsUrl(campaignSnap.get('ctaUrl'));
    res.statusCode = 302;
    res.setHeader('Location', destination);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.end();
  } catch {
    if (action === 'open') return sendPixel(res);
    return renderError(res);
  }
}
