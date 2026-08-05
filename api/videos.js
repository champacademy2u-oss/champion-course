import { bucket, db, hashPassword, maxVideoSize, publicVideo, readJson, requireAdmin, safeName, sendJson } from './_firebase.js';

const supported = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const thumbnailTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

function extension(filename) {
  const match = String(filename || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

async function verifyThumbnail(input, videoId) {
  const thumbnailPath = String(input.thumbnailPath || '');
  if (!thumbnailPath) return {};
  if (!thumbnailPath.startsWith(`videos/${videoId}/thumbnail-`)) {
    throw new Error('Thumbnail 上传路径不正确');
  }
  const contentType = String(input.thumbnailContentType || '');
  if (!thumbnailTypes.has(contentType)) throw new Error('Thumbnail 格式不正确');
  const [exists] = await bucket().file(thumbnailPath).exists();
  if (!exists) throw new Error('Thumbnail 还没有完整上传，请稍后再试');
  return { thumbnailPath, thumbnailContentType: contentType };
}

export default async function handler(req, res) {
  try {
    await requireAdmin(req);

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
      const [exists] = await bucket().file(storagePath).exists();
      if (!exists) return sendJson(res, 400, { error: '视频还没有完整上传，请稍后再试' });
      const thumbnail = await verifyThumbnail(input, videoId);

      const doc = {
        title: String(input.title).trim().slice(0, 100),
        passwordHash: hashPassword(input.password),
        expiresAt: String(input.expiresAt || ''),
        storagePath,
        originalName,
        contentType: String(input.contentType || 'video/mp4'),
        size: Number(input.size) || 0,
        ...thumbnail,
        createdAt: new Date().toISOString(),
        viewCount: 0,
        completedCount: 0,
        totalWatchedSeconds: 0
      };

      const ref = db().collection('videos').doc(videoId);
      await ref.set(doc);
      return sendJson(res, 201, { video: publicVideo({ id: ref.id, ...doc }) });
    }

    if (req.method === 'PUT') {
      const input = await readJson(req);
      const videoId = String(input.id || '');
      if (!videoId) return sendJson(res, 400, { error: '缺少 video id' });
      const ref = db().collection('videos').doc(videoId);
      const snap = await ref.get();
      if (!snap.exists) return sendJson(res, 404, { error: '找不到视频' });
      const thumbnail = await verifyThumbnail(input, videoId);
      if (!thumbnail.thumbnailPath) return sendJson(res, 400, { error: '请选择 Thumbnail' });

      const previousPath = String(snap.get('thumbnailPath') || '');
      const patch = { ...thumbnail, thumbnailUpdatedAt: new Date().toISOString() };
      await ref.update(patch);
      if (previousPath && previousPath !== thumbnail.thumbnailPath) {
        await bucket().file(previousPath).delete().catch(error => {
          if (error.code !== 404) throw error;
        });
      }
      return sendJson(res, 200, { video: publicVideo({ id: ref.id, ...snap.data(), ...patch }) });
    }

    if (req.method === 'DELETE') {
      const videoId = String(new URL(req.url, 'https://local').searchParams.get('id') || '');
      if (!videoId) return sendJson(res, 400, { error: '缺少 video id' });
      const ref = db().collection('videos').doc(videoId);
      const snap = await ref.get();
      if (!snap.exists) return sendJson(res, 404, { error: '找不到视频' });
      const video = snap.data();
      const storagePaths = [video.storagePath, video.thumbnailPath].filter(Boolean);
      await Promise.all(storagePaths.map(storagePath =>
        bucket().file(storagePath).delete().catch(error => {
          if (error.code !== 404) throw error;
        })
      ));
      await ref.delete();
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
