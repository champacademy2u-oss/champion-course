import {
  adminZoomDataHandler,
  getActiveZoomEventHandler,
  registerForZoomHandler,
  resendZoomNotificationHandler,
  saveZoomEventHandler
} from '../lib/zoom-api.js';

const handlers = {
  adminZoomData: adminZoomDataHandler,
  getActiveZoomEvent: getActiveZoomEventHandler,
  registerForZoom: registerForZoomHandler,
  resendZoomNotification: resendZoomNotificationHandler,
  saveZoomEvent: saveZoomEventHandler
};

export default async function handler(req, res) {
  const action = String(new URL(req.url, 'https://local').searchParams.get('action') || '');
  const selected = handlers[action];
  if (!selected) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: '找不到 Zoom 操作' }));
    return;
  }
  return selected(req, res);
}
