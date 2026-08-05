import crypto from 'node:crypto';

const DEFAULT_TIMEZONE = 'Asia/Kuala_Lumpur';
const DEFAULT_UTC_OFFSET = '+08:00';

function cleanText(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return cleanText(value, 160).toLowerCase();
}

function normalizePhone(value) {
  const raw = cleanText(value, 32).replace(/[\s().-]/g, '');
  if (!raw) return '';
  return raw.startsWith('+') ? `+${raw.slice(1).replace(/\D/g, '')}` : `+${raw.replace(/\D/g, '')}`;
}

function eventStartIso(eventDate, eventTime) {
  const date = cleanText(eventDate, 10);
  const time = cleanText(eventTime, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return '';
  const parsed = new Date(`${date}T${time}:00${DEFAULT_UTC_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function duplicateRegistrationId(eventId, email, phone) {
  return crypto.createHash('sha256')
    .update(`${cleanText(eventId, 120)}|${normalizeEmail(email)}|${normalizePhone(phone)}`)
    .digest('hex');
}

function fillTemplate(template, values = {}) {
  return cleanText(template, 12000).replace(/{{\s*([a-z_]+)\s*}}/gi, (_, key) => cleanText(values[key], 2000));
}

function formatEventDate(event) {
  if (!event?.eventDate) return '';
  const date = new Date(`${event.eventDate}T12:00:00${DEFAULT_UTC_OFFSET}`);
  if (Number.isNaN(date.getTime())) return cleanText(event.eventDate, 20);
  return new Intl.DateTimeFormat('zh-MY', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(date);
}

function publicEvent(event, id = event?.id) {
  const seatLimit = Math.max(0, Number(event?.seatLimit) || 0);
  const registeredCount = Math.max(0, Number(event?.registeredCount) || 0);
  const startsAt = cleanText(event?.startsAt, 40);
  const remainingSeats = seatLimit > 0 ? Math.max(0, seatLimit - registeredCount) : null;
  const registrationOpen = event?.status === 'published'
    && Boolean(startsAt)
    && new Date(startsAt).getTime() > Date.now()
    && (remainingSeats === null || remainingSeats > 0);

  return {
    id: cleanText(id, 120),
    title: cleanText(event?.title, 120),
    subtitle: cleanText(event?.subtitle, 240),
    speakerName: cleanText(event?.speakerName, 100),
    eventDate: cleanText(event?.eventDate, 10),
    eventTime: cleanText(event?.eventTime, 5),
    timezone: DEFAULT_TIMEZONE,
    startsAt,
    seatLimit: seatLimit || null,
    remainingSeats,
    registrationOpen
  };
}

function validateRegistration(input = {}) {
  const name = cleanText(input.name, 80);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  if (name.length < 2) throw new Error('请填写完整姓名');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email 格式不正确');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('手机号码必须包含国际区号');
  if (input.consent !== true) throw new Error('请同意接收本次活动通知');
  if (cleanText(input.website, 100)) throw new Error('无法处理这次报名');
  return { name, email, phone, consent: true };
}

function safeSource(input = {}) {
  return {
    source: cleanText(input.source, 80),
    utmSource: cleanText(input.utmSource, 120),
    utmMedium: cleanText(input.utmMedium, 120),
    utmCampaign: cleanText(input.utmCampaign, 160),
    utmContent: cleanText(input.utmContent, 160),
    keyword: cleanText(input.keyword, 40)
  };
}

export {
  DEFAULT_TIMEZONE,
  cleanText,
  duplicateRegistrationId,
  eventStartIso,
  fillTemplate,
  formatEventDate,
  publicEvent,
  safeSource,
  validateRegistration
};
