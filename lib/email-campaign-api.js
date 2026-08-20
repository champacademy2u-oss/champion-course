import {
  EMAIL_CAMPAIGN_MAX_RECIPIENTS,
  EMAIL_SEND_BATCH_SIZE,
  EMAIL_SOURCE_CONFIG,
  buildEmailContent,
  classifyRecipient,
  cleanText,
  contentFingerprint,
  createEmailTrackingToken,
  createUnsubscribeToken,
  emailIsValid,
  mergeAudienceSelections,
  mergeAudienceStats,
  normalizeEmail,
  sanitizeCampaignInput,
  sha256Id,
  summarizeRecipients,
  suppressionId,
  validateAudienceSelections
} from './email-campaign-core.js';
import { db, fieldValue, firebaseApp, sendJson } from '../api/_firebase.js';
import { google } from 'googleapis';

const DEFAULT_ALLOWED_ORIGINS = 'https://champacademy2u-oss.github.io,http://localhost:4174,http://127.0.0.1:4174,http://localhost:4175,http://127.0.0.1:4175';
const EMAIL_CAMPAIGNS = 'email_campaigns';
const EMAIL_MESSAGES = 'email_messages';
const EMAIL_SUPPRESSIONS = 'email_suppressions';
const EMAIL_COUNTERS = 'email_delivery_counters';
const RESEND_TEST_FROM = 'Champion Academy <onboarding@resend.dev>';

function nowIso() {
  return new Date().toISOString();
}

function safeError(error) {
  return cleanText(error?.message || 'Email Campaign 操作失败', 300)
    .replace(/Bearer\s+\S+/gi, 'Bearer [hidden]')
    .replace(/re_[A-Za-z0-9_-]+/g, 're_[hidden]');
}

function errorStatus(error) {
  if (['未授权', 'Email 管理员尚未配置', '此浏览器没有 Email 管理权限'].includes(error.message)) return 401;
  if (error.message.includes('找不到')) return 404;
  if (error.message.includes('达到') || error.message.includes('上限')) return 429;
  if (error.message.includes('已经开始') || error.message.includes('测试邮件')) return 409;
  return 400;
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(String(req.body || '{}'));
  } catch {
    throw new Error('资料格式不正确');
  }
}

function allowedOrigins() {
  return new Set(String(process.env.EMAIL_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS)
    .split(',').map(value => value.trim()).filter(Boolean));
}

function applyCors(req, res) {
  const origin = cleanText(req.headers.origin, 300);
  if (origin && !allowedOrigins().has(origin)) {
    sendJson(res, 403, { error: '此来源不允许使用 Email Campaign 服务' });
    return false;
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return false;
  }
  return true;
}

async function requireCrmAdmin(req) {
  const header = cleanText(req.headers.authorization, 5000);
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new Error('未授权');
  const allowed = new Set(String(process.env.CRM_ADMIN_UIDS || '')
    .split(',').map(value => value.trim()).filter(Boolean));
  if (!allowed.size) throw new Error('Email 管理员尚未配置');
  try {
    const decoded = await firebaseApp().auth().verifyIdToken(token);
    if (!allowed.has(decoded.uid)) throw new Error();
    return decoded;
  } catch {
    throw new Error('此账号没有 Email 管理权限');
  }
}

function campaignRef(campaignId) {
  const id = cleanText(campaignId, 180);
  if (!id || id.includes('/')) throw new Error('Campaign ID 不正确');
  return db().collection(EMAIL_CAMPAIGNS).doc(id);
}

async function campaignDoc(campaignId) {
  const snap = await campaignRef(campaignId).get();
  if (!snap.exists) throw new Error('找不到 Campaign');
  return { id: snap.id, ref: snap.ref, ...snap.data() };
}

function publicCampaign(campaign) {
  return {
    id: campaign.id,
    internalName: campaign.internalName || '',
    subject: campaign.subject || '',
    previewText: campaign.previewText || '',
    bodyText: campaign.bodyText || '',
    ctaLabel: campaign.ctaLabel || '',
    ctaUrl: campaign.ctaUrl || '',
    selections: Array.isArray(campaign.selections) ? campaign.selections : [],
    status: campaign.status || 'draft',
    contentVersion: campaign.contentVersion || '',
    testSentAt: campaign.testSentAt || '',
    testSentContentVersion: campaign.testSentContentVersion || '',
    testProvider: campaign.testProvider || '',
    startedAt: campaign.startedAt || '',
    completedAt: campaign.completedAt || '',
    lastAppendedAt: campaign.lastAppendedAt || '',
    appendCount: Number(campaign.appendCount) || 0,
    pausedAt: campaign.pausedAt || '',
    pauseReason: campaign.pauseReason || '',
    audience: campaign.audience || {},
    createdAt: campaign.createdAt || '',
    updatedAt: campaign.updatedAt || ''
  };
}

