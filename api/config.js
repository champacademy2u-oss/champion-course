import { maxVideoSize, sendJson, webConfig } from './_firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  return sendJson(res, 200, {
    firebase: webConfig(),
    maxVideoSize: maxVideoSize(),
    maxVideoSizeText: '1 GB'
  });
}
