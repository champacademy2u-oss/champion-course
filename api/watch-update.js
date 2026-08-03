import { db, fieldValue, now, readJson, sendJson } from './_firebase.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    const input = await readJson(req);
    const viewId = String(input.viewId || '');
    const token = String(input.viewToken || '');
    if (!viewId || !token) return sendJson(res, 401, { error: '观看会话无效' });

    const viewRef = db().collection('views').doc(viewId);
    const viewSnap = await viewRef.get();
    if (!viewSnap.exists || viewSnap.get('token') !== token) return sendJson(res, 401, { error: '观看会话无效' });
    const view = viewSnap.data();
    const previousSeconds = Number(view.watchedSeconds) || 0;
    const watchedSeconds = Math.max(previousSeconds, Math.min(Number(input.watchedSeconds) || 0, 24 * 3600));
    const watchedDelta = watchedSeconds - previousSeconds;
    const completedNow = Boolean(input.completed) && !view.completedAt;

    await db().runTransaction(async tx => {
      tx.update(viewRef, {
        watchedSeconds,
        lastSeenAt: now(),
        ...(completedNow ? { completedAt: now() } : {})
      });
      tx.update(db().collection('videos').doc(view.videoId), {
        totalWatchedSeconds: fieldValue().increment(watchedDelta),
        ...(completedNow ? { completedCount: fieldValue().increment(1) } : {})
      });
    });

    const settings = await db().collection('settings').doc('main').get();
    return sendJson(res, 200, { ok: true, communityUrl: settings.get('communityUrl') || '' });
  } catch (error) {
    return sendJson(res, 400, { error: error.message || '无法更新观看记录' });
  }
}
