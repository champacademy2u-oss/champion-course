import { db } from './_firebase.js';
import { cleanText, verifyUnsubscribeToken } from '../lib/email-campaign-core.js';

function renderPage(res, status, title, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(`<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#f3f5f7;color:#18212b;font-family:Arial,sans-serif"><main style="max-width:560px;margin:80px auto;padding:24px"><section style="background:#fff;border:1px solid #e6e9ed;border-radius:14px;padding:34px"><h1 style="margin:0 0 14px;font-size:24px">${title}</h1><p style="margin:0;line-height:1.7;color:#4b5563">${message}</p></section></main></body></html>`);
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return renderPage(res, 405, '无法处理', '这个链接只支持 Email 退订操作。');
  const url = new URL(req.url, 'https://local');
  if (url.searchParams.get('preview') === '1') {
    return renderPage(res, 200, '测试邮件预览', '这是测试邮件中的退订链接，不会修改任何客户资料。');
  }
  try {
    const token = cleanText(url.searchParams.get('token'), 4000);
    const { campaignId, recipientId } = verifyUnsubscribeToken(token, process.env.EMAIL_UNSUBSCRIBE_SECRET);
    const recipientRef = db().collection('email_campaigns').doc(campaignId).collection('recipients').doc(recipientId);
    const recipientSnap = await recipientRef.get();
    if (!recipientSnap.exists || !recipientSnap.get('emailHash')) throw new Error('退订记录不存在');
    const timestamp = new Date().toISOString();
    const batch = db().batch();
    batch.set(db().collection('email_suppressions').doc(recipientSnap.get('emailHash')), {
      reason: 'unsubscribed',
      createdAt: timestamp,
      updatedAt: timestamp
    }, { merge: true });
    batch.set(recipientRef, {
      status: 'unsubscribed',
      unsubscribedAt: recipientSnap.get('unsubscribedAt') || timestamp,
      updatedAt: timestamp
    }, { merge: true });
    await batch.commit();
    return renderPage(res, 200, '已取消订阅', '您不会再收到 Champion Academy 未来的 Email Campaign。');
  } catch {
    return renderPage(res, 400, '链接无效', '这个退订链接无效或已经无法使用，请直接联络 Champion Academy。');
  }
}
