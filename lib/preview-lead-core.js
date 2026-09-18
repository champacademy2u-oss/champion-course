const PREVIEW_LEAD_SOURCE = 'Champ Learning Landing Page';
const PREVIEW_CAMPAIGN = 'Money Machine Preview Course 2026-08-28';
const CHAMP_PREVIEW_LEAD_SOURCE = 'Champ Preview Landing Page';
const CHAMP_PREVIEW_CAMPAIGN = 'Unlimited Leverage 6.0V 2026-10';

const VALID_STATES = new Set([
  'johor',
  'kedah',
  'kelantan',
  'kuala-lumpur',
  'labuan',
  'melaka',
  'negeri-sembilan',
  'pahang',
  'penang',
  'perak',
  'perlis',
  'sabah',
  'sarawak',
  'selangor',
  'terengganu'
]);

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

function normalizePreviewLead(input = {}) {
  const course = cleanText(input.course, 40);
  if (course && course !== 'champ-preview') throw new Error('课程资料不正确');
  const name = cleanText(input.name, 100);
  const email = normalizeEmail(input.email);
  const phone = cleanText(input.phone, 40);
  const state = cleanText(input.state, 40).toLowerCase();

  if (!name || !email || !phone || !state) throw new Error('请填写完整的报名资料');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请填写正确的电子邮箱');
  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.length < 8 || phoneDigits.length > 15) throw new Error('请填写正确的联系电话');
  if (!VALID_STATES.has(state)) throw new Error('请选择正确的州属');

  return {
    name,
    email,
    phone,
    phoneDigits,
    state,
    source: course === 'champ-preview' ? CHAMP_PREVIEW_LEAD_SOURCE : PREVIEW_LEAD_SOURCE,
    campaign: course === 'champ-preview' ? CHAMP_PREVIEW_CAMPAIGN : PREVIEW_CAMPAIGN,
    courseDate: course === 'champ-preview' ? '2026-10' : '2026-08-28'
  };
}

function allowedPreviewLeadOrigins(value = '') {
  const defaults = 'https://champacademy2u-oss.github.io,http://localhost:5173,http://127.0.0.1:5173';
  return new Set(String(value || defaults).split(',').map(origin => origin.trim()).filter(Boolean));
}

function safeCommunityUrl(value) {
  try {
    const url = new URL(cleanText(value, 500));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export {
  CHAMP_PREVIEW_CAMPAIGN,
  CHAMP_PREVIEW_LEAD_SOURCE,
  PREVIEW_CAMPAIGN,
  PREVIEW_LEAD_SOURCE,
  allowedPreviewLeadOrigins,
  cleanText,
  normalizePreviewLead,
  safeCommunityUrl
};
