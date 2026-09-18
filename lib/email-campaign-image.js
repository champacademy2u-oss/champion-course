export const MAX_EMAIL_IMAGE_BYTES = 50 * 1024 * 1024;
export const EMAIL_IMAGE_CHUNK_BYTES = 2 * 1024 * 1024;

const imageTypes = {
  'image/jpeg': bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': bytes => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/webp': bytes => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
};

export function decodeCampaignImage(input = {}) {
  const contentType = String(input.contentType || '').trim().toLowerCase();
  const data = String(input.data || '');
  if (!imageTypes[contentType]) throw new Error('图片只支持 JPG、PNG 或 WebP');
  if (!data || data.length > Math.ceil(EMAIL_IMAGE_CHUNK_BYTES * 4 / 3) + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new Error('图片格式不正确或超过 2 MB');
  }
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > EMAIL_IMAGE_CHUNK_BYTES) throw new Error('图片不可超过 2 MB');
  if (!campaignImageMatchesType(contentType, bytes)) throw new Error('图片内容与格式不符');
  return { bytes, contentType };
}

export function validateCampaignImageUpload(input = {}) {
  const contentType = String(input.contentType || '').trim().toLowerCase();
  const size = Number(input.size);
  if (!imageTypes[contentType]) throw new Error('图片只支持 JPG、PNG 或 WebP');
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_EMAIL_IMAGE_BYTES) {
    throw new Error('图片不可超过 50 MB');
  }
  return { contentType, size };
}

export function campaignImageMatchesType(contentType, bytes) {
  return Boolean(imageTypes[contentType]?.(bytes));
}

export function decodeCampaignImageChunk(data) {
  const value = String(data || '');
  if (!value || value.length > Math.ceil(EMAIL_IMAGE_CHUNK_BYTES * 4 / 3) + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('图片分块格式不正确');
  }
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > EMAIL_IMAGE_CHUNK_BYTES) throw new Error('图片分块不可超过 2 MB');
  return bytes;
}

export function expectedCampaignImageChunks(size) {
  return Math.ceil(size / EMAIL_IMAGE_CHUNK_BYTES);
}

export function validEmailImageId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}
