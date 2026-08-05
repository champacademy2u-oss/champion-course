import crypto from 'node:crypto';
import admin from 'firebase-admin';

const defaultWebConfig = {
  apiKey: 'AIzaSyCJ_pqxqo4bCmSPQ0COG1ZkWw64ukX0SoM',
  authDomain: 'champion-course.firebaseapp.com',
  projectId: 'champion-course',
  storageBucket: 'champion-course.firebasestorage.app',
  messagingSenderId: '337920852937',
  appId: '1:337920852937:web:fab67a792d3b15c574de18',
  measurementId: 'G-3RZV6TX39W'
};

function serviceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  return null;
}

function firebaseApp() {
  if (admin.apps.length) return admin.app();
  const account = serviceAccount();
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || defaultWebConfig.storageBucket;
  if (account) {
    return admin.initializeApp({ credential: admin.credential.cert(account), storageBucket });
  }
  return admin.initializeApp({ storageBucket });
}

function fieldValue() {
  return admin.firestore.FieldValue;
}

function db() {
  return firebaseApp().firestore();
}

function bucket() {
  return firebaseApp().storage().bucket();
}

function webConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || defaultWebConfig.apiKey,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || defaultWebConfig.authDomain,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || defaultWebConfig.projectId,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || defaultWebConfig.storageBucket,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || defaultWebConfig.messagingSenderId,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || defaultWebConfig.appId,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || defaultWebConfig.measurementId
  };
}

function adminLoginDisabled() {
  return String(process.env.ADMIN_LOGIN_DISABLED || '').toLowerCase() === 'true';
}

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(value));
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求内容太大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('资料格式不正确'));
      }
    });
    req.on('error', reject);
  });
}

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function safeName(filename) {
  return String(filename || 'video').split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g, '_');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt] = stored.split(':');
  const candidate = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(stored));
}

function adminSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || 'admin123';
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function signAdminPayload(payload) {
  return crypto.createHmac('sha256', adminSecret()).update(payload).digest('base64url');
}

function createAdminSession() {
  const payload = base64Url(JSON.stringify({
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12
  }));
  return `${payload}.${signAdminPayload(payload)}`;
}

async function requireAdmin(req) {
  if (adminLoginDisabled()) return { role: 'public-admin' };
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new Error('未授权');
  const [payload, signature] = token.split('.');
  if (payload && signature) {
    const expected = signAdminPayload(payload);
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('未授权');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (decoded.role !== 'admin' || Number(decoded.exp) < Math.floor(Date.now() / 1000)) throw new Error('未授权');
    return decoded;
  }
  const decoded = await firebaseApp().auth().verifyIdToken(token);
  if (!decoded.admin) throw new Error('未授权');
  return decoded;
}

async function videoDoc(videoId) {
  const snap = await db().collection('videos').doc(videoId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

function publicVideo(video) {
  return {
    id: video.id,
    title: video.title,
    expiresAt: video.expiresAt || '',
    originalName: video.originalName || '',
    hasThumbnail: Boolean(video.thumbnailPath),
    size: Number(video.size) || 0,
    sizeText: formatBytes(Number(video.size) || 0),
    createdAt: video.createdAt || '',
    viewCount: Number(video.viewCount) || 0,
    completedCount: Number(video.completedCount) || 0,
    totalWatchedSeconds: Number(video.totalWatchedSeconds) || 0,
    expired: isExpired(video)
  };
}

function isExpired(video) {
  return Boolean(video?.expiresAt) && new Date(video.expiresAt) <= new Date();
}

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function maxVideoSize() {
  return 1024 * 1024 * 1024;
}

export {
  bucket,
  adminLoginDisabled,
  createAdminSession,
  db,
  fieldValue,
  firebaseApp,
  formatBytes,
  hashPassword,
  id,
  isExpired,
  maxVideoSize,
  now,
  publicVideo,
  readJson,
  requireAdmin,
  safeName,
  sendJson,
  verifyPassword,
  videoDoc,
  webConfig
};
