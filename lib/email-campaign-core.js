import crypto from 'node:crypto';

export const EMAIL_CAMPAIGN_MAX_RECIPIENTS = 500;
export const EMAIL_SEND_BATCH_SIZE = 25;

export const EMAIL_SOURCE_CONFIG = Object.freeze({
  leads: { collection: 'leads', label: 'Leads' },
  preview_learning: {
    collection: 'preview_leads',
    label: 'Preview Leads',
    expectedSource: 'Champ Learning Landing Page'
  },
  preview_landing: {
    collection: 'preview_leads',
    label: 'Landing Leads',
    expectedSource: 'Champ Preview Landing Page'
  }
});

export function cleanText(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function normalizeEmail(value) {
  return cleanText(value, 320).toLowerCase();
}

export function emailIsValid(value) {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function sha256Id(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function suppressionId(email) {
  return sha256Id(normalizeEmail(email));
}

export function validateAudienceSelections(value) {
  const selections = Array.isArray(value) ? value : [];
  const normalized = [];
  let total = 0;

  for (const selection of selections) {
    const source = cleanText(selection?.source, 40);
    if (!EMAIL_SOURCE_CONFIG[source]) throw new Error('名单来源不正确');
    const ids = Array.from(new Set((Array.isArray(selection?.ids) ? selection.ids : [])
      .map(id => cleanText(id, 180))
      .filter(id => id && !id.includes('/'))));
    if (!ids.length) continue;
    total += ids.length;
    normalized.push({ source, ids });
  }

  if (!normalized.length) throw new Error('请至少选择一位收件人');
  if (total > EMAIL_CAMPAIGN_MAX_RECIPIENTS) {
    throw new Error(`每个 Campaign 最多 ${EMAIL_CAMPAIGN_MAX_RECIPIENTS} 位收件人`);
  }
  return normalized;
}

export function validateHttpsUrl(value, label = 'CTA 链接') {
  const text = cleanText(value, 2048);
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') throw new Error();
    return url.toString();
  } catch {
    throw new Error(`${label}必须是完整的 https:// 链接`);
  }
}

export function sanitizeCampaignInput(input = {}) {
  const campaign = {
    internalName: cleanText(input.internalName, 120),
    subject: cleanText(input.subject, 200),
    previewText: cleanText(input.previewText, 240),
    bodyText: cleanText(input.bodyText, 12000),
    ctaLabel: cleanText(input.ctaLabel, 80),
    ctaUrl: validateHttpsUrl(input.ctaUrl)
  };
  if (!campaign.internalName) throw new Error('请填写 Campaign 名称');
  if (!campaign.subject) throw new Error('请填写 Email 标题');
  if (!campaign.bodyText) throw new Error('请填写 Email 内容');
  if (!campaign.ctaLabel) throw new Error('请填写按钮文字');
  return campaign;
}

export function contentFingerprint(campaign) {
  return sha256Id([
    campaign.internalName,
    campaign.subject,
    campaign.previewText,
    campaign.bodyText,
    campaign.ctaLabel,
    campaign.ctaUrl
  ].join('\u0000'));
}

export function applyNameTemplate(value, name) {
  return String(value ?? '').replaceAll('{{name}}', cleanText(name, 160) || '朋友');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToEmailHtml(value) {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .map(paragraph => `<p style="margin:0 0 18px">${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function buildEmailContent({ campaign, recipient, unsubscribeUrl }) {
  const name = cleanText(recipient?.name, 160) || '朋友';
  const subject = applyNameTemplate(campaign.subject, name);
  const previewText = applyNameTemplate(campaign.previewText, name);
  const bodyText = applyNameTemplate(campaign.bodyText, name);
  const ctaLabel = applyNameTemplate(campaign.ctaLabel, name);
  const footerUrl = cleanText(unsubscribeUrl, 2400);
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f7;color:#18212b;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(previewText)}</div><div style="max-width:620px;margin:0 auto;padding:28px 16px"><div style="background:#ffffff;border:1px solid #e6e9ed;border-radius:14px;padding:32px"><div style="font-size:20px;font-weight:800;color:#18212b;margin-bottom:24px">Champion Academy</div><div style="font-size:16px;line-height:1.75">${textToEmailHtml(bodyText)}</div><div style="margin:28px 0"><a href="${escapeHtml(campaign.ctaUrl)}" style="display:inline-block;background:#e8590c;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:8px">${escapeHtml(ctaLabel)}</a></div><hr style="border:0;border-top:1px solid #eceff2;margin:30px 0 18px"><p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6">您收到这封邮件，是因为您曾同意接收 Champion Academy 的通知。<br><a href="${escapeHtml(footerUrl)}" style="color:#6b7280">取消订阅未来 Email</a></p></div></div></body></html>`;
  const text = `${bodyText}\n\n${ctaLabel}: ${campaign.ctaUrl}\n\n取消订阅未来 Email: ${footerUrl}`;
  return { subject, html, text };
}

function unsubscribeKey(secret) {
  const value = cleanText(secret, 1000);
  if (!value) throw new Error('EMAIL_UNSUBSCRIBE_SECRET 尚未配置');
  return Buffer.from(value, 'utf8');
}

export function createUnsubscribeToken(payload, secret) {
  const encoded = Buffer.from(JSON.stringify({
    campaignId: cleanText(payload?.campaignId, 180),
    recipientId: cleanText(payload?.recipientId, 180)
  })).toString('base64url');
  if (!payload?.campaignId || !payload?.recipientId) throw new Error('退订资料不完整');
  const signature = crypto.createHmac('sha256', unsubscribeKey(secret)).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function timingSafeStringEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyUnsubscribeToken(token, secret) {
  const [encoded, signature] = cleanText(token, 4000).split('.');
  if (!encoded || !signature) throw new Error('退订链接无效');
  const expected = crypto.createHmac('sha256', unsubscribeKey(secret)).update(encoded).digest('base64url');
  if (!timingSafeStringEqual(signature, expected)) throw new Error('退订链接无效');
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const campaignId = cleanText(payload.campaignId, 180);
    const recipientId = cleanText(payload.recipientId, 180);
    if (!campaignId || !recipientId || campaignId.includes('/') || recipientId.includes('/')) throw new Error();
    return { campaignId, recipientId };
  } catch {
    throw new Error('退订链接无效');
  }
}

function resendWebhookKey(secret) {
  const value = cleanText(secret, 2000);
  if (!value) throw new Error('RESEND_WEBHOOK_SECRET 尚未配置');
  const raw = value.startsWith('whsec_') ? value.slice(6) : value;
  try {
    return Buffer.from(raw, 'base64');
  } catch {
    return Buffer.from(raw, 'utf8');
  }
}

export function createResendWebhookSignature({ id, timestamp, payload, secret }) {
  const signed = `${id}.${timestamp}.${payload}`;
  return crypto.createHmac('sha256', resendWebhookKey(secret)).update(signed).digest('base64');
}

export function verifyResendWebhook({ id, timestamp, signature, payload, secret, now = Date.now() }) {
  const messageId = cleanText(id, 300);
  const created = Number(timestamp);
  if (!messageId || !Number.isFinite(created)) throw new Error('Webhook 签名资料不完整');
  if (Math.abs(Math.floor(now / 1000) - created) > 5 * 60) throw new Error('Webhook 已过期');
  const expected = createResendWebhookSignature({ id: messageId, timestamp: String(created), payload, secret });
  const candidates = cleanText(signature, 6000).split(/\s+/)
    .map(part => part.startsWith('v1,') ? part.slice(3) : '')
    .filter(Boolean);
  if (!candidates.some(candidate => timingSafeStringEqual(candidate, expected))) throw new Error('Webhook 签名无效');
  return true;
}

export function isTrackedCtaClick(event, campaign) {
  return event?.type === 'email.clicked'
    && cleanText(event?.data?.click?.link, 2048) === cleanText(campaign?.ctaUrl, 2048);
}

export function classifyRecipient(recipient = {}) {
  if (recipient.unsubscribedAt) return 'unsubscribed';
  if (recipient.complainedAt) return 'complained';
  if (recipient.bouncedAt) return 'bounced';
  if (recipient.failedAt) return 'failed';
  if (recipient.firstClickedAt) return 'clicked';
  if (recipient.firstOpenedAt) return 'opened';
  if (recipient.deliveredAt) return 'delivered';
  if (recipient.sentAt) return 'sent';
  if (recipient.status === 'sending') return 'sending';
  return 'queued';
}

export function recipientIsNotClicked(recipient = {}) {
  const attempted = Boolean(recipient.sentAt || recipient.deliveredAt || recipient.firstOpenedAt);
  const excluded = Boolean(recipient.firstClickedAt || recipient.unsubscribedAt || recipient.complainedAt || recipient.bouncedAt || recipient.failedAt);
  return attempted && !excluded;
}

export function summarizeRecipients(recipients = [], audience = {}) {
  const summary = {
    selected: Number(audience.selected) || recipients.length,
    valid: Number(audience.valid) || recipients.length,
    excluded: Number(audience.excluded) || 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    notClicked: 0,
    bounced: 0,
    failed: 0,
    complained: 0,
    unsubscribed: 0,
    queued: 0,
    sending: 0
  };
  for (const recipient of recipients) {
    const status = classifyRecipient(recipient);
    if (recipient.sentAt) summary.sent += 1;
    if (recipient.deliveredAt) summary.delivered += 1;
    if (recipient.firstOpenedAt) summary.opened += 1;
    if (recipient.firstClickedAt) summary.clicked += 1;
    if (recipientIsNotClicked(recipient)) summary.notClicked += 1;
    if (status === 'bounced') summary.bounced += 1;
    if (status === 'failed') summary.failed += 1;
    if (status === 'complained') summary.complained += 1;
    if (status === 'unsubscribed') summary.unsubscribed += 1;
    if (status === 'queued') summary.queued += 1;
    if (status === 'sending') summary.sending += 1;
  }
  return summary;
}
