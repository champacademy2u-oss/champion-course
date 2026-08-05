import {
  bucket,
  db,
  id,
  isExpired,
  now,
  readJson,
  sendJson,
  verifyPassword,
  videoDoc
} from './_firebase.js';

async function signedUrl(storagePath) {
  const [url] = await bucket().file(storagePath).getSignedUrl({
    action: 'read',
    expires: Date.now() + 30 * 60 * 1000
  });
  return url;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    const input = await readJson(req);
    const video = await videoDoc(String(input.videoId || ''));
    if (!video) return sendJson(res, 404, { error: '视频不存在或已被删除' });
    if (isExpired(video)) return sendJson(res, 410, { error: '视频观看期限已过' });
    if (!verifyPassword(input.password || '', video.passwordHash)) return sendJson(res, 401, { error: '观看密码不正确' });

    const view = {
      videoId: video.id,
      name: String(input.name || '').trim().slice(0, 80),
      phone: String(input.phone || '').trim().slice(0, 30),
      token: id(),
      startedAt: now(),
      lastSeenAt: now(),
      watchedSeconds: 0,
      completedAt: null
    };
    if (!view.name || !view.phone) return sendJson(res, 400, { error: '请填写姓名和电话号码' });

    const viewRef = db().collection('views').doc();
    await db().runTransaction(async tx => {
      tx.set(viewRef, view);
      tx.update(db().collection('videos').doc(video.id), {
        viewCount: (Number(video.viewCount) || 0) + 1
      });
    });

    const settings = await db().collection('settings').doc('main').get();
    return sendJson(res, 201, {
      view: { id: viewRef.id, ...view, token: undefined },
      viewId: viewRef.id,
      viewToken: view.token,
      signedUrl: await signedUrl(video.storagePath),
      thumbnailUrl: video.thumbnailPath ? await signedUrl(video.thumbnailPath) : '',
      video: { id: video.id, title: video.title, expiresAt: video.expiresAt || '' },
      communityUrl: settings.get('communityUrl') || ''
    });
  } catch (error) {
    return sendJson(res, 400, { error: error.message || '无法开始观看' });
  }
}
