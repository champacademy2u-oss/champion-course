import assert from 'node:assert/strict';
import test from 'node:test';

test('R2 signed URLs target the configured bucket and expire', async () => {
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.R2_BUCKET_NAME = 'champion-test-videos';

  const { createReadUrl, createUploadUrl } = await import('../api/_r2.js');
  const uploadUrl = new URL(await createUploadUrl('videos/example/test.mp4', 'video/mp4'));
  const readUrl = new URL(await createReadUrl('videos/example/test.mp4'));

  assert.equal(uploadUrl.host, 'champion-test-videos.test-account.r2.cloudflarestorage.com');
  assert.equal(uploadUrl.pathname, '/videos/example/test.mp4');
  assert.equal(uploadUrl.searchParams.get('X-Amz-Expires'), '1800');
  assert.ok(uploadUrl.searchParams.get('X-Amz-Signature'));
  assert.equal(readUrl.searchParams.get('X-Amz-Expires'), '7200');
  assert.ok(readUrl.searchParams.get('X-Amz-Signature'));

  const libraryUpload = new URL(await createUploadUrl('champ-library/test-file', 'application/pdf', { size: 512, expiresIn: 300 }));
  const disposition = "attachment; filename=champ-file.pdf; filename*=UTF-8''%E8%AF%BE%E7%A8%8B.pdf";
  const libraryDownload = new URL(await createReadUrl('champ-library/test-file', { expiresIn: 600, disposition }));
  assert.equal(libraryUpload.searchParams.get('X-Amz-Expires'), '300');
  assert.match(libraryUpload.searchParams.get('X-Amz-SignedHeaders'), /content-length/);
  assert.equal(libraryDownload.searchParams.get('X-Amz-Expires'), '600');
  assert.equal(libraryDownload.searchParams.get('response-content-disposition'), disposition);
});
