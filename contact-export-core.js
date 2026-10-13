(function exposeContactExportCore(globalScope) {
  const UNASSIGNED_COURSE = "No Preview Course Assigned";
  const encoder = new TextEncoder();

  function escapeVcardText(value) {
    return String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .replaceAll("\\", "\\\\")
      .replaceAll("\n", "\\n")
      .replaceAll(";", "\\;")
      .replaceAll(",", "\\,");
  }

  function foldVcardLine(line) {
    const segments = [];
    let current = "";
    for (const character of line) {
      if (encoder.encode(current + character).length > 75) {
        segments.push(current);
        current = ` ${character}`;
      } else {
        current += character;
      }
    }
    segments.push(current);
    return segments.join("\r\n");
  }

  function dateStamp(date) {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function buildCourseVcard(leads, targetCourse, now = new Date()) {
    const courseLabel = String(targetCourse || UNASSIGNED_COURSE).trim();
    const group = leads.filter(lead => (lead.course || UNASSIGNED_COURSE) === targetCourse);
    const contacts = new Map();
    let invalidCount = 0;
    let duplicateCount = 0;
    for (const lead of group) {
      const result = globalScope.WhatsappBulkCore.normalizeMalaysiaPhone(lead.phone);
      if (!result.valid) {
        invalidCount += 1;
        continue;
      }
      const name = String(lead.name || "").trim();
      if (contacts.has(result.phone)) {
        duplicateCount += 1;
        const previous = contacts.get(result.phone);
        if (!previous.name && name) previous.name = name;
        continue;
      }
      contacts.set(result.phone, { name, phone: result.phone });
    }

    let reviewCount = 0;
    let unnamedCount = 0;
    const cards = Array.from(contacts.values(), contact => {
      const label = `${courseLabel}｜${contact.name || "未命名联系人"}`;
      let note = `Champ Academy · ${courseLabel}课程报名`;
      if (!contact.name) unnamedCount += 1;
      if (contact.phone.startsWith("601") && ![11, 12].includes(contact.phone.length)) {
        reviewCount += 1;
        note += "\n号码长度请核对；未猜测或修改原报名号码。";
      }
      return [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `N:;${escapeVcardText(label)};;;`,
        `FN:${escapeVcardText(label)}`,
        "ORG:Champ Academy",
        `TEL;TYPE=CELL:+${contact.phone}`,
        `CATEGORIES:${escapeVcardText(courseLabel)}`,
        `NOTE:${escapeVcardText(note)}`,
        `UID:champacademy-contact-${contact.phone}`,
        "END:VCARD",
      ].map(foldVcardLine).join("\r\n");
    });
    const safeName = Array.from(courseLabel.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
      .replace(/\s+/g, " ").replace(/[. ]+$/g, "")).slice(0, 60).join("") || "课程";
    return {
      content: cards.length ? `${cards.join("\r\n")}\r\n` : "",
      fileName: `${safeName}-通讯录-${dateStamp(now)}.vcf`,
      stats: {
        course: courseLabel,
        groupCount: group.length,
        contactCount: cards.length,
        invalidCount,
        duplicateCount,
        reviewCount,
        unnamedCount,
      },
    };
  }

  globalScope.ContactExportCore = Object.freeze({ buildCourseVcard });
})(typeof window !== "undefined" ? window : globalThis);

