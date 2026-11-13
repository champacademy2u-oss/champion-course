import crypto from 'node:crypto';
import { db, firebaseApp } from './_firebase.js';
import { createReadUrl, createUploadUrl, getStoredObject, headStoredObject } from './_r2.js';
import { createLibraryHandler, libraryAdminAllowed, publicFile } from '../lib/champ-library-api.js';
import { libraryError } from '../champ-library-core.js';

const collection = () => db().collection('champ_library_files');
const settings = () => db().collection('champ_library_settings').doc('categories');
const repository = {
  async settings() { return (await settings().get()).data(); },
  async list(cursor) {
    let query = collection().orderBy('__name__').limit(201);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, 200);
    return { files: docs.filter(doc => doc.data().status === 'ready').map(doc => publicFile(doc.data())), cursor: snapshot.size > 200 ? docs.at(-1).id : '' };
  },
  async get(id) { return (await collection().doc(id).get()).data(); },
  async create(file) { await collection().doc(file.id).create(file); },
  async mutate(id, change) {
    return db().runTransaction(async transaction => {
      const ref = collection().doc(id), snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw libraryError('找不到这份资料。', 404);
      const next = change(snapshot.data()); transaction.set(ref, next); return next;
    });
  },
  async mutateSettings(change) {
    return db().runTransaction(async transaction => {
      const ref = settings(), snapshot = await transaction.get(ref);
      const next = change(snapshot.data()); transaction.set(ref, next); return next;
    });
  }
};
export default createLibraryHandler({
  repository, uuid: crypto.randomUUID,
  allowedOrigins: () => new Set(String(process.env.CHAMP_LIBRARY_ALLOWED_ORIGINS || process.env.EMAIL_ALLOWED_ORIGINS || 'https://champacademy2u-oss.github.io,https://champacademy.asia,https://www.champacademy.asia,http://localhost:4174,http://127.0.0.1:4174').split(',').map(value => value.trim()).filter(Boolean)),
  async authenticate(req) {
    const token = String(req.headers.authorization || '').match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw libraryError('请先使用现有管理员账号登录。', 401);
    const allowed = new Set(String(process.env.CRM_ADMIN_UIDS || '').split(',').map(value => value.trim()).filter(Boolean));
    const allowedEmails = new Set(String(process.env.CRM_ADMIN_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
    if (!allowed.size && !allowedEmails.size) throw libraryError('云端资料库尚未设置管理员权限。', 503);
    let decoded;
    try { decoded = await firebaseApp().auth().verifyIdToken(token, true); }
    catch { throw libraryError('登录已失效，请重新登录管理员账号。', 401); }
    if (!libraryAdminAllowed(decoded, allowed, allowedEmails)) throw libraryError('此账号没有资料库管理权限。', 403);
  },
  objects: {
    uploadUrl: file => createUploadUrl(file.objectKey, file.mime, { size: file.size, expiresIn: 300 }),
    head: headStoredObject,
    async prefix(key) {
      const object = await getStoredObject(key, { range: 'bytes=0-63' });
      const chunks = []; let size = 0;
      try {
        for await (const chunk of object.Body) {
          size += chunk.length;
          if (size > 64) throw libraryError('云端格式检查失败，请重新上传。');
          chunks.push(chunk);
        }
      } finally { object.Body?.destroy?.(); }
      return Buffer.concat(chunks);
    },
    readUrl: (file, download) => createReadUrl(file.objectKey, {
      expiresIn: 600,
      disposition: `${download ? 'attachment' : 'inline'}; filename="champ-file.${file.fileName.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/'/g, '%27')}`
    })
  }
});
