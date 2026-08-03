import { bucket, db, hashPassword, maxVideoSize, publicVideo, readJson, requireAdmin, safeName, sendJson } from './_firebase.js';

const supported = new Set(['.mp4', '.webm', '.mov', '.m4v']);

function extension(filename) {
  const match = String(filename || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

export default async function handler(req, res) {
  try {
    await requireAdmin(req);

    if (req.method === 'POST') {
      const input = await readJson(req);
      const originalName = safeName(input.originalName);
      const ext = extension(originalName);
      if (!supported.has(ext)) return sendJson(res, 400, { error: '只支持 MP4、WebM、MOV 或 M4V' });
      if (!input.title || !input.password || !input.storagePath) return sendJson(res, 400, { error: '请填写标题、观看密码并完成上传' });
      if (Number(input.size) > maxVideoSize()) return sendJson(res, 400, { error: '视频文件不可超过 1GB' });

      const doc = {
        title: String(input.title).trim().slice(0, 100),
        passwordHash: hashPassword(input.password),
        expiresAt: String(input.expiresAt || ''),
        storagePath: String(input.storagePath),
        originalName,
        contentType: String(input.contentType || 'video/mp4'),
        size: Number(input.size) || 0,
        createdAt: new Date().toISOString(),
        viewCount: 0,
        completedCount: 0,
        totalWatchedSeconds: 0
      };

      const ref = db().collection('videos').doc(String(input.id));
      await ref.set(doc);
      return sendJson(res, 201, { video: publicVideo({ id: ref.id, ...doc }) });
    }

    if (req.method === 'DELETE') {
      const videoId = String(new URL(req.url, 'https://local').searchParams.get('id') || '');
      if (!videoId) return sendJson(res, 400, { error: '缺少 video id' });
      const ref = db().collection('videos').doc(videoId);
      const snap = await ref.get();
      if (!snap.exists) return sendJson(res, 404, { error: '找不到视频' });
      const video = snap.data();
      await Promise.all([
        ref.delete(),
        video.storagePath ? bucket().file(video.storagePath).delete({ ignoreNotFound: true }) : Promise.resolve()
      ]);
      const views = await db().collection('views').where('videoId', '==', videoId).get();
      const batch = db().batch();
      views.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return sendJson(res, error.message === '未授权' ? 401 : 400, { error: error.message || '无法处理视频' });
  }
}
