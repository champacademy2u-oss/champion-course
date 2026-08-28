import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

await import("../whatsapp-bulk-core.js");

const {
  getBatch,
  inspectMessageEncoding,
  maskPhone,
  normalizeMalaysiaPhone,
  prepareAudience,
  validateImageFile,
  whatsappUrl,
} = globalThis.WhatsappBulkCore;

test("adds Malaysia country code to local mobile numbers", () => {
  assert.deepEqual(normalizeMalaysiaPhone("012-345 6789"), {
    original: "012-345 6789",
    phone: "60123456789",
    valid: true,
    changed: true,
    reason: "",
  });
  assert.equal(normalizeMalaysiaPhone("12 345 6789").phone, "60123456789");
});

test("keeps explicit international and existing Malaysia numbers", () => {
  assert.equal(normalizeMalaysiaPhone("+60123456789").phone, "60123456789");
  assert.equal(normalizeMalaysiaPhone("0060123456789").phone, "60123456789");
  assert.equal(normalizeMalaysiaPhone("+6591234567").phone, "6591234567");
});

test("rejects empty and invalid phone numbers", () => {
  assert.equal(normalizeMalaysiaPhone("").valid, false);
  assert.equal(normalizeMalaysiaPhone("123").valid, false);
});

test("deduplicates normalized numbers and reports excluded leads", () => {
  const leads = [
    { id: "a", name: "A", phone: "012-3456789" },
    { id: "b", name: "B", phone: "+60123456789" },
    { id: "c", name: "C", phone: "invalid" },
  ];
  const audience = prepareAudience(leads, (lead) => `Hi ${lead.name}`);

  assert.equal(audience.sendable.length, 1);
  assert.equal(audience.sendable[0].phone, "60123456789");
  assert.equal(audience.sendable[0].message, "Hi A");
  assert.deepEqual(audience.excluded.map((entry) => entry.reason), [
    "重复电话号码",
    "电话号码格式无效",
  ]);
});

test("returns safe batches of ten without skipping recipients", () => {
  const audience = Array.from({ length: 23 }, (_, index) => ({ id: index }));
  const first = getBatch(audience, 0, 10);
  const second = getBatch(audience, first.nextCursor, 10);
  const third = getBatch(audience, second.nextCursor, 10);

  assert.equal(first.items.length, 10);
  assert.equal(first.remaining, 13);
  assert.equal(second.items.length, 10);
  assert.equal(second.remaining, 3);
  assert.equal(third.items.length, 3);
  assert.equal(third.remaining, 0);
  assert.deepEqual([...first.items, ...second.items, ...third.items], audience);
});

test("masks preview numbers and builds an encoded WhatsApp URL", () => {
  assert.equal(maskPhone("60123456789"), "6012••••789");
  assert.equal(
    whatsappUrl("60123456789", "Hi 你好"),
    "https://wa.me/60123456789?text=Hi%20%E4%BD%A0%E5%A5%BD",
  );
});

test("preserves complete emoji sequences through the WhatsApp URL", () => {
  const message = "📣 今晚见 🔥\n✅ 系统化执行\n👨‍💼 加油 🚀";
  const url = whatsappUrl("60123456789", message);

  assert.equal(new URL(url).searchParams.get("text"), message);
  assert.deepEqual(inspectMessageEncoding(message), {
    message,
    valid: true,
    replacementCount: 0,
  });
});

test("detects replacement characters before they reach WhatsApp", () => {
  const status = inspectMessageEncoding("📣 标题�\n� 内容");
  assert.equal(status.valid, false);
  assert.equal(status.replacementCount, 2);
});

test("accepts supported WhatsApp images and rejects unsafe selections", () => {
  assert.deepEqual(validateImageFile({ type: "image/jpeg", size: 1024 }), {
    valid: true,
    reason: "",
  });
  assert.equal(validateImageFile({ type: "image/gif", size: 1024 }).valid, false);
  assert.equal(validateImageFile({ type: "image/png", size: 0 }).valid, false);
  assert.equal(validateImageFile({ type: "image/webp", size: 11 * 1024 * 1024 }).valid, false);
});

test("bulk preview exposes custom copy and local-image safety controls", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="bulkWhatsappMessageInput"/);
  assert.match(html, /id="bulkWhatsappImageInput"/);
  assert.match(html, /图片只在本机预览，不会上传或保存/);
  assert.match(html, /data-wa-emoji="📣"/);
  assert.match(html, /id="bulkWhatsappEncodingWarning"/);
  assert.match(app, /applyTemplate\(bulkWhatsappPreviewState\.template, lead\)/);
  assert.match(app, /!bulkWhatsappPreviewState\.imageFile \|\| bulkWhatsappPreviewState\.imageCopied/);
  assert.match(app, /inspectMessageEncoding\(bulkWhatsappPreviewState\.template\)/);
});
