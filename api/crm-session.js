import { db, fieldValue, firebaseApp } from './_firebase.js';
import { createCrmSessionHandler, DEFAULT_CRM_SHARED_UID } from '../lib/crm-session.js';

function allowedOrigins() {
  return new Set(String(process.env.CRM_SHARED_ALLOWED_ORIGINS || 'https://champacademy2u-oss.github.io,http://localhost:4174,http://127.0.0.1:4174,http://localhost:4175,http://127.0.0.1:4175')
    .split(',').map(value => value.trim()).filter(Boolean));
}

const repository = {
  async recordAttempt({ key, success, now, maxAttempts, windowMs, blockMs }) {
    const ref = db().collection('crm_login_rate_limits').doc(key);
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
  },
  async ensureSharedAdmin(uid, role) {
    await db().collection('crm_admins').doc(uid).set({
      active: true,
      role,
      updatedAt: fieldValue().serverTimestamp()
    }, { merge: true });
  }
};

const handler = createCrmSessionHandler({
  secret: process.env.CRM_SHARED_LOGIN_PASSWORD,
  uid: process.env.CRM_SHARED_ADMIN_UID || DEFAULT_CRM_SHARED_UID,
  auth: firebaseApp().auth(),
  repository,
  allowedOrigins: allowedOrigins()
});

export default handler;