async function getDocuments(refs) {
  const documents = [];
  for (let index = 0; index < refs.length; index += 100) {
    const chunk = refs.slice(index, index + 100);
    documents.push(...await Promise.all(chunk.map(ref => ref.get())));
  }
  return documents;
}

function consentDenied(data) {
  return data?.emailConsent === false || data?.emailOptIn === false || data?.marketingConsent === false;
}

async function buildAudience(selections) {
  const normalizedSelections = validateAudienceSelections(selections);
  const stats = { selected: 0, valid: 0, excluded: 0, invalid: 0, duplicate: 0, suppressed: 0, noConsent: 0, missing: 0 };
  const candidates = [];

  for (const selection of normalizedSelections) {
    const config = EMAIL_SOURCE_CONFIG[selection.source];
    stats.selected += selection.ids.length;
    const refs = selection.ids.map(id => db().collection(config.collection).doc(id));
    const snaps = await getDocuments(refs);
    snaps.forEach((snap, index) => {
      if (!snap.exists) {
        stats.missing += 1;
        return;
      }
      const data = snap.data() || {};
      if (config.expectedSource && data.source !== config.expectedSource) {
        stats.missing += 1;
        return;
      }
      const email = normalizeEmail(data.email);
      if (!emailIsValid(email)) {
        stats.invalid += 1;
        return;
      }
      if (consentDenied(data)) {
        stats.noConsent += 1;
        return;
      }
      candidates.push({
        source: selection.source,
        sourceId: selection.ids[index],
        sourceLabel: config.label,
        name: cleanText(data.name || data.full_name, 160) || '朋友',
        email,
        course: cleanText(data.course, 240)
      });
    });
  }

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.email)) {
      stats.duplicate += 1;
      continue;
    }
    seen.add(candidate.email);
    unique.push(candidate);
  }

  const suppressionRefs = unique.map(candidate => db().collection(EMAIL_SUPPRESSIONS).doc(suppressionId(candidate.email)));
  const suppressionSnaps = await getDocuments(suppressionRefs);
  const recipients = unique.filter((candidate, index) => {
    if (suppressionSnaps[index]?.exists) {
      stats.suppressed += 1;
      return false;
    }
    return true;
  });

  stats.valid = recipients.length;
  stats.excluded = stats.selected - stats.valid;
  return { selections: normalizedSelections, stats, recipients };
}

function publicAudiencePreview(audience) {
  return {
    stats: audience.stats,
    recipients: audience.recipients.map(recipient => ({
      source: recipient.source,
      sourceId: recipient.sourceId,
      sourceLabel: recipient.sourceLabel,
      name: recipient.name,
      email: recipient.email,
      course: recipient.course
    }))
  };
}

function requiredEnv(name, message) {
  const value = cleanText(process.env[name], 4000);
  if (!value) throw new Error(message || `${name} 尚未配置`);
  return value;
}

function configuredEmailFrom({ allowResendTestSender = false } = {}) {
  const value = requiredEnv('EMAIL_FROM', 'EMAIL_FROM 尚未配置');
  if (/^Champion Academy <updates@[a-z0-9.-]+\.[a-z]{2,}>$/i.test(value)) return value;
  if (allowResendTestSender && value === RESEND_TEST_FROM) return value;
  if (value === RESEND_TEST_FROM) {
    throw new Error('目前是 Resend 测试模式，只能寄送管理员测试邮件；正式发送前请验证自有域名并设置 EMAIL_FROM');
  }
  throw new Error('EMAIL_FROM 必须使用 Champion Academy <updates@已验证域名>；测试邮件可使用 Champion Academy <onboarding@resend.dev>');
}

function configuredEmailReplyTo() {
  const raw = cleanText(process.env.EMAIL_REPLY_TO, 320);
  if (!raw) return '';
  const value = normalizeEmail(raw);
  if (!emailIsValid(value)) throw new Error('EMAIL_REPLY_TO 格式不正确');
  return value;
}

function configuredEmailProvider() {
  const provider = cleanText(process.env.EMAIL_PROVIDER || 'resend', 30).toLowerCase();
  if (!['resend', 'gmail'].includes(provider)) throw new Error('EMAIL_PROVIDER 必须是 resend 或 gmail');
  return provider;
}

