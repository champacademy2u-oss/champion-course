import {
  createAdminSession,
  db,
  fieldValue,
  readJson
} from './_firebase.js';
import { createLegacyAdminTokenHandler } from '../lib/admin-token.js';
import crmSessionHandler from './crm-session.js';

const repository = {
  async recordAttempt({ key, success, now, maxAttempts, windowMs, blockMs }) {
    const ref = db().collection('admin_login_rate_limits').doc(key);
    return db().runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists ? snapshot.data() : {};
      const blockedUntil = Number(current.blockedUntil) || 0;
      if (blockedUntil > now) return { blocked: true, retryAfterMs: blockedUntil - now };
      if (success) {
        if (snapshot.exists) transaction.delete(ref);
        return { blocked: false };
      }

      const windowStartedAt = Number(current.windowStartedAt) || 0;
      const withinWindow = windowStartedAt > 0 && now - windowStartedAt < windowMs;
      const attempts = withinWindow ? (Number(current.attempts) || 0) + 1 : 1;
      const nextWindowStartedAt = withinWindow ? windowStartedAt : now;
      const nextBlockedUntil = attempts >= maxAttempts ? now + blockMs : 0;
      transaction.set(ref, {
        attempts,
        windowStartedAt: nextWindowStartedAt,
        blockedUntil: nextBlockedUntil,
        expiresAt: new Date(now + Math.max(windowMs, blockMs) * 2).toISOString(),
        updatedAt: fieldValue().serverTimestamp()
      }, { merge: true });
      return nextBlockedUntil > now
        ? { blocked: true, retryAfterMs: nextBlockedUntil - now }
        : { blocked: false };
    });
  }
};

const legacyAdminTokenHandler = createLegacyAdminTokenHandler({
  secret: process.env.ADMIN_PASSWORD,
  repository,
  createSession: createAdminSession,
  readInput: readJson
});

// Vercel Hobby deployments are limited to 12 Serverless Functions. Keep the
// shared CRM session endpoint isolated by URL and handler, while bundling it
// into the existing admin-token function so no extra public function is used.
export default async function adminAuthRouter(req, res) {
  if (String(req.query?.mode || '') === 'crm-session') {
    return crmSessionHandler(req, res);
  }
  return legacyAdminTokenHandler(req, res);
}
