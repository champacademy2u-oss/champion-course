import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  duplicateRegistrationId,
  publicEvent,
  validateRegistration
} from '../lib/zoom-core.js';

test('Vercel Zoom registration validates and deduplicates customer details', () => {
  const person = validateRegistration({
    name: ' Test Customer ',
    email: 'TEST@example.com ',
    phone: '+60 12-345 6789',
    consent: true
  });
  assert.deepEqual(person, {
    name: 'Test Customer',
    email: 'test@example.com',
    phone: '+60123456789',
    consent: true
  });
  assert.equal(
    duplicateRegistrationId('event-1', 'TEST@example.com', '+60 12-345 6789'),
    duplicateRegistrationId('event-1', 'test@example.com', '+60123456789')
  );
});

test('public Zoom event never exposes its private meeting link', () => {
  const event = publicEvent({
    id: 'event-1',
    title: 'Preview',
    status: 'published',
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    joinUrl: 'https://example.zoom.us/j/private'
  });
  assert.equal('joinUrl' in event, false);
  assert.equal(JSON.stringify(event).includes('zoom.us'), false);
});

test('Zoom admin contains a registration list and uses the deployed API', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const config = fs.readFileSync(new URL('../config.js', import.meta.url), 'utf8');
  assert.match(html, /id="zoomRegistrationsBody"/);
  assert.match(html, /最新报名记录/);
  assert.match(config, /champion-course-video-room\.vercel\.app\/api\/zoom/);
  assert.match(config, /singleEndpoint:\s*true/);
});
