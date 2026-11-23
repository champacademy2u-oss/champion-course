import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CHAMP_PREVIEW_CAMPAIGN,
  CHAMP_PREVIEW_LEAD_SOURCE,
  PREVIEW_LEAD_SOURCE,
  allowedPreviewLeadOrigins,
  normalizePreviewLead,
  safeCommunityUrl
} from '../lib/preview-lead-core.js';

test('normalizes a valid Preview lead for the existing CRM source', () => {
  const lead = normalizePreviewLead({
    name: '  Ryan  Lim ',
    email: 'RYAN@EXAMPLE.COM',
    phone: '+60 11-6745 9987',
    state: 'JOHOR'
  });

  assert.equal(lead.name, 'Ryan Lim');
  assert.equal(lead.email, 'ryan@example.com');
  assert.equal(lead.phoneDigits, '601167459987');
  assert.equal(lead.state, 'johor');
  assert.equal(lead.source, PREVIEW_LEAD_SOURCE);
  assert.equal(lead.courseDate, '2026-08-28');
});

test('routes the Unlimited Leverage form to Landing Leads', () => {
  const lead = normalizePreviewLead({
    course: 'champ-preview',
    name: 'Test User',
    email: 'test@example.com',
    phone: '60123456789',
    state: 'johor'
  });

  assert.equal(lead.source, CHAMP_PREVIEW_LEAD_SOURCE);
  assert.equal(lead.campaign, CHAMP_PREVIEW_CAMPAIGN);
  assert.equal(lead.courseDate, '2026-10');
  assert.throws(() => normalizePreviewLead({ ...lead, course: 'other' }), /课程资料/);
});

test('rejects malformed public registration data', () => {
  assert.throws(() => normalizePreviewLead({ name: 'A', email: 'bad', phone: '123', state: 'johor' }), /电子邮箱/);
  assert.throws(() => normalizePreviewLead({ name: 'A', email: 'a@example.com', phone: '601167459987', state: 'invalid' }), /州属/);
});

test('allows the GitHub Pages origin and only returns https community links', () => {
  assert.equal(allowedPreviewLeadOrigins().has('https://champacademy2u-oss.github.io'), true);
  assert.equal(safeCommunityUrl('https://chat.whatsapp.com/example'), 'https://chat.whatsapp.com/example');
  assert.equal(safeCommunityUrl('javascript:alert(1)'), '');
});

test('the registration endpoint creates a new document for every valid submission', async () => {
  const source = await readFile(new URL('../api/preview-lead.js', import.meta.url), 'utf8');
  assert.match(source, /collection\('preview_leads'\)\.doc\(crypto\.randomUUID\(\)\)/);
  assert.match(source, /await leadRef\.create\(\{/);
  assert.match(source, /campaignId: 'champ-summit-2027'.*amountMinor: 0.*paymentStatus: 'free'/s);
  assert.doesNotMatch(source, /dailyLeadId|existing\.exists|leadRef\.set\(/);
});
