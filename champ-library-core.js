// Shared validation for the private Champ material library (browser and API).
export const DEFAULT_CATEGORIES = Object.freeze([
  { id: 'course', name: '课程教材' },
  { id: 'marketing', name: '营销素材' },
  { id: 'brand', name: '品牌资料' },
  { id: 'event', name: '活动资料' },
  { id: 'internal', name: '内部文件' },
  { id: 'uncategorized', name: '未分类' }
]);
export const MAX_BATCH = 30;
export const MAX_VIDEO_BYTES = 1024 ** 3;
export const MAX_DOCUMENT_BYTES = 50 * 1024 ** 2;
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
  pdf: 'application/pdf', mp4: 'video/mp4', m4v: 'video/mp4',
  mov: 'video/quicktime', webm: 'video/webm'
};
export const ACCEPT = Object.keys(MIME).map(ext => `.${ext}`).join(',');
export function libraryError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
export function text(value, max = 160) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
export function validId(id) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(String(id || ''));
}
export function validateFile(input) {
  const fileName = text(input.name ?? input.fileName, 240);
  const ext = fileName.split('.').pop().toLowerCase();
  const mime = MIME[ext];
  const suppliedMime = String(input.type ?? input.mime ?? '').toLowerCase();
  if (!mime || !fileName.includes('.')) throw libraryError('支持视频、照片和 PDF；请检查文件格式。');
  const aliases = { 'image/jpg': 'image/jpeg', 'video/x-m4v': 'video/mp4', 'application/octet-stream': mime };
  if (suppliedMime && (aliases[suppliedMime] || suppliedMime) !== mime) throw libraryError('文件扩展名与格式不一致。');
  const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'pdf';
  const size = Number(input.size);
  const limit = kind === 'video' ? MAX_VIDEO_BYTES : MAX_DOCUMENT_BYTES;
  if (!Number.isSafeInteger(size) || size <= 0 || size > limit) throw libraryError(kind === 'video' ? '单个视频须为 1 B 至 1 GB。' : '单张照片或 PDF 须为 1 B 至 50 MB。');
  return { fileName, mime, kind, size };
}
export function matchesSignature(mime, bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (mime === 'application/pdf') return ascii(0, 5) === '%PDF-';
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png') return [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b);
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  if (mime === 'video/webm') return [26,69,223,163].every((b, i) => bytes[i] === b);
  if (mime === 'video/quicktime') return ['ftyp', 'moov', 'mdat', 'wide'].includes(ascii(4, 8));
  if (mime === 'video/mp4') return ascii(4, 8) === 'ftyp';
  if (['image/avif', 'image/heic', 'image/heif'].includes(mime)) {
    const brands = mime === 'image/avif' ? ['avif','avis'] : ['heic','heix','hevc','hevx','mif1','msf1'];
    return ascii(4, 8) === 'ftyp' && brands.some(brand => ascii(8, 64).includes(brand));
  }
  return false;
}
export async function inspectFile(file) {
  const metadata = validateFile(file);
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (!matchesSignature(metadata.mime, bytes)) throw libraryError('文件内容与格式不符，或文件已经损坏。');
  return metadata;
}
export function validateCategories(items) {
  if (!Array.isArray(items) || !items.length || items.length > 60) throw libraryError('分类须为 1 至 60 个。');
  const ids = new Set(), names = new Set();
  return items.map(item => {
    const name = text(item.name, 40), id = String(item.id || '');
    if (!validId(id) || !name || ids.has(id) || names.has(name.toLocaleLowerCase())) throw libraryError('分类名称不可为空或重复。');
    ids.add(id); names.add(name.toLocaleLowerCase());
    return { id, name };
  });
}
export function metadata(input, categories) {
  const title = text(input.title, 160);
  const categoryId = text(input.categoryId, 80) || 'uncategorized';
  if (!title) throw libraryError('请填写资料名称。');
  if (!categories.some(category => category.id === categoryId)) throw libraryError('分类已变化，请刷新后重试。', 409);
  const tags = [...new Set((Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(/[,，]/)).map(tag => text(tag, 30)).filter(Boolean))];
  if (tags.length > 12) throw libraryError('每份资料最多 12 个标签。');
  return { title, categoryId, tags, notes: text(input.notes, 2000) };
}
export function filterFiles(files, { category = 'all', kind = 'all', query = '', trash = false, sort = 'newest' } = {}) {
  const q = String(query).trim().toLocaleLowerCase();
  return files.filter(file => file.status === 'ready' && Boolean(file.trashedAt) === trash)
    .filter(file => category === 'all' || file.categoryId === category)
    .filter(file => kind === 'all' || file.kind === kind)
    .filter(file => !q || [file.title, file.fileName, file.notes, ...(file.tags || [])].join(' ').toLocaleLowerCase().includes(q))
    .sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'zh-Hans') : sort === 'size' ? b.size - a.size : String(b.createdAt).localeCompare(String(a.createdAt)));
}
export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
