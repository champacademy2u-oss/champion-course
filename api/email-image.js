import { once } from 'node:events';
import { getStoredObject, headStoredObject } from './_r2.js';
import { MAX_EMAIL_IMAGE_BYTES, validEmailImageId } from '../lib/email-campaign-image.js';

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function sendCampaignImageObject(object, res, method = 'GET') {
  const contentType = String(object.ContentType || '').toLowerCase();
  const size = Number(object.ContentLength);
  if (!allowedTypes.has(contentType) || !Number.isSafeInteger(size) || size < 1 || size > MAX_EMAIL_IMAGE_BYTES) {
    object.Body?.destroy?.();
    res.statusCode = 404;
    return res.end();
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(size));
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (method === 'HEAD') return res.end();

  let sent = 0;
  for await (const chunk of object.Body) {
    sent += chunk.length;
    if (sent > size || sent > MAX_EMAIL_IMAGE_BYTES) {
      res.destroy();
      return;
    }
    if (!res.write(chunk)) await once(res, 'drain');
  }
  return res.end();
}

export default async function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end();
  }

  const imageId = new URL(req.url, 'https://local').searchParams.get('id');
  if (!validEmailImageId(imageId)) {
    res.statusCode = 404;
    return res.end();
  }

  try {
    const objectKey = `email-images/${imageId}`;
    const object = req.method === 'HEAD' ? await headStoredObject(objectKey) : await getStoredObject(objectKey);
    return await sendCampaignImageObject(object, res, req.method);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    res.statusCode = error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404 ? 404 : 503;
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }
}
