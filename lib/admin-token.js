import {
  passwordMatches,
  rateLimitKey,
  requestIp
} from './crm-session.js';

function send(res, status, value, retryAfterMs = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (retryAfterMs > 0) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  }
  res.end(JSON.stringify(value));
}

export function createLegacyAdminTokenHandler({
  secret,
  repository,
  createSession,
  readInput,
  clock = () => Date.now(),
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
  blockMs = 15 * 60 * 1000
}) {
  return async function legacyAdminTokenHandler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (!secret || !repository || !createSession || !readInput) {
      return send(res, 503, { error: '管理员登录暂时无法使用' });
    }

    try {
      const input = await readInput(req);
      const password = typeof input?.password === 'string' ? input.password : '';
      if (!password || password.length > 256) {
        return send(res, 401, { error: '管理员登录资料不正确' });
      }

      const now = Number(clock());
      const key = rateLimitKey(`legacy-admin:${requestIp(req)}`, secret);
      const success = passwordMatches(password, secret);
      const limit = await repository.recordAttempt({
        key,
        success,
        now,
        maxAttempts,
        windowMs,
        blockMs
      });
      if (limit?.blocked) {
        return send(res, 429, { error: '尝试次数太多，请稍后再试' }, limit.retryAfterMs);
      }
      if (!success) return send(res, 401, { error: '管理员登录资料不正确' });
      return send(res, 200, { token: createSession() });
    } catch {
      return send(res, 503, { error: '管理员登录暂时无法使用' });
    }
  };
}
