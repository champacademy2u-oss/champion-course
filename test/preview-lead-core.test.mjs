import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
