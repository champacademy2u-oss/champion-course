// R2 already accepts the existing video backend origin. Transfer the File to a
// sandboxed frame on that origin, so large uploads stay direct and private.
const CHANNEL = 'champ-library-upload-v1';
export function isRelayMessage(event, frameWindow, origin, id) {
  return event.source === frameWindow && event.origin === origin
    && event.data?.channel === CHANNEL && event.data?.id === id;
}
export function uploadThroughRelay({ endpoint, url, file, mime, onProgress = () => {} }) {
  return new Promise((resolve, reject) => {
    const origin = new URL(endpoint, location.href).origin;
    const id = crypto.randomUUID();
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Champ 私有文件上传';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.referrerPolicy = 'strict-origin';
    frame.src = new URL('/library-upload.html', origin).href;
    let settled = false, started = false, sent = false;
    const timeout = setTimeout(() => finish(new Error('上传连接超时，请刷新资料列表核对后重试。')), 30 * 60 * 1000);
    const loadTimeout = setTimeout(() => { if (!started) finish(new Error('无法连接云端上传通道，请稍后再试。')); }, 20000);
    function finish(error) {
      if (settled) return;
      settled = true; clearTimeout(timeout); clearTimeout(loadTimeout);
      window.removeEventListener('message', message); frame.remove();
      error ? reject(error) : resolve();
    }
    function message(event) {
      if (!isRelayMessage(event, frame.contentWindow, origin, id)) return;
      if (['accepted', 'progress', 'complete'].includes(event.data.status)) { started = true; clearTimeout(loadTimeout); }
      if (event.data.status === 'progress' && Number.isFinite(event.data.percent)) onProgress(Math.max(0, Math.min(95, event.data.percent)));
      if (event.data.status === 'complete') finish();
      if (event.data.status === 'error') finish(new Error('云端上传未完成，请检查网络后重试。'));
    }
    window.addEventListener('message', message);
    frame.addEventListener('load', () => {
      if (settled || sent) return;
      sent = true;
      frame.contentWindow.postMessage({ channel: CHANNEL, id, url, file, mime }, origin);
    });
    frame.addEventListener('error', () => finish(new Error('无法连接云端上传通道。')));
    document.body.append(frame);
  });
}
