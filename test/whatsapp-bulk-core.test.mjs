import test from "node:test";
import assert from "node:assert/strict";

await import("../whatsapp-bulk-core.js");

const {
  getBatch,
  maskPhone,
  normalizeMalaysiaPhone,
  prepareAudience,
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
