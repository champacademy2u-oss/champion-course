import crypto from 'node:crypto';

export const CRM_SHARED_ROLE = 'crm_shared_admin';
export const DEFAULT_CRM_SHARED_UID = 'champ-crm-shared-admin';

const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://champacademy2u-oss.github.io',
  'http://localhost:4174',
  'http://127.0.0.1:4174',
  'http://localhost:4175',
  'http://127.0.0.1:4175'
]);

function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest();
}

export function passwordMatches(input, expected) {
  const actualDigest = digest(input);
  const expectedDigest = digest(expected);
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

export function requestIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown').trim() || 'unknown';
}

export function rateLimitKey(ip, secret) {
  return crypto.createHmac('sha256', String(secret)).update(String(ip), 'utf8').digest('hex');
}

function bodyObject(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  try {
    const value = JSON.parse(String(req.body || '{}'));
    return value && !Array.isArray(value) && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function send(res, status, value, retryAfter = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (retryAfter > 0) res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfter / 1000))));
  res.end(JSON.stringify(value));
}

function originAllowed(req, res, allowedOrigins) {
  const origin = String(req.headers?.origin || '').trim();
  res.setHeader('Vary', 'Origin');
  if (!origin || !allowedOrigins.has(origin)) {
    send(res, 403, { error: '此来源不允许登录 CRM。' });
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return false;
  }
  return true;
}

export function createCrmSessionHandler({
  secret,
  uid = DEFAULT_CRM_SHARED_UID,
  auth,
  repository,
  clock = () => Date.now(),
  allowedOrigins = DEFAULT_ALLOWED_ORIGINS,
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
  blockMs = 15 * 60 * 1000
}) {
  const origins = allowedOrigins instanceof Set ? allowedOrigins : new Set(allowedOrigins || []);
  return async function crmSessionHandler(req, res) {
    if (!originAllowed(req, res, origins)) return;
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (!secret || !auth || !repository) return send(res, 503, { error: 'CRM 登录尚未完成服务器设置。' });
    try {
      const input = bodyObject(req);
      const password = typeof input.password === 'string' ? input.password : '';
      if (!password || password.length > 256) return send(res, 401, { error: '密码不正确。' });

      const now = Number(clock());
      const key = rateLimitKey(requestIp(req), secret);
      const success = passwordMatches(password, secret);
      const limit = await repository.recordAttempt({ key, success, now, maxAttempts, windowMs, blockMs });
      if (limit?.blocked) return send(res, 429, { error: '尝试次数太多，请稍后再试。' }, limit.retryAfterMs);
      if (!success) return send(res, 401, { error: '密码不正确。' });

      await repository.ensureSharedAdmin(uid, CRM_SHARED_ROLE);
      const token = await auth.createCustomToken(uid, { admin: true, role: CRM_SHARED_ROLE });
      return send(res, 200, { customToken: token, expiresIn: 3600 });
    } catch {
      return send(res, 503, { error: 'CRM 登录服务暂时无法使用，请稍后再试。' });
    }
  };
}
