import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let client;

function config() {
  const entries = [
    ['R2_ACCOUNT_ID', 'accountId'],
    ['R2_ACCESS_KEY_ID', 'accessKeyId'],
    ['R2_SECRET_ACCESS_KEY', 'secretAccessKey'],
    ['R2_BUCKET_NAME', 'bucketName']
  ];
  const values = Object.fromEntries(entries.map(([environmentName, key]) => [
    key,
    String(process.env[environmentName] || '').trim()
  ]));
  const missing = entries
    .filter(([, key]) => !values[key])
    .map(([environmentName]) => environmentName);
  if (missing.length) throw new Error(`Cloudflare R2 尚未配置：缺少 ${missing.join(', ')}`);
  return values;
}

function r2() {
  if (client) return client;
  const values = config();
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${values.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: values.accessKeyId,
      secretAccessKey: values.secretAccessKey
    }
  });
  return client;
}

async function createUploadUrl(objectKey, contentType) {
  const values = config();
  return getSignedUrl(r2(), new PutObjectCommand({
    Bucket: values.bucketName,
    Key: objectKey,
    ContentType: contentType
  }), { expiresIn: 30 * 60 });
}

async function createReadUrl(objectKey) {
  const values = config();
  return getSignedUrl(r2(), new GetObjectCommand({
    Bucket: values.bucketName,
    Key: objectKey,
    ResponseContentDisposition: 'inline'
  }), { expiresIn: 2 * 60 * 60 });
}

async function storedObjectExists(objectKey) {
  const values = config();
  try {
    await r2().send(new HeadObjectCommand({ Bucket: values.bucketName, Key: objectKey }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return false;
    throw error;
  }
}

async function deleteStoredObject(objectKey) {
  const values = config();
  await r2().send(new DeleteObjectCommand({ Bucket: values.bucketName, Key: objectKey }));
}

export {
  createReadUrl,
  createUploadUrl,
  deleteStoredObject,
  storedObjectExists
};