function configuredGmailSender() {
  const sender = normalizeEmail(requiredEnv('GMAIL_SENDER_EMAIL', 'GMAIL_SENDER_EMAIL 尚未配置'));
  if (!emailIsValid(sender) || !sender.endsWith('@gmail.com')) {
    throw new Error('GMAIL_SENDER_EMAIL 必须是有效的 Gmail 地址');
  }
  return sender;
}

function gmailCredentials() {
  return {
    clientId: requiredEnv('GMAIL_CLIENT_ID', 'Gmail OAuth Client ID 尚未配置'),
    clientSecret: requiredEnv('GMAIL_CLIENT_SECRET', 'Gmail OAuth Client Secret 尚未配置'),
    refreshToken: requiredEnv('GMAIL_REFRESH_TOKEN', 'Gmail 尚未完成 Google OAuth 授权')
  };
}

function ensureEmailService({ allowResendTestSender = false } = {}) {
  const provider = configuredEmailProvider();
  if (provider === 'gmail') {
    configuredGmailSender();
    gmailCredentials();
    return provider;
  }
  configuredEmailFrom({ allowResendTestSender });
  requiredEnv('RESEND_API_KEY', 'Resend API 尚未配置');
  return provider;
}

function publicEmailService() {
  const provider = cleanText(process.env.EMAIL_PROVIDER || 'resend', 30).toLowerCase();
  if (provider === 'gmail') {
    const sender = normalizeEmail(process.env.GMAIL_SENDER_EMAIL);
    const ready = Boolean(sender && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
    return {
      provider: 'gmail',
      sender,
      ready,
      canSendCampaign: ready,
      deliveredTracking: false,
      openTracking: 'estimated',
      clickTracking: true,
      message: ready
        ? 'Gmail API 已连接；开启为估算，CTA 点击可追踪，Gmail 不提供可靠送达回执。'
        : 'Gmail API 尚未完成 Google OAuth 授权。'
    };
  }
  const from = cleanText(process.env.EMAIL_FROM, 320);
  const testMode = from === RESEND_TEST_FROM;
  const ready = Boolean(from && process.env.RESEND_API_KEY);
  return {
    provider: 'resend',
    sender: from,
    ready,
    canSendCampaign: ready && !testMode,
    testMode,
    deliveredTracking: true,
    openTracking: 'estimated',
    clickTracking: true,
    message: testMode
      ? 'Resend 测试模式只能寄管理员测试邮件；正式发送需要验证自有域名。'
      : ready ? 'Resend 正式发送已配置。' : 'Resend 尚未完成配置。'
  };
}

function emailDailyLimit() {
  const value = Number(process.env.EMAIL_DAILY_SEND_LIMIT);
  if (!Number.isInteger(value) || value < 1) throw new Error('EMAIL_DAILY_SEND_LIMIT 尚未正确配置');
  return Math.min(value, 100000);
}

function publicApiBase() {
  const value = requiredEnv('PUBLIC_API_BASE_URL', 'PUBLIC_API_BASE_URL 尚未配置');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('PUBLIC_API_BASE_URL 必须是完整的 https:// 地址');
  }
}

