import { id, maxVideoSize, readJson, requireAdmin, safeName, sendJson } from './_firebase.js';
import { createUploadUrl } from './_r2.js';

const supportedVideos = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const supportedThumbnails = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const maxThumbnailSize = 5 * 1024 * 1024;

function extension(filename) {
  const match = String(filename || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    await requireAdmin(req);
    const input = await readJson(req);
    const originalName = safeName(input.originalName);
    const ext = extension(originalName);
    const size = Number(input.size) || 0;
    const kind = input.kind === 'thumbnail' ? 'thumbnail' : 'video';

    if (kind === 'thumbnail') {
      const videoId = String(input.videoId || '').trim();
      if (!/^[a-zA-Z0-9-]{10,80}$/.test(videoId)) {
        return sendJson(res, 400, { error: 'Thumbnail 的视频 ID 不正确' });
      }
      if (!supportedThumbnails.has(ext)) {
        return sendJson(res, 400, { error: 'Thumbnail 只支持 PNG、JPG 或 WebP' });
      }
      if (!size || size > maxThumbnailSize) {
        return sendJson(res, 400, { error: 'Thumbnail 不可超过 5MB' });
      }
      const storagePath = `videos/${videoId}/thumbnail-${Date.now()}-${originalName}`;
      const contentType = String(input.contentType || 'image/png');
      const uploadUrl = await createUploadUrl(storagePath, contentType);
      return sendJson(res, 200, { kind, videoId, storagePath, uploadUrl, contentType });
    }

    if (!supportedVideos.has(ext)) return sendJson(res, 400, { error: '只支持 MP4、WebM、MOV 或 M4V' });
    if (!size || size > maxVideoSize()) return sendJson(res, 400, { error: '视频文件不可超过 1GB' });

    const videoId = id();
    const storagePath = `videos/${videoId}/${originalName}`;
    const contentType = String(input.contentType || 'video/mp4');
    const uploadUrl = await createUploadUrl(storagePath, contentType);

    return sendJson(res, 200, { kind, id: videoId, storagePath, uploadUrl, contentType });
  } catch (error) {
    return sendJson(res, error.message === '未授权' ? 401 : 400, { error: error.message || '无法建立上传链接' });
  }
}
