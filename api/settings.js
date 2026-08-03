import { db, readJson, requireAdmin, sendJson } from './_firebase.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
    await requireAdmin(req);
    const input = await readJson(req);
    await db().collection('settings').doc('main').set({
      brandName: String(input.brandName || 'Secure Video Room').slice(0, 80),
      communityUrl: String(input.communityUrl || '').slice(0, 500),
      webhookUrl: String(input.webhookUrl || '').slice(0, 500),
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, error.message === '未授权' ? 401 : 400, { error: error.message || '无法储存设置' });
  }
}