function unsubscribeUrl(campaignId, recipientId) {
  const token = createUnsubscribeToken({ campaignId, recipientId }, requiredEnv('EMAIL_UNSUBSCRIBE_SECRET'));
  return `${publicApiBase()}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

function emailTrackingSecret() {
  return requiredEnv(
    'EMAIL_TRACKING_SECRET',
    'EMAIL_TRACKING_SECRET 尚未配置'
  );
}

function emailTrackingUrl(kind, campaignId, recipientId) {
  const token = createEmailTrackingToken({ campaignId, recipientId, kind }, emailTrackingSecret());
  return `${publicApiBase()}/api/email-track?action=${kind}&token=${encodeURIComponent(token)}`;
}

async function dailyRemaining() {
  const date = new Date().toISOString().slice(0, 10);
  const snap = await db().collection(EMAIL_COUNTERS).doc(date).get();
  return Math.max(0, emailDailyLimit() - (Number(snap.get('count')) || 0));
}

async function reserveSendSlot() {
  const date = new Date().toISOString().slice(0, 10);
  const ref = db().collection(EMAIL_COUNTERS).doc(date);
  await db().runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    const count = Number(snap.get('count')) || 0;
    if (count >= emailDailyLimit()) throw new Error('今日 Email 发送已达到安全上限');
    transaction.set(ref, { count: count + 1, updatedAt: nowIso() }, { merge: true });
  });
}

class ResendSendError extends Error {
  constructor(message, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

async function sendThroughResend({ to, subject, html, text, idempotencyKey, listUnsubscribe, allowResendTestSender = false }) {
  const apiKey = requiredEnv('RESEND_API_KEY', 'Resend API 尚未配置');
  const from = configuredEmailFrom({ allowResendTestSender });
  const replyTo = configuredEmailReplyTo();
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          html,
          text,
          reply_to: replyTo || undefined,
          headers: listUnsubscribe ? {
            'List-Unsubscribe': `<${listUnsubscribe}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
          } : undefined
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new ResendSendError(cleanText(data?.message, 240) || `Resend 发送失败（${response.status}）`, response.status === 429 || response.status >= 500);
      }
      if (!data?.id) throw new ResendSendError('Resend 没有返回 Email ID', true);
      return { id: cleanText(data.id, 240), attempt, provider: 'resend' };
    } catch (error) {
      lastError = error instanceof ResendSendError ? error : new ResendSendError('暂时无法连接 Email 服务', true);
      if (!lastError.retryable || attempt === 3) break;
      await new Promise(resolve => setTimeout(resolve, 250 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

function base64Lines(value) {
  return Buffer.from(String(value), 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
}

function buildGmailRawMessage({ to, subject, html, text, listUnsubscribe, idempotencyKey }) {
  const recipient = normalizeEmail(to);
  if (!emailIsValid(recipient)) throw new Error('收件人 Email 格式不正确');
  const sender = configuredGmailSender();
  const replyTo = configuredEmailReplyTo() || sender;
  const cleanSubject = cleanText(subject, 200).replace(/[\r\n]+/g, ' ');
  const boundary = `champion_${sha256Id(idempotencyKey || `${recipient}|${cleanSubject}`).slice(0, 32)}`;
  const headers = [
    `From: Champion Academy <${sender}>`,
    `To: ${recipient}`,
    `Reply-To: ${replyTo}`,
    `Subject: =?UTF-8?B?${Buffer.from(cleanSubject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    `X-Champion-Idempotency-Key: ${cleanText(idempotencyKey, 240).replace(/[^A-Za-z0-9._:-]/g, '_')}`,
    ...(listUnsubscribe ? [
      `List-Unsubscribe: <${cleanText(listUnsubscribe, 2400).replace(/[\r\n]+/g, '')}>`,
      'List-Unsubscribe-Post: List-Unsubscribe=One-Click'
    ] : []),
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];
  const mime = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(html),
    `--${boundary}--`,
    ''
  ].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
}

function gmailApiClient() {
  const credentials = gmailCredentials();
  const auth = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  auth.setCredentials({ refresh_token: credentials.refreshToken });
  return google.gmail({ version: 'v1', auth });
}

async function sendThroughGmail({ to, subject, html, text, idempotencyKey, listUnsubscribe, gmailClient = null }) {
  ensureEmailService();
  try {
    const client = gmailClient || gmailApiClient();
    const response = await client.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: buildGmailRawMessage({ to, subject, html, text, listUnsubscribe, idempotencyKey })
      }
    });
    const id = cleanText(response?.data?.id, 240);
    if (!id) throw new Error('Gmail API 没有返回 Message ID');
    return { id, attempt: 1, provider: 'gmail' };
  } catch (error) {
    const status = Number(error?.code || error?.response?.status);
    if (status === 401 || /invalid_grant/i.test(error?.message || '')) {
      throw new Error('Gmail OAuth 授权已失效，请重新连接 Gmail');
    }
    if (status === 429 || /quota|rate limit|daily limit/i.test(error?.message || '')) {
      throw new Error('Gmail 今日发送额度或速率已达到限制');
    }
    throw new Error('Gmail API 发送失败，请检查授权与发送额度');
  }
}

async function sendThroughEmailService(options) {
  return configuredEmailProvider() === 'gmail'
    ? sendThroughGmail(options)
    : sendThroughResend(options);
}

async function saveDraft(input, admin) {
  const content = sanitizeCampaignInput(input);
  const selections = validateAudienceSelections(input.selections);
  const requestedId = cleanText(input.id, 180);
  const ref = requestedId ? campaignRef(requestedId) : db().collection(EMAIL_CAMPAIGNS).doc();
  const snap = await ref.get();
  const current = snap.exists ? snap.data() : {};
  if (snap.exists && current.status !== 'draft') throw new Error('已经开始发送的 Campaign 不能修改');
  const version = contentFingerprint(content);
  const timestamp = nowIso();
  const update = {
    ...content,
    selections,
    status: 'draft',
    contentVersion: version,
    createdBy: admin.uid,
    createdAt: current.createdAt || timestamp,
    updatedAt: timestamp
  };
  if (current.contentVersion && current.contentVersion !== version) {
    update.testSentAt = fieldValue().delete();
    update.testSentContentVersion = fieldValue().delete();
    update.testEmailId = fieldValue().delete();
    update.testProvider = fieldValue().delete();
  }
  await ref.set(update, { merge: true });
  return publicCampaign(await campaignDoc(ref.id));
}

async function previewAudience(input) {
  if (input.incremental === true) {
    const campaign = await campaignDoc(input.campaignId);
    if (campaign.status !== 'completed') throw new Error('只有已完成的 Campaign 可以追加新收件人');
    return publicAudiencePreview(await buildIncrementalAudience(campaign, input.selections));
  }
  let selections = input.selections;
  if (input.campaignId) selections = (await campaignDoc(input.campaignId)).selections;
  return publicAudiencePreview(await buildAudience(selections));
}

async function sendTest(input) {
  const campaign = await campaignDoc(input.campaignId);
  if (campaign.status !== 'draft') throw new Error('只有草稿可以发送测试邮件');
  const testRecipient = normalizeEmail(requiredEnv('EMAIL_TEST_RECIPIENT', 'EMAIL_TEST_RECIPIENT 尚未配置'));
  if (!emailIsValid(testRecipient)) throw new Error('EMAIL_TEST_RECIPIENT 格式不正确');
  ensureEmailService({ allowResendTestSender: true });
  const attempt = (Number(campaign.testAttempt) || 0) + 1;
  const previewUnsubscribeUrl = `${publicApiBase()}/api/unsubscribe?preview=1`;
  const content = buildEmailContent({ campaign, recipient: { name: 'Test Recipient' }, unsubscribeUrl: previewUnsubscribeUrl });
  await reserveSendSlot();
  const result = await sendThroughEmailService({
    to: testRecipient,
    ...content,
    idempotencyKey: `campaign-test-${campaign.id}-${campaign.contentVersion}-${attempt}`,
    listUnsubscribe: '',
    allowResendTestSender: true
  });
  const timestamp = nowIso();
  await campaign.ref.set({
    testAttempt: attempt,
    testSentAt: timestamp,
    testSentContentVersion: campaign.contentVersion,
    testEmailId: result.id,
    testProvider: result.provider,
    updatedAt: timestamp
  }, { merge: true });
  return { ok: true, sentAt: timestamp, recipient: testRecipient, provider: result.provider };
}

async function writeRecipients(campaign, audience) {
  const secret = requiredEnv('EMAIL_UNSUBSCRIBE_SECRET');
  const timestamp = nowIso();
  const records = audience.recipients.map(recipient => {
    const recipientId = sha256Id(`${campaign.id}|${recipient.email}`);
    return {
      id: recipientId,
      ref: campaign.ref.collection('recipients').doc(recipientId),
      data: {
        ...recipient,
        emailHash: suppressionId(recipient.email),
        unsubscribeToken: createUnsubscribeToken({ campaignId: campaign.id, recipientId }, secret),
        status: 'queued',
        attempts: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    };
  });
  for (let index = 0; index < records.length; index += 400) {
    const batch = db().batch();
    records.slice(index, index + 400).forEach(record => batch.set(record.ref, record.data, { merge: true }));
    await batch.commit();
  }
}

async function buildIncrementalAudience(campaign, selections) {
  const audience = await buildAudience(selections);
  const records = audience.recipients.map(recipient => ({
    recipient,
    ref: campaign.ref.collection('recipients').doc(sha256Id(`${campaign.id}|${recipient.email}`))
  }));
  const existing = await getDocuments(records.map(record => record.ref));
  const recipients = records
    .filter((_record, index) => !existing[index]?.exists)
    .map(record => record.recipient);
  const alreadyAdded = records.length - recipients.length;
  const existingRecipients = await campaign.ref.collection('recipients').limit(EMAIL_CAMPAIGN_MAX_RECIPIENTS + 1).get();
  if (existingRecipients.size + recipients.length > EMAIL_CAMPAIGN_MAX_RECIPIENTS) {
    throw new Error(`每个 Campaign 累计最多 ${EMAIL_CAMPAIGN_MAX_RECIPIENTS} 位收件人`);
  }
  return {
    selections: audience.selections,
    recipients,
    existingCount: existingRecipients.size,
    stats: {
      ...audience.stats,
      valid: recipients.length,
      alreadyAdded,
      excluded: audience.stats.excluded + alreadyAdded
    }
  };
}

async function startCampaign(input, admin) {
  if (input.consentConfirmed !== true) throw new Error('请确认收件人已同意接收 Email');
  const campaign = await campaignDoc(input.campaignId);
  if (campaign.status === 'sending') return { ok: true, alreadyStarted: true, campaign: publicCampaign(campaign) };
  if (campaign.status === 'completed') throw new Error('此 Campaign 已经完成');
  if (campaign.status === 'paused') {
    await campaign.ref.set({ status: 'sending', pausedAt: '', pauseReason: '', updatedAt: nowIso() }, { merge: true });
    return { ok: true, resumed: true, campaign: publicCampaign({ ...campaign, status: 'sending' }) };
  }
  if (campaign.status !== 'draft' && campaign.status !== 'preparing') throw new Error('Campaign 状态不允许开始发送');
  if (!campaign.testSentAt
    || campaign.testSentContentVersion !== campaign.contentVersion
    || campaign.testProvider !== configuredEmailProvider()) {
    throw new Error('请先使用目前的 Email 服务发送当前内容的测试邮件');
  }
  ensureEmailService();
  const audience = await buildAudience(campaign.selections);
  if (!audience.recipients.length) throw new Error('没有可发送的有效收件人');
  if (audience.recipients.length > await dailyRemaining()) throw new Error('有效收件人数超过今日剩余发送上限');
  const lock = await db().runTransaction(async transaction => {
    const fresh = await transaction.get(campaign.ref);
    const status = fresh.get('status') || 'draft';
    if (['sending', 'completed'].includes(status)) return false;
    transaction.set(campaign.ref, {
      status: 'preparing',
      consentConfirmedAt: nowIso(),
      consentConfirmedBy: admin.uid,
      updatedAt: nowIso()
    }, { merge: true });
    return true;
  });
  if (!lock) return { ok: true, alreadyStarted: true, campaign: publicCampaign(await campaignDoc(campaign.id)) };
  await writeRecipients(campaign, audience);
  const timestamp = nowIso();
  await campaign.ref.set({
    status: 'sending',
    audience: audience.stats,
    startedAt: campaign.startedAt || timestamp,
    updatedAt: timestamp
  }, { merge: true });
  return { ok: true, campaign: publicCampaign({ ...campaign, status: 'sending', audience: audience.stats, startedAt: timestamp }) };
}

async function appendAudience(input, admin) {
  if (input.consentConfirmed !== true) throw new Error('请确认新增收件人已同意接收 Email');
  const campaign = await campaignDoc(input.campaignId);
  if (campaign.status === 'sending' || campaign.status === 'preparing') {
    return { ok: true, alreadyStarted: true, campaign: publicCampaign(campaign) };
  }
  if (campaign.status !== 'completed') throw new Error('只有已完成的 Campaign 可以追加新收件人');
  if (!campaign.testSentAt
    || campaign.testSentContentVersion !== campaign.contentVersion
    || campaign.testProvider !== configuredEmailProvider()) {
    throw new Error('此 Campaign 的测试邮件与目前发送服务不一致，请建立新 Campaign');
  }
  ensureEmailService();
  const additions = await buildIncrementalAudience(campaign, input.selections);
  if (!additions.recipients.length) throw new Error('所选名单没有尚未寄送的新收件人');
  if (additions.recipients.length > await dailyRemaining()) throw new Error('新增收件人数超过今日剩余发送上限');
  const selections = mergeAudienceSelections(campaign.selections || [], additions.selections);
  const lock = await db().runTransaction(async transaction => {
    const fresh = await transaction.get(campaign.ref);
    if (fresh.get('status') !== 'completed') return false;
    transaction.set(campaign.ref, {
      status: 'preparing',
      consentConfirmedAt: nowIso(),
      consentConfirmedBy: admin.uid,
      updatedAt: nowIso()
    }, { merge: true });
    return true;
  });
  if (!lock) return { ok: true, alreadyStarted: true, campaign: publicCampaign(await campaignDoc(campaign.id)) };

  try {
    await writeRecipients(campaign, additions);
    const timestamp = nowIso();
    const currentAudience = Object.keys(campaign.audience || {}).length
      ? campaign.audience
      : { valid: additions.existingCount, selected: additions.existingCount };
    const cumulativeAudience = mergeAudienceStats(currentAudience, additions.stats);
    await campaign.ref.set({
      status: 'sending',
      selections,
      audience: cumulativeAudience,
      completedAt: fieldValue().delete(),
      pausedAt: '',
      pauseReason: '',
      lastAppendedAt: timestamp,
      appendCount: (Number(campaign.appendCount) || 0) + 1,
      updatedAt: timestamp
    }, { merge: true });
    return {
      ok: true,
      added: additions.recipients.length,
      skippedExisting: additions.stats.alreadyAdded,
      campaign: publicCampaign({
        ...campaign,
        status: 'sending',
        selections,
        audience: cumulativeAudience,
        completedAt: '',
        lastAppendedAt: timestamp,
        appendCount: (Number(campaign.appendCount) || 0) + 1,
        updatedAt: timestamp
      })
    };
  } catch (error) {
    await campaign.ref.set({ status: 'completed', updatedAt: nowIso() }, { merge: true });
    throw error;
  }
}

async function recoverExpiredLeases(campaign) {
  const snap = await campaign.ref.collection('recipients').where('status', '==', 'sending').limit(100).get();
  const expired = snap.docs.filter(doc => new Date(doc.get('leaseUntil') || 0).getTime() <= Date.now());
  if (!expired.length) return;
  const batch = db().batch();
  expired.forEach(doc => batch.set(doc.ref, { status: 'queued', leaseUntil: '', updatedAt: nowIso() }, { merge: true }));
  await batch.commit();
}

async function lockQueuedRecipients(campaign) {
  const snap = await campaign.ref.collection('recipients').where('status', '==', 'queued').limit(EMAIL_SEND_BATCH_SIZE).get();
  const locked = [];
  for (const doc of snap.docs) {
    const acquired = await db().runTransaction(async transaction => {
      const fresh = await transaction.get(doc.ref);
      if (fresh.get('status') !== 'queued') return false;
      transaction.set(doc.ref, {
        status: 'sending',
        leaseUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        updatedAt: nowIso()
      }, { merge: true });
      return true;
    });
    if (acquired) locked.push({ id: doc.id, ref: doc.ref, ...doc.data(), status: 'sending' });
  }
  return locked;
}

async function sendRecipient(campaign, recipient) {
  const url = unsubscribeUrl(campaign.id, recipient.id);
  const content = buildEmailContent({
    campaign,
    recipient,
    unsubscribeUrl: url,
    ctaUrl: emailTrackingUrl('click', campaign.id, recipient.id),
    openPixelUrl: emailTrackingUrl('open', campaign.id, recipient.id)
  });
  try {
    await reserveSendSlot();
    const result = await sendThroughEmailService({
      to: recipient.email,
      ...content,
      idempotencyKey: `campaign-${campaign.id}-${recipient.id}`,
      listUnsubscribe: url
    });
    const timestamp = nowIso();
    const batch = db().batch();
    batch.set(recipient.ref, {
      status: 'sent',
      provider: result.provider,
      providerMessageId: result.id,
      ...(result.provider === 'resend' ? { resendEmailId: result.id } : { gmailMessageId: result.id }),
      sentAt: timestamp,
      attempts: (Number(recipient.attempts) || 0) + result.attempt,
      leaseUntil: '',
      lastError: '',
      updatedAt: timestamp
    }, { merge: true });
    batch.set(db().collection(EMAIL_MESSAGES).doc(result.provider === 'resend' ? result.id : `gmail_${result.id}`), {
      provider: result.provider,
      providerMessageId: result.id,
      campaignId: campaign.id,
      recipientId: recipient.id,
      createdAt: timestamp
    });
    await batch.commit();
    return { sent: 1, failed: 0, dailyLimit: false };
  } catch (error) {
    const dailyLimit = error.message.includes('安全上限');
    await recipient.ref.set(dailyLimit ? {
      status: 'queued',
      leaseUntil: '',
      updatedAt: nowIso()
    } : {
      status: 'failed',
      failedAt: nowIso(),
      attempts: (Number(recipient.attempts) || 0) + 1,
      leaseUntil: '',
      lastError: safeError(error),
      updatedAt: nowIso()
    }, { merge: true });
    return { sent: 0, failed: dailyLimit ? 0 : 1, dailyLimit };
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => consume()));
  return results;
}

async function campaignHasWork(campaign) {
  const [queued, sending] = await Promise.all([
    campaign.ref.collection('recipients').where('status', '==', 'queued').limit(1).get(),
    campaign.ref.collection('recipients').where('status', '==', 'sending').limit(1).get()
  ]);
  return !queued.empty || !sending.empty;
}

async function sendNextBatch(input) {
  const campaign = await campaignDoc(input.campaignId);
  if (campaign.status === 'paused') return { ok: true, paused: true, campaign: publicCampaign(campaign) };
  if (campaign.status === 'completed') return { ok: true, completed: true, campaign: publicCampaign(campaign) };
  if (campaign.status !== 'sending') throw new Error('Campaign 尚未开始发送');
  ensureEmailService();
  await recoverExpiredLeases(campaign);
  const recipients = await lockQueuedRecipients(campaign);
  if (!recipients.length) {
    const hasWork = await campaignHasWork(campaign);
    if (!hasWork) await campaign.ref.set({ status: 'completed', completedAt: nowIso(), updatedAt: nowIso() }, { merge: true });
    return { ok: true, completed: !hasWork, hasMore: hasWork, processed: 0 };
  }
  const results = await runWithConcurrency(recipients, 5, recipient => sendRecipient(campaign, recipient));
  const sent = results.reduce((sum, result) => sum + result.sent, 0);
  const failed = results.reduce((sum, result) => sum + result.failed, 0);
  const dailyLimit = results.some(result => result.dailyLimit);
  if (dailyLimit) {
    await campaign.ref.set({ status: 'paused', pausedAt: nowIso(), pauseReason: '今日 Email 发送已达到安全上限', updatedAt: nowIso() }, { merge: true });
    return { ok: true, paused: true, sent, failed, processed: sent + failed, reason: '今日 Email 发送已达到安全上限' };
  }
  const hasMore = await campaignHasWork(campaign);
  if (!hasMore) await campaign.ref.set({ status: 'completed', completedAt: nowIso(), updatedAt: nowIso() }, { merge: true });
  return { ok: true, sent, failed, processed: sent + failed, hasMore, completed: !hasMore };
}

async function pauseCampaign(input) {
  const campaign = await campaignDoc(input.campaignId);
  if (campaign.status !== 'sending') throw new Error('只有发送中的 Campaign 可以暂停');
  const timestamp = nowIso();
  await campaign.ref.set({ status: 'paused', pausedAt: timestamp, pauseReason: '管理员暂停', updatedAt: timestamp }, { merge: true });
  return { ok: true, campaign: publicCampaign({ ...campaign, status: 'paused', pausedAt: timestamp }) };
}

async function listCampaigns() {
  const snap = await db().collection(EMAIL_CAMPAIGNS).orderBy('createdAt', 'desc').limit(50).get();
  return snap.docs.map(doc => publicCampaign({ id: doc.id, ...doc.data() }));
}

async function campaignReport(input) {
  const campaign = await campaignDoc(input.campaignId);
  const snap = await campaign.ref.collection('recipients').limit(500).get();
  const recipients = snap.docs.map(doc => {
    const data = { id: doc.id, ...doc.data() };
    return {
      id: data.id,
      name: data.name || '',
      email: data.email || '',
      source: data.source || '',
      sourceLabel: data.sourceLabel || '',
      course: data.course || '',
      status: classifyRecipient(data),
      sentAt: data.sentAt || '',
      deliveredAt: data.deliveredAt || '',
      firstOpenedAt: data.firstOpenedAt || '',
      lastOpenedAt: data.lastOpenedAt || '',
      firstClickedAt: data.firstClickedAt || '',
      lastClickedAt: data.lastClickedAt || '',
      bouncedAt: data.bouncedAt || '',
      failedAt: data.failedAt || '',
      complainedAt: data.complainedAt || '',
      unsubscribedAt: data.unsubscribedAt || '',
      lastError: data.lastError || ''
    };
  });
  return {
    campaign: publicCampaign(campaign),
    summary: summarizeRecipients(snap.docs.map(doc => doc.data()), campaign.audience),
    recipients
  };
}

export async function handleEmailCampaignRequest(req, res) {
  if (!applyCors(req, res)) return;
  try {
    const admin = await requireCrmAdmin(req);
    const action = cleanText(new URL(req.url, 'https://local').searchParams.get('action'), 80);
    const input = req.method === 'GET'
      ? Object.fromEntries(new URL(req.url, 'https://local').searchParams.entries())
      : parseBody(req);
    let result;
    if (req.method === 'GET' && action === 'list') result = {
      campaigns: await listCampaigns(),
      service: publicEmailService()
    };
    else if (req.method === 'GET' && action === 'report') result = await campaignReport(input);
    else if (req.method === 'POST' && action === 'save-draft') result = { campaign: await saveDraft(input, admin) };
    else if (req.method === 'POST' && action === 'preview-audience') result = await previewAudience(input);
    else if (req.method === 'POST' && action === 'send-test') result = await sendTest(input);
    else if (req.method === 'POST' && action === 'start') result = await startCampaign(input, admin);
    else if (req.method === 'POST' && action === 'append-audience') result = await appendAudience(input, admin);
    else if (req.method === 'POST' && action === 'send-next') result = await sendNextBatch(input);
    else if (req.method === 'POST' && action === 'pause') result = await pauseCampaign(input);
    else return sendJson(res, 404, { error: '找不到 Email Campaign 操作' });
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, errorStatus(error), { error: safeError(error) });
  }
}

export const emailCampaignInternals = {
  buildIncrementalAudience,
  buildAudience,
  buildGmailRawMessage,
  publicEmailService,
  sendThroughEmailService,
  sendThroughGmail,
  sendThroughResend,
  publicCampaign
};
