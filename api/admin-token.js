import { firebaseApp, readJson, sendJson } from './_firebase.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    const input = await readJson(req);
    const expected = process.env.ADMIN_PASSWORD || 'admin123';
    if (String(input.password || '') !== expected) return sendJson(res, 401, { error: '管理员密码不正确' });
    const uid = process.env.ADMIN_UID || 'video-admin';
    const token = await firebaseApp().auth().createCustomToken(uid, { admin: true });
    return sendJson(res, 200, { token });
  } catch (error) {
    return sendJson(res, 400, { error: error.message || '无法登录' });
  }
}
