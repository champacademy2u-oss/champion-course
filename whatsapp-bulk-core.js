(function exposeWhatsappBulkCore(globalScope) {
  const E164_PATTERN = /^[1-9]\d{7,14}$/;
  const WHATSAPP_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const DEFAULT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

  function normalizeMalaysiaPhone(value) {
    const original = String(value || "").trim();
    if (!original) {
      return { original, phone: "", valid: false, changed: false, reason: "缺少电话号码" };
    }

    const explicitInternational = original.startsWith("+") || original.startsWith("00");
    let digits = original.replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);

    let phone = digits;
    if (digits.startsWith("60")) {
      phone = digits;
    } else if (digits.startsWith("0")) {
      phone = `60${digits.slice(1)}`;
    } else if (!explicitInternational && /^1\d{8,9}$/.test(digits)) {
      phone = `60${digits}`;
    }

    const valid = E164_PATTERN.test(phone);
    return {
      original,
      phone: valid ? phone : "",
      valid,
      changed: valid && phone !== digits,
      reason: valid ? "" : "电话号码格式无效",
    };
  }

  function maskPhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length <= 7) return digits || "—";
    return `${digits.slice(0, 4)}••••${digits.slice(-3)}`;
  }

  function inspectMessageEncoding(value) {
    const message = String(value ?? "").replace(/\r\n?/g, "\n").normalize("NFC");
    const replacementCount = (message.match(/\uFFFD/g) || []).length;
    return {
      message,
      valid: replacementCount === 0,
      replacementCount,
    };
  }

  function whatsappUrl(phone, message) {
    if (!E164_PATTERN.test(String(phone || ""))) return "";
    const normalizedMessage = inspectMessageEncoding(message).message;
    return `https://wa.me/${phone}?text=${encodeURIComponent(normalizedMessage)}`;
  }

  function validateImageFile(file, maxBytes = DEFAULT_IMAGE_MAX_BYTES) {
    if (!file) return { valid: false, reason: "请先选择图片" };
    if (!WHATSAPP_IMAGE_TYPES.has(String(file.type || "").toLowerCase())) {
      return { valid: false, reason: "只支持 JPG、PNG 或 WebP 图片" };
    }

    const size = Number(file.size) || 0;
    if (!size) return { valid: false, reason: "图片文件为空" };
    if (size > maxBytes) return { valid: false, reason: "图片请勿超过 10 MB" };
    return { valid: true, reason: "" };
  }

  function prepareAudience(leads, messageForLead) {
    const seenPhones = new Set();
    const sendable = [];
    const excluded = [];

    (Array.isArray(leads) ? leads : []).forEach((lead) => {
      const normalized = normalizeMalaysiaPhone(lead?.phone);
      if (!normalized.valid) {
        excluded.push({ lead, reason: normalized.reason });
        return;
      }
      if (seenPhones.has(normalized.phone)) {
        excluded.push({ lead, reason: "重复电话号码" });
        return;
      }

      seenPhones.add(normalized.phone);
      const message = inspectMessageEncoding(
        typeof messageForLead === "function" ? messageForLead(lead) : "",
      ).message;
      sendable.push({
        lead,
        phone: normalized.phone,
        maskedPhone: maskPhone(normalized.phone),
        normalized: normalized.changed,
        message,
        url: whatsappUrl(normalized.phone, message),
      });
    });

    return { sendable, excluded };
  }

  function getBatch(audience, cursor = 0, batchSize = 10) {
    const safeAudience = Array.isArray(audience) ? audience : [];
    const safeCursor = Math.max(0, Number(cursor) || 0);
    const safeSize = Math.max(1, Number(batchSize) || 10);
    const items = safeAudience.slice(safeCursor, safeCursor + safeSize);
    const nextCursor = safeCursor + items.length;
    return {
      items,
      nextCursor,
      remaining: Math.max(0, safeAudience.length - nextCursor),
      batchNumber: Math.floor(safeCursor / safeSize) + 1,
    };
  }

  globalScope.WhatsappBulkCore = Object.freeze({
    getBatch,
    inspectMessageEncoding,
    maskPhone,
    normalizeMalaysiaPhone,
    prepareAudience,
    validateImageFile,
    whatsappUrl,
  });
})(globalThis);
