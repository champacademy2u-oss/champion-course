import { bucket, id, maxVideoSize, readJson, requireAdmin, safeName, sendJson } from './_firebase.js';

const supported = new Set(['.mp4', '.webm', '.mov', '.m4v']);

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
    if (!supported.has(ext)) return sendJson(res, 400, { error: '只支持 MP4、WebM、MOV 或 M4V' });
    if (!size || size > maxVideoSize()) return sendJson(res, 400, { error: '视频文件不可超过 1GB' });

    const videoId = id();
    const storagePath = `videos/${videoId}/${originalName}`;
    const contentType = String(input.contentType || 'video/mp4');
    const [uploadUrl] = await bucket().file(storagePath).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 1000 * 60 * 30,
      contentType
    });

    return sendJson(res, 200, { id: videoId, storagePath, uploadUrl, contentType });
  } catch (error) {
    return sendJson(res, error.message === '未授权' ? 401 : 400, { error: error.message || '无法建立上传链接' });
  }
}
