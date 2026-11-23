import { db, firebaseApp, isSharedCrmAdmin, isSharedCrmIdentity } from './_firebase.js';
import { ReceiptError } from '../customer-receipts-core.js';
import { createReceiptHandler, receiptAdminAllowed } from '../lib/customer-receipts-api.js';

const receipts = () => db().collection('customer_receipts');
const counters = () => db().collection('customer_receipt_counters');
const numbers = () => db().collection('customer_receipt_numbers');
const repository = {
  async list(cursor) {
    let query = receipts().orderBy('__name__').limit(101);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get(), docs = snapshot.docs.slice(0, 100);
    return { receipts: docs.map(doc => doc.data()), cursor: snapshot.size > 100 ? docs.at(-1).id : '' };
  },
  async get(id) { return (await receipts().doc(id).get()).data(); },
  async transact(id, change) {
    return db().runTransaction(async transaction => {
      const ref = receipts().doc(id), snapshot = await transaction.get(ref);
      return change({
        current: snapshot.data(),
        counter: async year => (await transaction.get(counters().doc(year))).data() || { sequence: 0 },
        number: async key => (await transaction.get(numbers().doc(key))).data(),
        reserveNumber: (key, value) => transaction.create(numbers().doc(key), value),
        setCounter: (year, value) => transaction.set(counters().doc(year), value),
        put: value => transaction.set(ref, value)
      });
    });
  }
};
export default createReceiptHandler({
  repository,
  allowedOrigins: () => new Set(String(process.env.RECEIPT_ALLOWED_ORIGINS || process.env.EMAIL_ALLOWED_ORIGINS || 'https://champacademy2u-oss.github.io,https://champacademy.asia,https://www.champacademy.asia,http://localhost:4174,http://127.0.0.1:4174').split(',').map(value => value.trim()).filter(Boolean)),
  async authenticate(req) {
    const token = String(req.headers.authorization || '').match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw new ReceiptError('请先在 Mailbox 使用管理员账号登录。', 401);
    const uids = new Set(String(process.env.CRM_ADMIN_UIDS || '').split(',').map(value => value.trim()).filter(Boolean));
    const emails = new Set(String(process.env.CRM_ADMIN_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
    let decoded;
    try { decoded = await firebaseApp().auth().verifyIdToken(token, true); }
    catch { throw new ReceiptError('登录已失效，请重新登录管理员账号。', 401); }
    if (isSharedCrmAdmin(decoded)) return decoded.uid;
    if (isSharedCrmIdentity(decoded)) throw new ReceiptError('此账号没有客户收据管理权限。', 403);
    if (!uids.size && !emails.size) throw new ReceiptError('客户收据尚未设置管理员权限。', 503);
    if (!receiptAdminAllowed(decoded, uids, emails)) throw new ReceiptError('此账号没有客户收据管理权限。', 403);
    return decoded.uid;
  }
});
