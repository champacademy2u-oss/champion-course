import { db, formatBytes, publicVideo, requireAdmin, sendJson } from './_firebase.js';
import { createReadUrl } from './_r2.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    await requireAdmin(req);

    const [settingsSnap, videosSnap, viewsSnap] = await Promise.all([
      db().collection('settings').doc('main').get(),
      db().collection('videos').orderBy('createdAt', 'desc').get(),
      db().collection('views').orderBy('startedAt', 'desc').limit(300).get()
    ]);

    const videos = await Promise.all(videosSnap.docs.map(async doc => {
      const video = { id: doc.id, ...doc.data() };
      const [previewUrl, thumbnailPreviewUrl] = await Promise.all([
        video.storagePath ? createReadUrl(video.storagePath).catch(() => '') : '',
        video.thumbnailPath ? createReadUrl(video.thumbnailPath).catch(() => '') : ''
      ]);
      return { ...publicVideo(video), previewUrl, thumbnailPreviewUrl };
    }));
    const videoTitles = Object.fromEntries(videos.map(video => [video.id, video.title]));
    const views = viewsSnap.docs.map(doc => {
      const view = { id: doc.id, ...doc.data() };
      return { ...view, videoTitle: videoTitles[view.videoId] || '已删除视频' };
    });
    const uploadBytes = videos.reduce((sum, video) => sum + (Number(video.size) || 0), 0);

    return sendJson(res, 200, {
      settings: {
        brandName: settingsSnap.get('brandName') || 'Secure Video Room',
        communityUrl: settingsSnap.get('communityUrl') || '',
        webhookUrl: settingsSnap.get('webhookUrl') || ''
      },
      videos,
      views,
      stats: {
        videos: videos.length,
        views: views.length,
        completed: views.filter(view => view.completedAt).length
      },
      system: {
        status: 'online',
        platform: 'Vercel + Firestore + R2',
        storage: 'Cloudflare R2',
        uploadTotal: formatBytes(uploadBytes),
        maxVideoSize: '1 GB'
      }
    });
  } catch (error) {
    return sendJson(res, error.message === '未授权' ? 401 : 400, { error: error.message || '无法读取后台数据' });
  }
}
