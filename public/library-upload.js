(() => {
  const channel = 'champ-library-upload-v1';
  const parents = new Set(['https://champacademy2u-oss.github.io', 'https://champacademy.asia', 'https://www.champacademy.asia', location.origin]);
  const mimes = new Set(['application/pdf','image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif','video/mp4','video/quicktime','video/webm']);
  let active = false;
  window.addEventListener('message', event => {
    if (active || event.source !== parent || !parents.has(event.origin) || event.data?.channel !== channel) return;
    const { id, url, file, mime } = event.data;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) return;
    const send = payload => event.source.postMessage({ channel, id, ...payload }, event.origin);
    let destination;
    try { destination = new URL(url); } catch { send({ status: 'error', code: 'destination_policy' }); return; }
    if (destination.protocol !== 'https:' || !destination.hostname.endsWith('.r2.cloudflarestorage.com')
      || destination.username || destination.password || !destination.pathname.startsWith('/champ-library/')
      || !destination.searchParams.has('X-Amz-Signature')) {
      send({ status: 'error', code: 'destination_policy' }); return;
    }
    if (!(file instanceof Blob) || !mimes.has(mime) || file.size <= 0 || file.size > (mime.startsWith('video/') ? 1024 ** 3 : 50 * 1024 ** 2)) {
      send({ status: 'error', code: 'file_policy' }); return;
    }
    active = true;
    send({ status: 'accepted' });
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', destination.href);
    xhr.setRequestHeader('Content-Type', mime);
    xhr.timeout = 29 * 60 * 1000;
    xhr.upload.onprogress = progress => { if (progress.lengthComputable) send({ status: 'progress', percent: Math.round(progress.loaded / progress.total * 95) }); };
    xhr.onload = () => send({ status: xhr.status >= 200 && xhr.status < 300 ? 'complete' : 'error', httpStatus: xhr.status });
    xhr.onerror = () => send({ status: 'error', code: 'network_cors' });
    xhr.ontimeout = () => send({ status: 'error', code: 'timeout' });
    xhr.send(file);
  });
})();
