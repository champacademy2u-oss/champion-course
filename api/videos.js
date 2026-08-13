import { db, hashPassword, maxVideoSize, normalizeExpiresAt, publicVideo, readJson, requireAdmin, safeName, sendJson } from './_firebase.js';
import { deleteStoredObject, storedObjectExists } from './_r2.js';

const supported = new Set(['.mp4', '.webm', '.mov', '.m4v']);

function extension(filename) {
  const match = String(filename || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

export default async function handler(req, res) {
  try {
    await requireAdmin(req);

    if (req.method === 'PATCH') {
      const input = await readJson(req);
      const videoId = String(input.id || '').trim();
      if (!videoId) return sendJson(res, 400, { error: '缺少 video id' });
      const hasTitle = Object.prototype.hasOwnProperty.call(input, 'title');
      const hasExpiresAt = Object.prototype.hasOwnProperty.call(input, 'expiresAt');
      if (!hasTitle && !hasExpiresAt) return sendJson(res, 400, { error: '没有需要更新的视频资料' });

      const ref = db().collection('videos').doc(videoId);
      const snap = await ref.get();
      if (!snap.exists) return sendJson(res, 404, { error: '找不到视频' });

      const updates = { updatedAt: new Date().toISOString() };
      if (hasTitle) {
        const title = String(input.title ?? '').trim();
        if (!title) return sendJson(res, 400, { error: '视频名称不可留空' });
        if (title.length > 100) return sendJson(res, 400, { error: '视频名称不可超过 100 个字' });
        updates.title = title;
      }
      if (hasExpiresAt) updates.expiresAt = normalizeExpiresAt(input.expiresAt);

      await ref.update(updates);
      return sendJson(res, 200, { video: publicVideo({ id: videoId, ...snap.data(), ...updates }) });
    }

    if (req.method === 'POST') {
      const input = await readJson(req);
      const originalName = safeName(input.originalName);
      const ext = extension(originalName);
      if (!supported.has(ext)) return sendJson(res, 400, { error: '只支持 MP4、WebM、MOV 或 M4V' });
      const videoId = String(input.id || '');
      const storagePath = String(input.storagePath || '');
      if (!videoId || !input.title || !input.password || !storagePath) return sendJson(res, 400, { error: '请填写标题、观看密码并完成上传' });
      if (!storagePath.startsWith(`videos/${videoId}/`)) return sendJson(res, 400, { error: '视频上传路径不正确' });
      if (Number(input.size) > maxVideoSize()) return sendJson(res, 400, { error: '视频文件不可超过 1GB' });
      const exists = await storedObjectExists(storagePath);
      if (!exists) return sendJson(res, 400, { error: '视频还没有完整上传，请稍后再试' });

      const doc = {
        title: String(input.title).trim().slice(0, 100),
        passwordHash: hashPassword(input.password),
        expiresAt: normalizeExpiresAt(input.expiresAt),
        storagePath,
        originalName,
        contentType: String(input.contentType || 'video/mp4'),
        storageProvider: 'cloudflare-r2',
        size: Number(input.size) || 0,
        createdAt: new Date().toISOString(),
        viewCount: 0,
        completedCount: 0,
        totalWatchedSeconds: 0
      };

      const ref = db().collection('videos').doc(videoId);
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
      const removeFile = video.storagePath
        ? deleteStoredObject(video.storagePath)
        : Promise.resolve();
      await Promise.all([
        ref.delete(),
        removeFile
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
