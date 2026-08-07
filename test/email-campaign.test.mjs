import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildEmailContent,
  classifyRecipient,
  contentFingerprint,
  createResendWebhookSignature,
  createUnsubscribeToken,
  isTrackedCtaClick,
  normalizeEmail,
  recipientIsNotClicked,
  sanitizeCampaignInput,
  summarizeRecipients,
  validateAudienceSelections,
  verifyResendWebhook,
  verifyUnsubscribeToken
} from '../lib/email-campaign-core.js';
import { emailCampaignInternals, handleEmailCampaignRequest } from '../lib/email-campaign-api.js';
import { webhookRecipientMutation } from '../lib/email-webhook-api.js';

const campaign = sanitizeCampaignInput({
  internalName: 'August Notice',
  subject: '{{name}}，课程通知',
  previewText: '最新安排',
  bodyText: 'Hi {{name}}，\n\n请查看最新安排。',
  ctaLabel: '查看详情',
  ctaUrl: 'https://example.com/course'
});

function mockJsonResponse() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = JSON.parse(value); }
  };
}

test('Email Campaign API rejects missing admin authentication and unapproved origins', async () => {
  const unauthorized = mockJsonResponse();
  await handleEmailCampaignRequest({ method: 'GET', headers: {}, url: '/api/email-campaigns?action=list' }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  assert.match(unauthorized.body.error, /授权/);

  const forbidden = mockJsonResponse();
  await handleEmailCampaignRequest({
    method: 'GET',
    headers: { origin: 'https://unapproved.example' },
    url: '/api/email-campaigns?action=list'
  }, forbidden);
  assert.equal(forbidden.statusCode, 403);
});

test('campaign content and audience inputs are normalized and bounded', () => {
  assert.equal(normalizeEmail(' TEST@Example.COM '), 'test@example.com');
  assert.equal(campaign.ctaUrl, 'https://example.com/course');
  assert.equal(contentFingerprint(campaign).length, 64);
  assert.deepEqual(validateAudienceSelections([
    { source: 'leads', ids: ['one', 'one', 'two'] }
  ]), [{ source: 'leads', ids: ['one', 'two'] }]);
  assert.throws(() => sanitizeCampaignInput({ ...campaign, ctaUrl: 'http://example.com' }), /https/);
  assert.throws(() => validateAudienceSelections([{ source: 'unknown', ids: ['one'] }]), /来源/);
  assert.throws(() => validateAudienceSelections([{ source: 'leads', ids: Array.from({ length: 501 }, (_, index) => `id-${index}`) }]), /500/);
});

test('email renderer escapes customer-controlled content and includes one tracked CTA', () => {
  const content = buildEmailContent({
    campaign: { ...campaign, bodyText: 'Hi {{name}}\n<script>alert(1)</script>' },
    recipient: { name: '<img src=x onerror=alert(1)>' },
    unsubscribeUrl: 'https://api.example.com/api/unsubscribe?token=abc'
  });
  assert.doesNotMatch(content.html, /<script>/);
  assert.doesNotMatch(content.html, /<img src=x/);
  assert.match(content.html, /https:\/\/example\.com\/course/);
  assert.match(content.html, /取消订阅未来 Email/);
  assert.match(content.text, /api\.example\.com/);
});

test('unsubscribe token round-trips without exposing an email address', () => {
  const secret = 'a-long-random-test-secret';
  const token = createUnsubscribeToken({ campaignId: 'campaign-1', recipientId: 'recipient-1' }, secret);
  assert.equal(token.includes('@'), false);
  assert.deepEqual(verifyUnsubscribeToken(token, secret), { campaignId: 'campaign-1', recipientId: 'recipient-1' });
  assert.throws(() => verifyUnsubscribeToken(`${token}x`, secret), /无效/);
});

test('Resend webhook signatures reject tampering and expired requests', () => {
  const secret = `whsec_${Buffer.from('champion-webhook-test-secret').toString('base64')}`;
  const payload = JSON.stringify({ type: 'email.clicked', data: { email_id: 'email-1' } });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createResendWebhookSignature({ id: 'webhook-1', timestamp, payload, secret });
  assert.equal(verifyResendWebhook({ id: 'webhook-1', timestamp, payload, secret, signature: `v1,${signature}` }), true);
  assert.throws(() => verifyResendWebhook({ id: 'webhook-1', timestamp, payload: `${payload} `, secret, signature: `v1,${signature}` }), /签名无效/);
  assert.throws(() => verifyResendWebhook({ id: 'webhook-1', timestamp: '1', payload, secret, signature: `v1,${signature}` }), /过期/);
});

test('only the campaign CTA is counted as a click', () => {
  const ctaEvent = { type: 'email.clicked', data: { click: { link: campaign.ctaUrl } } };
  const unsubscribeEvent = { type: 'email.clicked', data: { click: { link: 'https://api.example.com/api/unsubscribe?token=abc' } } };
  assert.equal(isTrackedCtaClick(ctaEvent, campaign), true);
  assert.equal(isTrackedCtaClick(unsubscribeEvent, campaign), false);
});

test('recipient reporting separates clicks, non-clicks, failures and opt-outs', () => {
  const recipients = [
    { sentAt: '2026-08-01T00:00:00.000Z' },
    { sentAt: '2026-08-01T00:00:00.000Z', deliveredAt: '2026-08-01T00:01:00.000Z', firstOpenedAt: '2026-08-01T00:02:00.000Z' },
    { sentAt: '2026-08-01T00:00:00.000Z', firstClickedAt: '2026-08-01T00:03:00.000Z' },
    { sentAt: '2026-08-01T00:00:00.000Z', failedAt: '2026-08-01T00:04:00.000Z' },
    { sentAt: '2026-08-01T00:00:00.000Z', unsubscribedAt: '2026-08-01T00:05:00.000Z' }
  ];
  assert.equal(classifyRecipient(recipients[0]), 'sent');
  assert.equal(recipientIsNotClicked(recipients[1]), true);
  assert.equal(recipientIsNotClicked(recipients[3]), false);
  const summary = summarizeRecipients(recipients, { selected: 6, valid: 5, excluded: 1 });
  assert.equal(summary.clicked, 1);
  assert.equal(summary.notClicked, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.unsubscribed, 1);
});

test('webhook mutations preserve first-open time and suppress bounce or complaint', () => {
  const firstOpenedAt = '2026-08-01T10:00:00.000Z';
  const opened = webhookRecipientMutation({
    type: 'email.opened',
    created_at: '2026-08-01T11:00:00.000Z',
    data: {}
  }, campaign, { firstOpenedAt, openCount: 2 });
  assert.equal(opened.update.firstOpenedAt, firstOpenedAt);
  assert.equal(opened.update.openCount, 3);

  const click = webhookRecipientMutation({
    type: 'email.clicked',
    data: { click: { link: campaign.ctaUrl, timestamp: '2026-08-01T12:00:00.000Z' } }
  }, campaign, {});
  assert.equal(click.tracked, true);
  assert.equal(click.update.firstClickedAt, '2026-08-01T12:00:00.000Z');

  const unsubscribeClick = webhookRecipientMutation({
    type: 'email.clicked',
    data: { click: { link: 'https://api.example.com/api/unsubscribe?token=abc' } }
  }, campaign, {});
  assert.equal(unsubscribeClick.tracked, false);
  assert.equal('firstClickedAt' in unsubscribeClick.update, false);

  const bounce = webhookRecipientMutation({ type: 'email.bounced', created_at: firstOpenedAt, data: {} }, campaign, {});
  assert.equal(bounce.suppressionReason, 'bounced');
  assert.equal(bounce.update.status, 'bounced');

  const suppressed = webhookRecipientMutation({ type: 'email.suppressed', created_at: firstOpenedAt, data: {} }, campaign, {});
  assert.equal(suppressed.suppressionReason, 'suppressed');
  assert.equal(suppressed.update.status, 'failed');
});

test('Resend sending uses a stable idempotency key and retries a transient error without real network access', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;
  process.env.RESEND_API_KEY = 're_test_only';
  process.env.EMAIL_FROM = 'Champion Academy <updates@example.com>';
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(options);
    return requests.length === 1
      ? new Response(JSON.stringify({ message: 'temporary' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify({ id: 'email-test-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await emailCampaignInternals.sendThroughResend({
      to: 'owner@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
      text: 'Test',
      idempotencyKey: 'campaign-stable-key',
      listUnsubscribe: 'https://api.example.com/api/unsubscribe?token=abc'
    });
    assert.deepEqual(result, { id: 'email-test-1', attempt: 2 });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].headers['Idempotency-Key'], 'campaign-stable-key');
    const body = JSON.parse(requests[0].body);
    assert.match(body.headers['List-Unsubscribe'], /unsubscribe/);

    process.env.EMAIL_FROM = 'Other Sender <hello@example.com>';
    await assert.rejects(() => emailCampaignInternals.sendThroughResend({
      to: 'owner@example.com', subject: 'Test', html: '<p>Test</p>', text: 'Test',
      idempotencyKey: 'invalid-sender', listUnsubscribe: ''
    }), /Champion Academy/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalFrom;
  }
});

test('Mailbox is an in-app view and the old BCC implementation is removed', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(html, /data-view="emailCampaigns"/);
  assert.match(html, /id="emailCampaignsView"/);
  assert.doesNotMatch(app, /mailto:\?bcc=/);
  assert.match(app, /preview-audience/);
  assert.match(rules, /email_campaigns/);
  assert.match(rules, /allow read, write: if false/);
});

test('Vercel deployment stays within the Hobby serverless function limit', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const nodeBuilds = config.builds.filter(build => build.use === '@vercel/node');
  const wrapper = fs.readFileSync(new URL('../api/email-campaigns.js', import.meta.url), 'utf8');
  assert.equal(nodeBuilds.length, 12);
  assert.equal(nodeBuilds.some(build => build.src === 'api/*.js'), false);
  assert.equal(fs.existsSync(new URL('../api/unsubscribe.js', import.meta.url)), false);
  assert.match(wrapper, /handleEmailUnsubscribeRequest/);
  assert.deepEqual(config.routes[0], { src: '/api/unsubscribe', dest: '/api/email-campaigns.js' });
});
