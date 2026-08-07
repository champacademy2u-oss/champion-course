import { db, sendJson } from '../api/_firebase.js';
import {
  cleanText,
  isTrackedCtaClick,
  verifyResendWebhook
} from './email-campaign-core.js';

const SUPPORTED_EVENTS = new Set([
  'email.sent',
  'email.delivered',
  'email.opened',
  'email.clicked',
  'email.bounced',
  'email.failed',
  'email.complained',
  'email.suppressed'
]);

function safeEventTime(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function terminalDeliveryStatus(recipient) {
  if (recipient.complainedAt) return 'complained';
  if (recipient.bouncedAt) return 'bounced';
  if (recipient.failedAt) return 'failed';
  return '';
}

export function webhookRecipientMutation(event, campaign, recipient = {}) {
  const type = cleanText(event?.type, 80);
  const occurredAt = safeEventTime(event?.data?.click?.timestamp || event?.created_at || event?.data?.created_at);
  const update = { updatedAt: new Date().toISOString(), lastEventAt: occurredAt };
  let tracked = SUPPORTED_EVENTS.has(type);
  let link = '';
  let suppressionReason = '';

  if (type === 'email.sent') {
    update.sentAt = recipient.sentAt || occurredAt;
    if (!terminalDeliveryStatus(recipient)) update.status = 'sent';
  } else if (type === 'email.delivered') {
    update.deliveredAt = recipient.deliveredAt || occurredAt;
    if (!terminalDeliveryStatus(recipient)) update.status = 'delivered';
  } else if (type === 'email.opened') {
    update.firstOpenedAt = recipient.firstOpenedAt || occurredAt;
    update.lastOpenedAt = occurredAt;
    update.openCount = (Number(recipient.openCount) || 0) + 1;
  } else if (type === 'email.clicked') {
    link = cleanText(event?.data?.click?.link, 2048);
    tracked = isTrackedCtaClick(event, campaign);
    if (tracked) {
      update.firstClickedAt = recipient.firstClickedAt || occurredAt;
      update.lastClickedAt = occurredAt;
      update.clickCount = (Number(recipient.clickCount) || 0) + 1;
    }
  } else if (type === 'email.bounced') {
    update.bouncedAt = recipient.bouncedAt || occurredAt;
    update.status = 'bounced';
    suppressionReason = 'bounced';
  } else if (type === 'email.failed') {
    update.failedAt = recipient.failedAt || occurredAt;
    update.status = 'failed';
  } else if (type === 'email.suppressed') {
    update.failedAt = recipient.failedAt || occurredAt;
    update.status = 'failed';
    suppressionReason = 'suppressed';
  } else if (type === 'email.complained') {
    update.complainedAt = recipient.complainedAt || occurredAt;
    update.status = 'complained';
    suppressionReason = 'complained';
  }

  return { type, occurredAt, update, tracked, link, suppressionReason };
}

async function applyWebhookEvent(event, webhookId) {
  const type = cleanText(event?.type, 80);
  const emailId = cleanText(event?.data?.email_id, 240);
  if (!type || !emailId) throw new Error('Webhook 事件资料不完整');
  const eventRef = db().collection('email_webhook_events').doc(webhookId);
  const messageRef = db().collection('email_messages').doc(emailId);

  return db().runTransaction(async transaction => {
    const [existingEvent, messageSnap] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(messageRef)
    ]);
    if (existingEvent.exists) return { duplicate: true };
    if (!messageSnap.exists) {
      const error = new Error('Email Message Mapping 尚未建立');
      error.retryable = true;
      throw error;
    }

    const campaignId = cleanText(messageSnap.get('campaignId'), 180);
    const recipientId = cleanText(messageSnap.get('recipientId'), 180);
    const campaignRef = db().collection('email_campaigns').doc(campaignId);
    const recipientRef = campaignRef.collection('recipients').doc(recipientId);
    const [campaignSnap, recipientSnap] = await Promise.all([
      transaction.get(campaignRef),
      transaction.get(recipientRef)
    ]);
    if (!campaignSnap.exists || !recipientSnap.exists) throw new Error('Email Campaign 记录不存在');

    const campaign = campaignSnap.data() || {};
    const recipient = recipientSnap.data() || {};
    const mutation = webhookRecipientMutation(event, campaign, recipient);
    if (mutation.suppressionReason) {
      transaction.set(db().collection('email_suppressions').doc(recipient.emailHash), {
        reason: mutation.suppressionReason,
        createdAt: mutation.occurredAt,
        updatedAt: mutation.occurredAt
      }, { merge: true });
    }

    if (SUPPORTED_EVENTS.has(type)) transaction.set(recipientRef, mutation.update, { merge: true });
    transaction.create(eventRef, {
      type,
      emailId,
      occurredAt: mutation.occurredAt,
      tracked: mutation.tracked,
      link: mutation.tracked && type === 'email.clicked' ? mutation.link : '',
      createdAt: new Date().toISOString()
    });
    return { duplicate: false, tracked: mutation.tracked };
  });
}

export async function handleEmailWebhook(req, res, rawBody) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const webhookId = cleanText(req.headers['svix-id'], 300);
    const timestamp = cleanText(req.headers['svix-timestamp'], 100);
    const signature = cleanText(req.headers['svix-signature'], 6000);
    verifyResendWebhook({
      id: webhookId,
      timestamp,
      signature,
      payload: rawBody,
      secret: process.env.RESEND_WEBHOOK_SECRET
    });
    const event = JSON.parse(rawBody);
    const result = await applyWebhookEvent(event, webhookId);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    const status = error?.retryable ? 503 : 400;
    return sendJson(res, status, { error: error?.retryable ? 'Webhook 稍后重试' : 'Webhook 无效' });
  }
}

export const emailWebhookInternals = { applyWebhookEvent };
