import { isExpired, publicVideo, sendJson, videoDoc } from './_firebase.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    const videoId = String(new URL(req.url, 'https://local').searchParams.get('id') || '');
    const video = await videoDoc(videoId);
    if (!video) return sendJson(res, 404, { error: '视频不存在或已被删除' });
    if (isExpired(video)) return sendJson(res, 410, { error: '视频观看期限已过' });
    return sendJson(res, 200, publicVideo(video));
  } catch (error) {
    return sendJson(res, 400, { error: error.message || '无法读取视频' });
  }
}
