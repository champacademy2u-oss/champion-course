import { COMPANY, displayDate, documentInfo, money } from './customer-receipts-core.js';

export const PAGE = Object.freeze({ width: 210, height: 297 });
const FONT = 'Arial, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const MM_PER_PT = 25.4 / 72;
export const xml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const fallbackMeasure = (text, size) => Array.from(text).reduce((width, letter) => width + (/[^\u0000-\u00ff]/u.test(letter) ? 1 : /[MW@]/.test(letter) ? 0.84 : /[il., :]/.test(letter) ? 0.29 : 0.57), 0) * size * MM_PER_PT;
export function wrap(text, width, size, measure = fallbackMeasure) {
  const lines = [];
  for (const paragraph of String(text || '').split('\n')) {
    let line = '';
    for (const character of paragraph) {
      if (line && measure(line + character, size) > width) { lines.push(line.trimEnd()); line = ''; }
      line += character;
    }
    lines.push(line.trimEnd());
  }
  return lines.length ? lines : [''];
}
export function receiptLayout(record, measure = fallbackMeasure) {
  const pages = [], company = record.company || COMPANY, info = documentInfo(record.type);
  let commands, y, tableTop;
  const text = (value, x, baseline, size = 10, options = {}) => commands.push({ type: 'text', text: String(value), x, y: baseline, size, ...options });
  const line = (x1, y1, x2, y2, width = 0.25) => commands.push({ type: 'line', x1, y1, x2, y2, width });
  const begin = continued => {
    commands = []; pages.push({ commands });
    commands.push({ type: 'logo', x: 16, y: 5, width: 47, height: 47, clip: { x: 16, y: 20, width: 47, height: 20 } });
    text(info.title, 194, 29, 20, { bold: true, align: 'right' });
    if (record.demo || record.status !== 'issued') text(record.demo ? '功能预览 · SAMPLE' : record.status === 'void' ? '作废 · VOID' : '草稿 · DRAFT', 194, 37, 9, { align: 'right', color: '#8b4b20' });
    text(`${company.name}  ${company.registration}`, 16, 51, 10, { bold: true });
    text(`Tel: ${company.phone}`, 16, 57, 9.5);
    text(`Email: ${company.email}`, 16, 62.5, 9.5);
    line(16, 69, 194, 69, 0.4);
    text('Bill to :', 16, 80, 10, { bold: true });
    const customer = wrap(record.customer, 102, 10, measure);
    customer.forEach((value, index) => text(value, 34, 80 + index * 5, 10));
    const details = wrap(record.customerDetails || '', 119, 9, measure).filter(Boolean);
    details.forEach((value, index) => text(value, 16, 85 + (customer.length - 1) * 5 + index * 4.3, 9));
    text('Date :', 144, 80, 9.5); text(displayDate(record.date), 194, 80, 9.5, { align: 'right' });
    text(info.numberLabel, 135, 88, 9.5);
    const numberLines = wrap(record.number || '签发时自动生成', 40, 9, measure);
    numberLines.forEach((value, index) => text(value, 194, 88 + index * 4.5, 9, { align: 'right', bold: true }));
    tableTop = Math.max(106, 89 + (customer.length - 1) * 5 + details.length * 4.3, 96 + (numberLines.length - 1) * 4.5);
    if (continued) text('Continued', 194, tableTop - 3, 8, { align: 'right', color: '#666666' });
    commands.push({ type: 'rect', x: 16, y: tableTop, width: 178, height: 10, fill: '#f1f1f1' });
    text('Description', 19, tableTop + 6.7, 10, { bold: true });
    text('Qty', 158, tableTop + 6.7, 10, { bold: true, align: 'center' });
    text('RM', 191, tableTop + 6.7, 10, { bold: true, align: 'right' });
    y = tableTop + 10;
  };
  const tableEnd = bottom => {
    for (const x of [16, 147, 169, 194]) line(x, tableTop, x, bottom);
    line(16, tableTop, 194, tableTop); line(16, tableTop + 10, 194, tableTop + 10); line(16, bottom, 194, bottom);
  };
  begin(false);
  for (const item of record.items) {
    const lines = wrap(item.description, 124, 9.5, measure); let offset = 0;
    while (offset < lines.length) {
      const available = Math.floor((233 - y - 5) / 4.8);
      if (available < 1) { tableEnd(y); begin(true); continue; }
      const fragment = lines.slice(offset, offset + available), height = Math.max(10, fragment.length * 4.8 + 5);
      fragment.forEach((value, index) => text(value, 19, y + 6.2 + index * 4.8, 9.5));
      if (offset === 0) {
        if (item.qty !== null) text(item.qty, 158, y + 6.2, 9.5, { align: 'center' });
        text(item.amountCents === null ? '-' : money(item.amountCents), 191, y + 6.2, 9.5, { align: 'right' });
      }
      offset += fragment.length; y += height;
      if (offset < lines.length) { tableEnd(y); begin(true); }
    }
  }
  const bottom = Math.max(y, Math.min(207, tableTop + 85)); tableEnd(bottom);
  const subtotal = bottom + 11;
  text('SUBTOTAL', 164, subtotal, 9.5, { align: 'right' }); text(money(record.totalCents), 191, subtotal, 9.5, { align: 'right' });
  line(132, subtotal + 4, 194, subtotal + 4);
  text('TOTAL', 164, subtotal + 12, 11, { bold: true, align: 'right' }); text(money(record.totalCents), 191, subtotal + 12, 11, { bold: true, align: 'right' });
  commands.push({ type: 'signature', x: 16, y: 247, width: 45, height: 17 });
  text('PREPARED BY:', 16, 269, 9.5, { bold: true });
  wrap(record.preparedBy || '', 116, 9.5, measure).forEach((value, index) => text(value, 44, 269 + index * 4.6, 9.5));
  for (const [index, page] of pages.entries()) {
    if (record.demo || record.status !== 'issued') page.commands.push({ type: 'watermark', text: record.demo ? 'SAMPLE / 示例' : record.status === 'void' ? 'VOID / 作废' : 'DRAFT / 草稿' });
    page.commands.push({ type: 'text', text: `${index + 1} / ${pages.length}`, x: 194, y: 286, size: 8, color: '#777777', align: 'right' });
  }
  return { ...PAGE, pages };
}
export function pageSvg(page, logoData, signatureData = '') {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297" role="img" aria-label="Champ Academy 收据预览"><rect width="210" height="297" fill="white"/>`];
  for (const item of page.commands) {
    if (item.type === 'text') parts.push(`<text x="${item.x}" y="${item.y}" font-family="${xml(FONT)}" font-size="${item.size * MM_PER_PT}" font-weight="${item.bold ? '700' : '400'}" text-anchor="${item.align === 'right' ? 'end' : item.align === 'center' ? 'middle' : 'start'}" fill="${item.color || '#111111'}">${xml(item.text)}</text>`);
    else if (item.type === 'line') parts.push(`<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" stroke="#202020" stroke-width="${item.width}"/>`);
    else if (item.type === 'rect') parts.push(`<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" fill="${item.fill}"/>`);
    else if (item.type === 'logo') parts.push(`<defs><clipPath id="receipt-logo-clip"><rect x="${item.clip.x}" y="${item.clip.y}" width="${item.clip.width}" height="${item.clip.height}"/></clipPath></defs><image href="${logoData}" x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" clip-path="url(#receipt-logo-clip)"/>`);
    else if (item.type === 'signature' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(signatureData)) parts.push(`<image href="${signatureData}" x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" preserveAspectRatio="xMinYMid meet"/>`);
    else if (item.type === 'watermark') parts.push(`<text x="105" y="163" text-anchor="middle" transform="rotate(-32 105 155)" font-family="${xml(FONT)}" font-size="22" font-weight="700" fill="#8b4b20" opacity="0.12">${xml(item.text)}</text>`);
  }
  return parts.join('') + '</svg>';
}
export async function receiptPdf(record, { logoData, signatureData = '', jsPDF, createCanvas = () => document.createElement('canvas'), createImage = () => new Image() }) {
  if (!jsPDF) throw new Error('PDF 工具尚未载入，请刷新网页后重试。');
  await document.fonts?.ready;
  const image = createImage();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('公司 Logo 未能载入，未生成收据。')); image.src = logoData; });
  let signature;
  if (signatureData) {
    if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(signatureData)) throw new Error('请使用 PNG、JPG 或 WebP 格式的原签名图片。');
    signature = createImage();
    await new Promise((resolve, reject) => { signature.onload = resolve; signature.onerror = () => reject(new Error('金色签名未能载入，请重新选择原图。')); signature.src = signatureData; });
  }
  const scale = 6, canvas = createCanvas(); canvas.width = PAGE.width * scale; canvas.height = PAGE.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法生成收据，请使用支持 Canvas 的浏览器。');
  const measure = (value, size) => { ctx.font = `${size * MM_PER_PT * scale}px ${FONT}`; return ctx.measureText(value).width / scale; };
  const layout = receiptLayout(record, measure), pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  for (const [index, page] of layout.pages.entries()) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.scale(scale, scale);
    for (const item of page.commands) {
      ctx.save(); ctx.fillStyle = item.color || '#111111'; ctx.strokeStyle = '#202020';
      if (item.type === 'text') { ctx.font = `${item.bold ? '700 ' : ''}${item.size * MM_PER_PT}px ${FONT}`; ctx.textAlign = item.align || 'left'; ctx.fillText(item.text, item.x, item.y); }
      else if (item.type === 'line') { ctx.lineWidth = item.width; ctx.beginPath(); ctx.moveTo(item.x1, item.y1); ctx.lineTo(item.x2, item.y2); ctx.stroke(); }
      else if (item.type === 'rect') { ctx.fillStyle = item.fill; ctx.fillRect(item.x, item.y, item.width, item.height); }
      else if (item.type === 'logo') { ctx.beginPath(); ctx.rect(item.clip.x, item.clip.y, item.clip.width, item.clip.height); ctx.clip(); ctx.drawImage(image, item.x, item.y, item.width, item.height); }
      else if (item.type === 'signature' && signature) {
        const ratio = signature.naturalWidth / signature.naturalHeight;
        const width = Math.min(item.width, item.height * ratio), height = width / ratio;
        ctx.drawImage(signature, item.x, item.y + (item.height - height) / 2, width, height);
      }
      else if (item.type === 'watermark') { ctx.globalAlpha = 0.12; ctx.fillStyle = '#8b4b20'; ctx.translate(105, 155); ctx.rotate(-32 * Math.PI / 180); ctx.font = `700 22px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(item.text, 0, 8); }
      ctx.restore();
    }
    if (index) pdf.addPage('a4', 'portrait');
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', 0, 0, PAGE.width, PAGE.height, undefined, 'FAST');
  }
  pdf.setProperties({ title: `${record.status === 'draft' ? 'DRAFT ' : record.status === 'void' ? 'VOID ' : ''}${record.number || documentInfo(record.type).label}`, author: COMPANY.brand, subject: documentInfo(record.type).label });
  return pdf;
}
