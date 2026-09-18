import { getStoredObject } from './_r2.js';
import { MAX_EMAIL_IMAGE_BYTES, validEmailImageId } from '../lib/email-campaign-image.js';

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
    const object = await getStoredObject(`email-images/${imageId}`);
    const contentType = String(object.ContentType || '').toLowerCase();
    if (!allowedTypes.has(contentType) || Number(object.ContentLength) > MAX_EMAIL_IMAGE_BYTES) {
      res.statusCode = 404;
      return res.end();
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of object.Body) {
      size += chunk.length;
      if (size > MAX_EMAIL_IMAGE_BYTES) {
        res.statusCode = 404;
        return res.end();
      }
      chunks.push(chunk);
    }
    const image = Buffer.concat(chunks);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(image.length));
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(req.method === 'HEAD' ? undefined : image);
  } catch (error) {
    res.statusCode = error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404 ? 404 : 503;
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }
}
