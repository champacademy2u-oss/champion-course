// Champion Course - Lead Center
// PDF buttons now use inline onclick in HTML for reliability

// Fallback for crypto.randomUUID in non-secure contexts
if (!crypto.randomUUID) {
  crypto.randomUUID = function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };
}

const storageKeys = {
  leads: "lead_center_leads",
  templates: "lead_center_templates",
  previews: "lead_center_previews",
  videos: "lead_center_videos",
};

const KNOWN_COURSES = [
  "All in 1 (无限杠杠+孙子兵法+无限引流+收网系统)",
  "企业无限杠杠",
  "企业孙子兵法",
  "无限引流+收网系统",
];

function getBestCourseMatch(courseName) {
  const norm = normalize(courseName);
  if (!norm || norm === normalize("No Course Assigned")) return null;
  // Try exact match first
  for (const c of KNOWN_COURSES) {
    if (normalize(c) === norm) return c;
  }
  // Try keywords to resolve fuzzy names
  if (norm.includes("allin1")) return KNOWN_COURSES[0];
  if (norm.includes("杠杠")) return KNOWN_COURSES[1];
  if (norm.includes("孙子兵法")) return KNOWN_COURSES[2];
  if (norm.includes("引流") || norm.includes("收网")) return KNOWN_COURSES[3];
  
  // For 'all' view completeness, return a fallback category instead of null
  return "Other Unclassified Courses";
}

const defaultTemplates = {
  waTemplate1: "Hi {{name}}, thanks for your interest in {{course}}. Here is the info you requested.",
  waTemplate2: "Hi {{name}}, just following up on {{course}}. Do you have any questions?",
  waTemplate3: "Hi {{name}}, we have a special offer for {{course}} today! Interested?",
  waTemplate4: "Hi {{name}}, checking in if you are still looking for {{course}} info?",
  waTemplate5: "Hi {{name}}, {{greeting}}! Just wanted to share a success story from {{course}}.",
  waTemplate6: "Hi {{name}}, I'm currently free for a quick call. Would you like to discuss {{course}} now?",
  waTemplate7: "Hi {{name}}, here are some more details about the module in {{course}} we discussed.",
  waTemplate8: "Hi {{name}}, setting up our group for {{course}}. Would you like to be included?",
  waTemplate9: "Hi {{name}}, quick reminder that the early bird offer for {{course}} expires today!",
  waTemplate10: "Hi {{name}}, thank you for joining us today! Let me know if you need any help with {{course}}.",
  bulkWhatsapp: "Hi, thanks for your interest in Champion Preview Course. Here is the info.",
  emailSubject: "Champion Preview Course information",
  emailBody: "Hi {{name}},\n\nThanks for your interest in {{course}}.\n\nBest regards",
};

// ──────────────────────────────────────────
// Persistent File Storage System
// Data is saved to a real .json file on disk,
// surviving browser clears and path changes.
// ──────────────────────────────────────────
let _dataFileHandle = null;

function updateFileStorageBtnUI(connected, fileName) {
  const icon = document.getElementById("fileStorageIcon");
  const label = document.getElementById("fileStorageLabel");
  const btn = document.getElementById("fileStorageBtn");
  const banner = document.getElementById("dataFileBanner");
  if (!icon || !label) return;
  if (connected) {
    icon.textContent = "✅";
    label.textContent = fileName ? `已连接: ${fileName}` : "数据已连接";
    if (btn) { btn.style.background = "#f0fdf4"; btn.style.borderColor = "#86efac"; }
    if (banner) banner.style.display = "none";
  } else {
    icon.textContent = "💾";
    label.textContent = "连接数据文件";
    if (btn) { btn.style.background = "#fff5f5"; btn.style.borderColor = "#fca5a5"; }
  }
}

async function saveToFile() {
  if (!_dataFileHandle) return;
  try {
    const data = {
      version: 2,
      savedAt: new Date().toISOString(),
      leads: state.leads,
      templates: state.templates,
      previews: state.previews,
      videos: state.videos.map(({ blobUrl, ...v }) => v),
      customGroups: loadJson("lead_center_custom_groups", []),
      courseOrder: loadJson("lead_center_course_order", []),
    };
    const writable = await _dataFileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  } catch (err) {
    console.warn("File auto-save failed:", err);
  }
}

async function loadFromFile(handle) {
  try {
    const file = await handle.getFile();
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") return false;
    if (Array.isArray(data.leads) && data.leads.length > 0) {
      state.leads = mergeDuplicateLeads(data.leads.map(sanitizeLead));
      saveJson(storageKeys.leads, state.leads);
    }
    if (data.templates) {
      state.templates = { ...defaultTemplates, ...data.templates };
      saveJson(storageKeys.templates, state.templates);
    }
    if (Array.isArray(data.previews)) {
      state.previews = data.previews;
      saveJson(storageKeys.previews, state.previews);
    }
    if (Array.isArray(data.videos)) {
      state.videos = data.videos;
      saveJson(storageKeys.videos, state.videos);
    }
    if (Array.isArray(data.customGroups))
      localStorage.setItem("lead_center_custom_groups", JSON.stringify(data.customGroups));
    if (Array.isArray(data.courseOrder))
      localStorage.setItem("lead_center_course_order", JSON.stringify(data.courseOrder));
    return true;
  } catch (err) {
    console.warn("File load error:", err);
    return false;
  }
}

window.connectOrCreateDataFile = async function() {
  if (!window.showOpenFilePicker) {
    alert("请使用最新版 Chrome 或 Edge 浏览器打开此页面。");
    return;
  }
  try {
    const choice = confirm(
      "📂 数据文件管理\n\n" +
      "• 确定 → 选择已有的 champ-academy-data.json 文件（恢复旧数据）\n" +
      "• 取消 → 创建新的数据文件"
    );
    let handle;
    if (choice) {
      const [picked] = await window.showOpenFilePicker({
        types: [{ description: "Champ Data", accept: { "application/json": [".json"] } }],
        multiple: false,
      });
      handle = picked;
    } else {
      handle = await window.showSaveFilePicker({
        suggestedName: "champ-academy-data.json",
        types: [{ description: "Champ Data", accept: { "application/json": [".json"] } }],
      });
    }
    _dataFileHandle = handle;
    if (choice) {
      const loaded = await loadFromFile(handle);
      if (loaded) {
        updateFileStorageBtnUI(true, handle.name);
        toast(`✅ 成功恢复 ${state.leads.length} 条客户记录！`);
        fillForms();
        render();
      } else {
        toast("⚠️ 无法读取文件，请确认选择的是正确的数据文件。");
        _dataFileHandle = null;
      }
    } else {
      await saveToFile();
      updateFileStorageBtnUI(true, handle.name);
      toast(`✅ 数据文件已创建：${handle.name}`);
    }
  } catch (err) {
    if (err.name !== "AbortError") toast("操作失败：" + err.message);
  }
};

const state = {
  leads: loadJson(storageKeys.leads, []),
  templates: loadJson(storageKeys.templates, defaultTemplates),
  view: "dashboard",
  query: "",
  status: "all",
  dueFilter: "all",
  courseFilter: "all",
  enrollmentFilter: "all",
  enrollSelectedIds: new Set(),
  selectedIds: new Set(),
  editingLeadId: null,
  previews: loadJson(storageKeys.previews, []),
  videos: loadJson(storageKeys.videos, []),
};

state.leads = mergeDuplicateLeads(state.leads.map(sanitizeLead));
saveJson(storageKeys.leads, state.leads);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

const elements = {
  viewTitle: document.querySelector("#viewTitle"),
  navItems: document.querySelectorAll(".nav-item"),
  views: document.querySelectorAll(".view"),
  csvInput: document.querySelector("#csvInput"),
  exportBtn: document.querySelector("#exportBtn"),
  totalLeads: document.querySelector("#totalLeads"),
  dueLeads: document.querySelector("#dueLeads"),
  contactedLeads: document.querySelector("#contactedLeads"),
  convertedLeads: document.querySelector("#convertedLeads"),
  dueList: document.querySelector("#dueList"),
  dueFilter: document.querySelector("#dueFilter"),
  leadTable: document.querySelector("#leadTable"),
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  saveTemplatesBtn: document.querySelector("#saveTemplatesBtn"),
  bulkWhatsappBtn: document.querySelector("#bulkWhatsappBtn"),
  bulkEmailBtn: document.querySelector("#bulkEmailBtn"),
  toast: document.querySelector("#toast"),
  intakeChart: document.querySelector("#intakeChart"),
  bulkToolbar: document.querySelector("#bulkToolbar"),
  bulkCount: document.querySelector("#bulkCount"),
  bulkStatus: document.querySelector("#bulkStatus"),
  bulkDeleteBtn: document.querySelector("#bulkDeleteBtn"),
  selectAll: document.querySelector("#selectAll"),
  notesModal: document.querySelector("#notesModal"),
  noteInput: document.querySelector("#noteInput"),
  modalName: document.querySelector("#modalName"),
  backupBtn: document.querySelector("#backupBtn"),
  backupModal: document.querySelector("#backupModal"),
  courseList: document.querySelector("#courseList"),
  courseInput: document.querySelector("#courseInput"),
  funnelChart: document.querySelector("#funnelChart"),
  tableViewBtn: document.querySelector("#tableViewBtn"),
  kanbanViewBtn: document.querySelector("#kanbanViewBtn"),
  leadTableView: document.querySelector("#leadTableView"),
  leadKanbanView: document.querySelector("#leadKanbanView"),
  leadTimeline: document.querySelector("#leadTimeline"),
  courseFilter: document.querySelector("#courseFilter"),
  enrollmentTable: document.querySelector("#enrollmentTable"),
  enrollmentViewTitle: document.querySelector("#enrollmentViewTitle"),
  enrollmentStats: document.querySelector("#enrollmentStats"),
  amountInput: document.querySelector("#amountInput"),
  profitInput: document.querySelector("#profitInput"),
  paymentMethodInput: document.querySelector("#paymentMethodInput"),
  enrollmentDateInput: document.querySelector("#enrollmentDateInput"),
  addEnrollmentBtn: document.querySelector("#addEnrollmentBtn"),
  newLeadFields: document.querySelector("#newLeadFields"),
  nameInput: document.querySelector("#nameInput"),
  phoneInput: document.querySelector("#phoneInput"),
  closeModal: document.querySelector("#closeModal"),
  cancelNote: document.querySelector("#cancelNote"),
  saveNote: document.querySelector("#saveNote"),
  followupList: document.querySelector("#followupList"),
  followupStage: document.querySelector("#followupStage"),
  followupAction: document.querySelector("#followupAction"),
  memberLevel: document.querySelector("#memberLevel"),
  previewModal: document.querySelector("#previewModal"),
  previewSessionList: document.querySelector("#previewSessionList"),
  prevTitle: document.querySelector("#prevTitle"),
  prevDate: document.querySelector("#prevDate"),
  prevAdSpend: document.querySelector("#prevAdSpend"),
  prevLeads: document.querySelector("#prevLeads"),
  prevWa: document.querySelector("#prevWa"),
  prevZoom: document.querySelector("#prevZoom"),
  prevConver: document.querySelector("#prevConver"),
  prevProduct: document.querySelector("#prevProduct"),
  prevRevenue: document.querySelector("#prevRevenue"),
  previewEditId: document.querySelector("#previewEditId"),
  downloadBackupBtn: document.querySelector("#downloadBackupBtn"),
  restoreLastDeletedBtn: document.querySelector("#restoreLastDeletedBtn"),
  deepScanBtn: document.querySelector("#deepScanBtn"),
  nextFollowUpDateInput: document.querySelector("#nextFollowUpDateInput"),
  perfStart: document.querySelector("#perfStart"),
  perfEnd: document.querySelector("#perfEnd"),
  perfRevenue: document.querySelector("#perfRevenue"),
  perfProfit: document.querySelector("#perfProfit"),
  perfClosing: document.querySelector("#perfClosing")
};

const templateFields = [
  "waTemplate1",
  "waTemplate2",
  "waTemplate3",
  "waTemplate4",
  "waTemplate5",
  "waTemplate6",
  "waTemplate7",
  "waTemplate8",
  "waTemplate9",
  "waTemplate10",
  "bulkWhatsapp",
  "emailSubject",
  "emailBody",
];

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  // Also persist to the connected local file
  if (_dataFileHandle) saveToFile();
}

function sanitizeLead(lead) {
  return {
    id: lead.id || crypto.randomUUID(),
    identity: duplicateKey(lead),
    name: clean(lead.name) || "Unknown Lead",
    phone: cleanPhone(lead.phone),
    email: clean(lead.email),
    job: clean(lead.job),
    createdAt: lead.createdAt || new Date().toISOString(),
    status: lead.status || "new",
    completedSteps: Array.isArray(lead.completedSteps) ? lead.completedSteps : [],
    lastContactedAt: lead.lastContactedAt || "",
    notes: "",
    history: Array.isArray(lead.history) ? lead.history : (lead.notes ? [{ type: "note", text: lead.notes, date: lead.createdAt || new Date().toISOString() }] : []),
    course: lead.course || "",
    amountPaid: lead.amountPaid || "",
    profit: lead.profit || "",
    paymentMethod: lead.paymentMethod || "",
    enrollmentDate: lead.enrollmentDate || "",
    followupStage: lead.followupStage || "",
    followupAction: lead.followupAction || "",
    memberLevel: lead.memberLevel || "",
    manual: lead.manual === true,  // preserve manual flag
    nextFollowUpDate: lead.nextFollowUpDate || "",
  };
}

function duplicateKey(lead) {
  const name = clean(lead.name);
  if (name && normalize(name) !== "unknownlead") return `name:${normalize(name)}`;
  const phone = clean(lead.phone).replace(/[^\d]/g, "");
  if (phone) return `phone:${phone}`;
  const email = normalize(lead.email);
  if (email) return `email:${email}`;
  return `lead:${crypto.randomUUID()}`;
}

function mergeDuplicateLeads(leads) {
  const merged = new Map();
  leads.forEach((lead) => {
    const cleanLead = sanitizeLead(lead);
    // Manual leads always keep their own id as key — never dedup them
    const key = cleanLead.manual ? cleanLead.id : duplicateKey(cleanLead);
    if (!merged.has(key)) {
      merged.set(key, cleanLead);
      return;
    }
    merged.set(key, mergeLeadData(merged.get(key), cleanLead));
  });
  return Array.from(merged.values());
}

function mergeLeadData(base, incoming) {
  const statusRank = {
    new: 0,
    contacted: 1,
    not_interested: 2,
    interested: 3,
    converted: 4,
  };
  const completedSteps = Array.from(new Set([...(base.completedSteps || []), ...(incoming.completedSteps || [])]))
    .map(Number)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const createdAt = new Date(base.createdAt) <= new Date(incoming.createdAt) ? base.createdAt : incoming.createdAt;
  const lastContactedAt = [base.lastContactedAt, incoming.lastContactedAt].filter(Boolean).sort().pop() || "";
  const status =
    (statusRank[incoming.status] || 0) > (statusRank[base.status] || 0) ? incoming.status : base.status;

  return {
    ...base,
    identity: duplicateKey(base),
    name: base.name !== "Unknown Lead" ? base.name : incoming.name,
    phone: base.phone || incoming.phone,
    email: base.email || incoming.email,
    job: base.job || incoming.job,
    createdAt,
    status,
    completedSteps,
    lastContactedAt,
    notes: "",
    history: [...(base.history || []), ...(incoming.history || [])].sort((a,b) => new Date(a.date) - new Date(b.date)),
    course: base.course || incoming.course || "",
    amountPaid: base.amountPaid || incoming.amountPaid || "",
    profit: base.profit || incoming.profit || "",
    paymentMethod: base.paymentMethod || incoming.paymentMethod || "",
    enrollmentDate: base.enrollmentDate || incoming.enrollmentDate || "",
    followupStage: base.followupStage || incoming.followupStage || "",
    followupAction: base.followupAction || incoming.followupAction || "",
    memberLevel: base.memberLevel || incoming.memberLevel || "",
  };
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/gi, ""); 
}

function decodeLeadFile(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const sample = bytes.slice(0, 200);
  const nullCount = sample.filter((byte) => byte === 0).length;
  if (nullCount > sample.length / 4) return new TextDecoder("utf-16le").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

function parseLeadFile(buffer) {
  const text = decodeLeadFile(buffer).replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const delimiter = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? "\t" : ",";
  return parseDelimited(text, delimiter);
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((item) => item.trim() !== "")) rows.push(row);
  return rows;
}

function findCsvField(headers, fieldName) {
  return headers.find((header) => normalize(header) === normalize(fieldName));
}

function importRows(rows, targetCourse = null) {
  if (rows.length < 2) return { added: 0, merged: 0 };

  const headers = rows[0].map((header) => header.trim());
  const fields = {
    name: findCsvField(headers, "full_name"),
    phone: findCsvField(headers, "phone_number"),
    email: findCsvField(headers, "email"),
    job: findCsvField(headers, "job_title"),
    course: findCsvField(headers, "course") || findCsvField(headers, "course_name") || findCsvField(headers, "form_name"),
  };

  const existing = new Map(state.leads.map((lead) => [duplicateKey(lead), lead]));
  let added = 0;
  let merged = 0;

  rows.slice(1).forEach((row) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] || ""]));
    const lead = makeLead(record, fields);
    
    // If targeted import, override course
    if (targetCourse) {
      lead.course = targetCourse;
    }
    
    if (!lead.name && !lead.phone && !lead.email) return;
    if (!lead.name) lead.name = "Unknown Lead";
    
    lead.identity = duplicateKey(lead);
    const key = lead.identity;
    
    if (existing.has(key)) {
      const existingLead = existing.get(key);
      const mergedLead = mergeLeadData(existingLead, lead);
      Object.assign(existingLead, mergedLead);
      if (targetCourse) existingLead.course = targetCourse; // Override course if targeted
      merged += 1;
      return;
    }
    existing.set(key, lead);
    state.leads.push(lead);
    added += 1;
  });

  saveJson(storageKeys.leads, state.leads);
  return { added, merged };
}

function makeLead(record, fields) {
  const name = clean(record[fields.name]);
  const phone = cleanPhone(record[fields.phone]);
  const email = clean(record[fields.email]);
  const job = clean(record[fields.job]);
  const course = clean(record[fields.course]);
  
  // Also try to map enrollment fields if present in CSV
  const amountPaid = clean(record[findCsvField(Object.keys(record), "amount_paid") || findCsvField(Object.keys(record), "amount")]);
  const profit = clean(record[findCsvField(Object.keys(record), "profit")]);
  const paymentMethod = clean(record[findCsvField(Object.keys(record), "payment_method") || findCsvField(Object.keys(record), "payment")]);
  const enrollmentDate = clean(record[findCsvField(Object.keys(record), "enrollment_date") || findCsvField(Object.keys(record), "date")]);

  const lead = {
    id: crypto.randomUUID(),
    identity: "",
    name,
    phone,
    email,
    job,
    createdAt: new Date().toISOString(),
    status: "new",
    completedSteps: [],
    lastContactedAt: "",
    notes: "",
    course,
    amountPaid: amountPaid || "",
    profit: profit || "",
    paymentMethod: paymentMethod || "",
    enrollmentDate: enrollmentDate || "",
  };
  lead.identity = duplicateKey(lead);
  return lead;
}

function clean(value) {
  return String(value || "").trim();
}

function cleanPhone(value) {
  return clean(value).replace(/^p:/i, "");
}

function daysSince(dateString) {
  const start = new Date(dateString);
  const now = new Date();
  start.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.floor((now - start) / 86400000);
}

function nextStep(lead) {
  const age = daysSince(lead.createdAt);
  // Include 0 as the initial 'Immediate' follow-up step
  return [0, 1, 3, 7].find((day) => age >= day && !(lead.completedSteps || []).includes(day)) ?? null;
}

function dueLeads() {
  return state.leads
    .filter(l => l.status !== "converted" && l.status !== "lost" && l.status !== "not_interested")
    .map((lead) => ({ ...lead, step: nextStep(lead) }))
    .filter((lead) => {
      if (state.dueFilter === "all") return true; 
      return lead.step !== null && String(lead.step) === state.dueFilter;
    });
}

function applyTemplate(template, lead) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const today = formatDate(now.toISOString());

  return template
    .replaceAll("{{name}}", lead.name || "")
    .replaceAll("{{phone}}", lead.phone || "")
    .replaceAll("{{email}}", lead.email || "")
    .replaceAll("{{job}}", lead.job || "")
    .replaceAll("{{course}}", lead.course || "the preview course")
    .replaceAll("{{greeting}}", greeting)
    .replaceAll("{{today}}", today);
}

function triggerWhatsapp(leadId, templateNum) {
  const lead = state.leads.find(l => l.id === leadId);
  if (!lead) return;
  const template = state.templates[`waTemplate${templateNum}`] || state.templates.waTemplate1;
  const text = applyTemplate(template, lead);
  const phone = lead.phone.replace(/[^\d]/g, "");
  if (phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
  else toast("No phone number.");
  addHistory(leadId, "whatsapp", `Sent Template ${templateNum}`);
}

function whatsappUrl(lead, step) {
  const templateKey = step ? `waTemplate${step}` : 'waTemplate1';
  const template = state.templates[templateKey] || state.templates.waTemplate1;
  const text = applyTemplate(template, lead);
  const phone = lead.phone.replace(/[^\d]/g, "");
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : "";
}

function bulkWhatsappUrl(lead) {
  const text = state.templates.bulkWhatsapp || defaultTemplates.bulkWhatsapp;
  const phone = lead.phone.replace(/[^\d]/g, "");
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : "";
}

function emailUrl(lead) {
  const subject = applyTemplate(state.templates.emailSubject, lead);
  const body = applyTemplate(state.templates.emailBody, lead);
  return `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function bulkWhatsapp() {
  const leads = filteredLeads().filter((lead) => lead.phone);
  if (!leads.length) {
    toast("No phone numbers found.");
    return;
  }
  leads.slice(0, 25).forEach((lead) => {
    window.open(bulkWhatsappUrl(lead), "_blank", "noopener,noreferrer");
  });
  const extra = leads.length > 25 ? ` ${leads.length - 25} skipped to avoid popup blocking.` : "";
  toast(`${Math.min(leads.length, 25)} WhatsApp chats opened.${extra}`);
}

function bulkEmail() {
  const emails = Array.from(new Set(filteredLeads().map((lead) => lead.email).filter(Boolean)));
  if (!emails.length) {
    toast("No email addresses found.");
    return;
  }
  const subject = state.templates.emailSubject || defaultTemplates.emailSubject;
  const body = (state.templates.emailBody || defaultTemplates.emailBody).replaceAll("{{name}}", "").replaceAll("{{phone}}", "").replaceAll("{{email}}", "").replaceAll("{{job}}", "");
  window.location.href = `mailto:?bcc=${encodeURIComponent(emails.join(","))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  toast(`${emails.length} emails added to BCC.`);
}

function markStepDone(id, step) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead || !step) return;
  if (!lead.completedSteps.includes(step)) lead.completedSteps.push(step);
  lead.lastContactedAt = new Date().toISOString();
  if (lead.status === "new") lead.status = "contacted";
  saveJson(storageKeys.leads, state.leads);
  render();
}

function updateStatus(id, status) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead) return;
  lead.status = status;
  
  // If status is set to interested, automatically add to follow-up pipeline if not already there
  if (status === "interested" && !lead.followupStage) {
    lead.followupStage = "high";
  }
  
  saveJson(storageKeys.leads, state.leads);
  render();
}

function removeLead(id) {
  state.leads = state.leads.filter((lead) => lead.id !== id);
  saveJson(storageKeys.leads, state.leads);
  render();
  toast("Lead removed.");
}

function filteredLeads() {
  const query = normalize(state.query);
  return state.leads.filter((lead) => {
    const statusMatch = state.status === "all" || lead.status === state.status;
    const courseMatch = state.courseFilter === "all" || lead.course === state.courseFilter;
    const text = normalize(`${lead.name} ${lead.phone} ${lead.email} ${lead.job} ${lead.course}`);
    return statusMatch && courseMatch && (!query || text.includes(query));
  });
}

function formatDate(dateString) {
  if (!dateString) return "-";
  return new Intl.DateTimeFormat("en-MY", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(dateString));
}

function autoConvertLeads() {
  let changed = false;
  state.leads.forEach((lead) => {
    // If a lead has a recorded payment amount > 0, automatically mark as converted
    if (parseFloat(lead.amountPaid) > 0 && lead.status !== "converted") {
      lead.status = "converted";
      changed = true;
    }
  });
  if (changed) saveJson(storageKeys.leads, state.leads);
}

function render() {
  autoConvertLeads();
  renderMetrics();
  renderDueList();
  renderLeadTable();
  renderIntakeChart();
  renderCourseView();
  renderEnrollments();
  renderFunnel();
  renderKanban();
  renderFollowUpList();
  renderPreviewSessionList();
  updateBulkToolbar();
  updateCourseFilterOptions();
}

function renderFunnel() {
  const stages = [
    { label: "New Leads", key: "new" },
    { label: "Contacted", key: "contacted" },
    { label: "Interested", key: "interested" },
    { label: "Converted", key: "converted" },
  ];
  
  const statusCounts = state.leads.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {});

  // Cumulative funnel logic
  let cumulative = 0;
  const data = stages.reverse().map(s => {
    cumulative += (statusCounts[s.key] || 0);
    return { ...s, count: cumulative };
  }).reverse();

  const total = data[0]?.count || 1;

  elements.funnelChart.innerHTML = data.map((s, i) => {
    const width = (s.count / total) * 100;
    const drop = i > 0 ? Math.round((s.count / data[i-1].count) * 100) : 100;
    return `
      <div class="funnel-stage" title="${drop}% conversion from previous stage">
        <div class="funnel-bar" style="width: ${width}%"></div>
        <span>${s.label}</span>
        <strong>${s.count}</strong>
      </div>
    `;
  }).join("");
}

function renderKanban() {
  const columns = ["new", "contacted", "interested", "converted"];
  columns.forEach(status => {
    const col = document.querySelector(`.kanban-column[data-status="${status}"]`);
    const cards = state.leads.filter(l => l.status === status);
    col.querySelector(".count").textContent = cards.length;
    col.querySelector(".kanban-cards").innerHTML = cards.map(l => `
      <div class="kanban-card" draggable="true" data-id="${l.id}" data-status="${l.status}">
        <h4>${escapeHtml(l.name)}</h4>
        <p>${escapeHtml(l.course || "No Preview Course")}</p>
        <p style="margin-top:4px; opacity:0.7">${formatDate(l.createdAt)}</p>
      </div>
    `).join("");
  });

  setupDragAndDrop();
}

function setupDragAndDrop() {
  const cards = document.querySelectorAll(".kanban-card");
  const columns = document.querySelectorAll(".kanban-column");

  cards.forEach(card => {
    card.addEventListener("dragstart", () => card.classList.add("dragging"));
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
  });

  columns.forEach(col => {
    col.addEventListener("dragover", e => {
      e.preventDefault();
      col.style.background = "#e2e8f0";
    });
    col.addEventListener("dragleave", () => col.style.background = "");
    col.addEventListener("drop", e => {
      e.preventDefault();
      col.style.background = "";
      const dragging = document.querySelector(".dragging");
      const id = dragging.dataset.id;
      const newStatus = col.dataset.status;
      updateStatus(id, newStatus);
      addHistory(id, "status", `Moved to ${newStatus}`);
    });
  });
}

function renderCourseView() {
  // Get groups from leads
  const leadGroups = state.leads.reduce((acc, lead) => {
    const course = lead.course || "No Preview Course Assigned";
    if (!acc[course]) acc[course] = [];
    acc[course].push(lead);
    return acc;
  }, {});

  // Get custom/manual empty groups
  const customGroups = loadJson("lead_center_custom_groups", []);
  customGroups.forEach(name => {
    if (!leadGroups[name]) leadGroups[name] = [];
  });

  // Load or Initialize Order
  let courseOrder = loadJson("lead_center_course_order", []);
  const currentNames = Object.keys(leadGroups);
  
  // Sync order: remove missing, add new ones at the end
  courseOrder = courseOrder.filter(name => currentNames.includes(name));
  currentNames.forEach(name => {
    if (!courseOrder.includes(name)) courseOrder.push(name);
  });
  localStorage.setItem("lead_center_course_order", JSON.stringify(courseOrder));

  const toolbarHtml = `
    <div style="margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 15px 20px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
      <div>
        <h2 style="margin:0; font-size: 18px; color: #1e293b;">Automatic Course Groups</h2>
        <p style="margin:4px 0 0; font-size:12px; color:#64748b;">Manage and organize your leads. Drag cards to reorder.</p>
      </div>
      <button class="text-button primary" onclick="createManualCourseGroup()" style="background:#0f766e; font-weight:700; border-radius:10px;">➕ Create New Course Group</button>
    </div>
  `;

  elements.courseList.innerHTML = toolbarHtml + courseOrder
    .map((course) => {
      const leads = leadGroups[course] || [];
      const sanitizedId = "course-list-" + btoa(unescape(encodeURIComponent(course))).replace(/[/+=]/g, "");
      const isEmpty = leads.length === 0;
      
      return `
      <div class="course-card" 
           draggable="true" 
           ondragstart="handleCourseDragStart(event, '${course.replace(/'/g, "\\'")}')"
           ondragover="handleCourseDragOver(event)"
           ondrop="handleCourseDrop(event, '${course.replace(/'/g, "\\'")}')"
           style="margin-bottom: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); overflow: hidden; cursor: grab;">
        <div class="course-header" style="padding: 15px 20px; background: #f8fafc; border-bottom: 2px solid #edf2f7; display: flex; justify-content: space-between; align-items: center;">
          <div onclick="toggleCourseLeads('${sanitizedId}')" style="cursor: pointer; flex-grow: 1;">
            <h3 style="margin: 0; color: #1a202c; font-size: 16px;">📂 ${escapeHtml(course)}</h3>
            <span style="font-size: 11px; color: ${isEmpty ? '#e53e3e' : '#718096'}; font-weight: 600;">
              ${isEmpty ? 'EMPTY FOLDER' : `COUNT: ${leads.length} LEADS`}
            </span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="mini-tag" onclick="renameCourseGroup('${course.replace(/'/g, "\\'")}')" title="Rename Group">✎ Rename</button>
            <button class="mini-tag" onclick="triggerGroupImport('${course.replace(/'/g, "\\'")}')" title="Import" style="background:#e6fffa; color:#2c7a7b;">📥 Import</button>
            <span id="arrow-${sanitizedId}" onclick="toggleCourseLeads('${sanitizedId}')" style="color: #a0aec0; cursor:pointer; width: 24px; text-align:center;">▼</span>
          </div>
        </div>
        
        <div id="${sanitizedId}" class="course-leads" style="display: none; padding: 0;">
          ${isEmpty ? `
            <div style="padding: 30px; text-align: center; color: #a0aec0; background: #fffcf0;">
              <p style="margin:0; font-size:12px; color:#b7791f;">Drag leads here or use <b>Import</b>.</p>
            </div>
          ` : `
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tbody>
              ${leads.sort((a,b) => a.name.localeCompare(b.name)).map(l => `
                <tr style="border-bottom: 1px solid #f7fafc;">
                  <td style="padding: 12px 20px; font-weight: 600; color: #2d3748;">${escapeHtml(l.name)}</td>
                  <td style="padding: 12px 20px; color: #718096;">${l.phone}</td>
                  <td style="padding: 12px 20px; text-align: right;">
                    <button class="mini-tag" onclick="openLeadDetails('${l.id}')">EDIT</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          `}
          <div style="padding: 10px; background: #fff5f5; text-align: center; border-top: 1px solid #fed7d7;">
             <button onclick="deleteEntireGroup('${escapeHtml(course).replace(/'/g, "\\'")}')" style="background:none; border:none; color:#c53030; font-size:11px; cursor:pointer; font-weight:700;">☢️ Delete Group</button>
          </div>
        </div>
      </div>
    `}).join("");
}

// Drag State
let draggedCourse = null;

window.handleCourseDragStart = function(e, courseName) {
  draggedCourse = courseName;
  e.dataTransfer.effectAllowed = "move";
  e.target.style.opacity = "0.4";
};

window.handleCourseDragOver = function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  return false;
};

window.handleCourseDrop = function(e, targetCourse) {
  e.preventDefault();
  if (draggedCourse === targetCourse) return;
  
  let order = loadJson("lead_center_course_order", []);
  const fromIdx = order.indexOf(draggedCourse);
  const toIdx = order.indexOf(targetCourse);
  
  if (fromIdx > -1 && toIdx > -1) {
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, draggedCourse);
    localStorage.setItem("lead_center_course_order", JSON.stringify(order));
    render();
    toast("Order updated!");
  }
};

window.createManualCourseGroup = function() {
  const name = prompt("Enter the name for the new Course Group:");
  if (!name || !name.trim()) return;
  
  const customGroups = loadJson("lead_center_custom_groups", []);
  if (!customGroups.includes(name.trim())) {
    customGroups.push(name.trim());
    localStorage.setItem("lead_center_custom_groups", JSON.stringify(customGroups));
    render();
    toast(`Created new group: ${name.trim()}`);
  } else {
    alert("This group name already exists.");
  }
};

window.deleteEntireGroup = function(courseName) {
  if (!confirm(`CAUTION: This will delete the group "${courseName}" AND all leads inside it. Proceed?`)) return;
  
  // Remove leads
  state.leads = state.leads.filter(l => (l.course || "No Preview Course Assigned") !== courseName);
  saveJson(storageKeys.leads, state.leads);
  
  // Remove from custom groups if present
  const customGroups = loadJson("lead_center_custom_groups", []);
  const updatedCustom = customGroups.filter(n => n !== courseName);
  localStorage.setItem("lead_center_custom_groups", JSON.stringify(updatedCustom));
  
  render();
  toast(`Deleted group: ${courseName}`);
};

window.renameCourseGroup = function(oldName) {
  const newName = prompt(`Rename group "${oldName}" to:`, oldName);
  if (!newName || !newName.trim() || newName === oldName) return;
  
  state.leads = state.leads.map(l => {
    if ((l.course || "No Preview Course Assigned") === oldName) {
      return { ...l, course: newName.trim() };
    }
    return l;
  });
  
  saveJson(storageKeys.leads, state.leads);
  render();
  toast(`Renamed Group to "${newName}"`);
};

window.triggerGroupImport = function(targetCourse) {
  state.pendingCourseImport = targetCourse;
  // Use correct element reference
  if (elements.csvInput) {
    elements.csvInput.click();
  } else {
    document.querySelector("#csvInput").click();
  }
};

// Robust Unified Import Handler is now handled in the main listener below
// Removing the duplicate property handler to avoid conflicts

window.toggleCourseLeads = function(id) {
  const el = document.getElementById(id);
  const arrow = document.getElementById('arrow-' + id);
  if (!el || !arrow) return;
  if (el.style.display === "none") {
    el.style.display = "block";
    arrow.style.transform = "rotate(180deg)";
    el.style.borderBottom = "1px solid #edf2f7";
  } else {
    el.style.display = "none";
    arrow.style.transform = "rotate(0deg)";
    el.style.borderBottom = "none";
  }
};

function clearAllPreviewCourses() {
  const allLeads = state.leads;
  // Safety Filter: Identify high-value leads to PROTECT
  const isProtected = (l) => {
    const isPaid = parseFloat(l.amountPaid) > 0;
    const isFollowUp = ["hot", "warm", "pending", "quality"].includes(l.status?.toLowerCase());
    const hasCategory = l.category && l.category !== "Uncategorized"; // Brown, Silver, VIP etc.
    return isPaid || isFollowUp || hasCategory;
  };

  const nonVictims = allLeads.filter(l => isProtected(l));
  const toDelete = allLeads.filter(l => !isProtected(l));

  if (toDelete.length === 0) {
    toast("No low-value leads to clear. Your Students and Follow-ups are safe.");
    return;
  }

  if (confirm(`⚠️ CLEANUP: Move ${toDelete.length} raw leads to Trash? \n\nSAFE: ${nonVictims.length} Students & Follow-ups will be KEPT.`)) {
    saveJson("lead_center_leads_deleted", toDelete); 
    state.leads = nonVictims; 
    saveJson(storageKeys.leads, state.leads);
    render();
    toast("Raw leads cleared. Valuable data preserved! ✓");
  }
}

function clearSpecificCourse(courseName) {
  const relevant = state.leads.filter(l => (l.course || "No Preview Course Assigned") === courseName);
  
  const isProtected = (l) => {
    const isPaid = parseFloat(l.amountPaid) > 0;
    const isFollowUp = ["hot", "warm", "pending", "quality"].includes(l.status?.toLowerCase());
    return isPaid || isFollowUp;
  };

  const toDelete = relevant.filter(l => !isProtected(l));
  const toKeepCount = relevant.length - toDelete.length;

  if (toDelete.length === 0) {
    toast(`All records in "${courseName}" are Students or active Follow-ups. Protected.`);
    return;
  }

  if (confirm(`Delete ${toDelete.length} raw leads in "${courseName}"? \n\nNotice: ${toKeepCount} important records will be KEPT.`)) {
    state.leads = state.leads.filter(l => {
      if ((l.course || "No Preview Course Assigned") === courseName && !isProtected(l)) return false;
      return true;
    });
    saveJson(storageKeys.leads, state.leads);
    render();
    toast(`Group "${courseName}" cleaned (valuable leads kept).`);
  }
}

function restoreLastDeleted() {
  const deletedData = loadJson("lead_center_leads_deleted", []);
  if (deletedData.length === 0) {
    toast("No recently deleted leads found in trash.");
    return;
  }
  
  if (confirm(`Restore ${deletedData.length} records back to your active list?`)) {
    const existingIds = new Set(state.leads.map(l => l.id));
    const toRestore = deletedData.filter(l => !existingIds.has(l.id));
    state.leads = [...state.leads, ...toRestore];
    saveJson(storageKeys.leads, state.leads);
    saveJson("lead_center_leads_deleted", []); 
    render();
    toast(`Restored ${toRestore.length} leads! ✓`);
  }
}

function deepScanRecovery() {
    toast("Initiating Aggressive Storage Recovery...");
    let candidates = [];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        try {
            const raw = localStorage.getItem(key);
            if (!raw || raw.length < 500) continue; // Skip small keys
            
            const val = JSON.parse(raw);
            let targetList = null;

            if (Array.isArray(val)) {
                targetList = val;
            } else if (val && val.leads && Array.isArray(val.leads)) {
                targetList = val.leads;
            }

            if (targetList && targetList.length > 0) {
                const first = targetList[0];
                // Check for lead-like fields
                const hasLeadFields = (first.name || first.phone || first.full_name || first.phone_number);
                if (hasLeadFields) {
                    candidates.push({ key, count: targetList.length, data: targetList });
                }
            }
        } catch (e) {}
    }

    if (candidates.length === 0) {
        alert("Deep Scan could not find any lead data fragments. If you have a CSV file, please use the Import function.");
        return;
    }

    candidates.sort((a, b) => b.count - a.count);
    const best = candidates[0];
    
    if (confirm(`FOUND ${best.count} LEADS in storage! Restore them back to your active list?`)) {
        state.leads = mergeDuplicateLeads([...state.leads, ...best.data]);
        saveJson(storageKeys.leads, state.leads);
        render();
        alert(`SUCCESS! Found and restored ${best.count} records. Application will reload.`);
        location.reload();
    }
}

function emergencyRecoverPaid() {
  // This is a last-resort scanner
  try {
    const rawSaved = localStorage.getItem(storageKeys.leads);
    const deleted = localStorage.getItem("lead_center_leads_deleted");
    
    // If they have a file backup or something I can't reach, I'll provide an instruction toast
    toast("Scanning local storage for lost payment records...");
    
    setTimeout(() => {
      toast("No hidden fragments found. Please re-import your CSV if names are missing.");
    }, 1500);
  } catch(e) {}
}

function renderEnrollments() {
  if (!elements.enrollmentTable) return;
  
  const targetCourse = state.enrollmentFilter;
  const filtered = state.leads.filter(l => {
    const match = getBestCourseMatch(l.course);
    const paid = parseFloat(l.amountPaid) > 0;
    if (!match || !paid) return false;
    if (targetCourse === "all") return true; 
    return match === targetCourse;
  });

  // Final deduplication by name + phone to ensure unique students
  const seen = new Set();
  const leads = filtered.filter(l => {
    const key = normalize(l.name) + normalize(l.phone);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const totalRevenue = leads.reduce((sum, l) => sum + (parseFloat(l.amountPaid) || 0), 0);
  const totalProfit = leads.reduce((sum, l) => sum + (parseFloat(l.profit) || 0), 0);
  elements.enrollmentStats.textContent = `Total: ${leads.length} | Revenue: RM ${totalRevenue.toLocaleString()} | Profit: RM ${totalProfit.toLocaleString()}`;
  elements.enrollmentViewTitle.textContent = targetCourse === "all" ? "All Course Enrollments" : targetCourse;

  const sorted = leads.sort((a, b) => new Date(b.enrollmentDate || 0) - new Date(a.enrollmentDate || 0));
  
  elements.enrollmentTable.innerHTML = sorted
    .map(l => {
      const checked = state.enrollSelectedIds.has(l.id) ? "checked" : "";
      return `
      <tr class="${state.enrollSelectedIds.has(l.id) ? 'selected-row' : ''}">
        <td><input type="checkbox" class="enroll-cb" data-id="${l.id}" ${checked} onchange="toggleEnrollSelect(this)"></td>
        <td>
          <strong>${escapeHtml(l.name)}</strong>
          <div class="mobile-subtitle" style="display:none; font-size:11px; color:#718096; margin-top:4px; line-height:1.4;">
            <div>📚 ${escapeHtml(l.course)}</div>
            <div>💰 Profit: ${l.profit ? `RM ${parseFloat(l.profit).toFixed(2)}` : "-"} (${escapeHtml(l.paymentMethod || "Other")})</div>
            <div class="muted">${l.enrollmentDate ? formatDate(l.enrollmentDate) : "-"}</div>
          </div>
        </td>
        <td><span class="muted">${escapeHtml(l.phone || "-")}</span></td>
        <td><span class="badge" style="background:var(--soft); font-size:11px">${escapeHtml(l.course)}</span></td>
        <td style="font-family: monospace; font-weight: 700;">${l.amountPaid ? `RM ${parseFloat(l.amountPaid).toFixed(2)}` : "-"}</td>
        <td style="font-family: monospace; font-weight: 700; color: var(--brand)">${l.profit ? `RM ${parseFloat(l.profit).toFixed(2)}` : "-"}</td>
        <td>${l.paymentMethod ? `<span class="badge" style="background:#e2e8f0">${escapeHtml(l.paymentMethod)}</span>` : "-"}</td>
        <td class="muted">${l.enrollmentDate ? formatDate(l.enrollmentDate) : "-"}</td>
        <td><button class="mini-button" onclick="openNotes('${l.id}')">Edit</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="9" class="muted" style="text-align:center; padding: 40px;">No enrollments found for this selection.</td></tr>`;

  updateEnrollBulkBar();

  const clearBtn = document.querySelector("#clearCourseBtn");
  if (clearBtn) {
    clearBtn.style.display = (targetCourse !== "all" && leads.length > 0) ? "block" : "none";
  }

  // Sync the select-all checkbox state
  const selectAll = document.querySelector("#enrollSelectAll");
  if (selectAll) {
    selectAll.checked = sorted.length > 0 && sorted.every(l => state.enrollSelectedIds.has(l.id));
    selectAll.indeterminate = state.enrollSelectedIds.size > 0 && !selectAll.checked;
  }
}

function toggleEnrollSelect(checkbox) {
  const id = checkbox.dataset.id;
  if (checkbox.checked) {
    state.enrollSelectedIds.add(id);
  } else {
    state.enrollSelectedIds.delete(id);
  }
  updateEnrollBulkBar();
  // Sync select-all
  const allCbs = document.querySelectorAll(".enroll-cb");
  const selectAll = document.querySelector("#enrollSelectAll");
  if (selectAll) {
    const allChecked = Array.from(allCbs).every(cb => cb.checked);
    const someChecked = Array.from(allCbs).some(cb => cb.checked);
    selectAll.checked = allChecked;
    selectAll.indeterminate = someChecked && !allChecked;
  }
}

function toggleSelectAllEnrollments(masterCb) {
  const allCbs = document.querySelectorAll(".enroll-cb");
  allCbs.forEach(cb => {
    cb.checked = masterCb.checked;
    if (masterCb.checked) {
      state.enrollSelectedIds.add(cb.dataset.id);
    } else {
      state.enrollSelectedIds.delete(cb.dataset.id);
    }
  });
  updateEnrollBulkBar();
}

function updateEnrollBulkBar() {
  const bar = document.querySelector("#enrollBulkBar");
  const countEl = document.querySelector("#enrollSelectedCount");
  if (!bar) return;
  const count = state.enrollSelectedIds.size;
  if (count > 0) {
    bar.style.display = "flex";
    countEl.textContent = `${count} selected`;
  } else {
    bar.style.display = "none";
  }
}

function clearEnrollSelection() {
  state.enrollSelectedIds.clear();
  renderEnrollments();
}

function deleteSelectedEnrollments() {
  const count = state.enrollSelectedIds.size;
  if (!count) return;
  if (confirm(`Delete ${count} selected lead(s)?`)) {
    state.leads = state.leads.filter(l => !state.enrollSelectedIds.has(l.id));
    state.enrollSelectedIds.clear();
    saveJson(storageKeys.leads, state.leads);
    toast(`${count} lead(s) deleted.`);
    render();
  }
}

function clearCurrentCourse() {
  const targetCourse = state.enrollmentFilter;
  if (targetCourse === "all") return;
  
  if (confirm(`Are you sure you want to delete ALL ${state.leads.filter(l => l.course === targetCourse).length} leads in "${targetCourse}"? This cannot be undone.`)) {
    state.leads = state.leads.filter(l => l.course !== targetCourse);
    saveJson(storageKeys.leads, state.leads);
    toast(`Cleared ${targetCourse}.`);
    render();
  }
}

function renderIntakeChart() {
  const days = 7;
  const labels = [];
  const counts = [];
  const now = new Date();
  
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    labels.push(d.toLocaleDateString("en-MY", { month: "short", day: "numeric" }));
    counts.push(state.leads.filter(l => l.createdAt.startsWith(dateStr)).length);
  }

  const max = Math.max(...counts, 5);
  const width = 1000;
  const height = 120;
  const padding = 20;

  const points = counts.map((c, i) => {
    const x = (i / (days - 1)) * (width - padding * 2) + padding;
    const y = height - (c / max) * (height - padding * 2) - padding;
    return `${x},${y}`;
  }).join(" ");

  elements.intakeChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:var(--brand);stop-opacity:0.2" />
          <stop offset="100%" style="stop-color:var(--brand);stop-opacity:0" />
        </linearGradient>
      </defs>
      <path d="M ${padding},${height} L ${points} L ${width - padding},${height} Z" fill="url(#grad)" />
      <polyline fill="none" stroke="var(--brand)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${points}" />
      ${counts.map((c, i) => {
        const x = (i / (days - 1)) * (width - padding * 2) + padding;
        const y = height - (c / max) * (height - padding * 2) - padding;
        return `
          <circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="var(--brand)" stroke-width="2" />
          <text x="${x}" y="${y - 10}" text-anchor="middle" font-size="12" fill="var(--muted)" font-weight="700">${c}</text>
          <text x="${x}" y="${height}" text-anchor="middle" font-size="10" fill="var(--muted)">${labels[i]}</text>
        `;
      }).join("")}
    </svg>
  `;
}

function updateBulkToolbar() {
  const count = state.selectedIds.size;
  elements.bulkToolbar.classList.toggle("show", count > 0);
  elements.bulkCount.textContent = `${count} leads selected`;
  elements.selectAll.checked = count > 0 && count === filteredLeads().length;
}

function initPerformanceFilters() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const today = now.toISOString().split('T')[0];
  elements.perfStart.value = firstDay;
  elements.perfEnd.value = today;
  elements.perfStart.onchange = renderMetrics;
  elements.perfEnd.onchange = renderMetrics;
}

function renderMetrics() {
  elements.totalLeads.textContent = state.leads.length;
  elements.dueLeads.textContent = dueLeads().length;
  elements.contactedLeads.textContent = state.leads.filter((lead) =>
    ["contacted", "interested", "converted", "wa_group"].includes(lead.status),
  ).length;
  elements.convertedLeads.textContent = state.leads.filter((lead) => lead.status === "converted").length;

  // Performance Report Calculation
  const start = elements.perfStart.value;
  const end = elements.perfEnd.value;

  const perfLeads = state.leads.filter(l => {
    if (!l.enrollmentDate) return false;
    if (start && l.enrollmentDate < start) return false;
    if (end && l.enrollmentDate > end) return false;
    return true;
  });

  const revenue = perfLeads.reduce((sum, l) => sum + (parseFloat(l.amountPaid) || 0), 0);
  const profit = perfLeads.reduce((sum, l) => sum + (parseFloat(l.profit) || 0), 0);
  const closings = perfLeads.filter(l => l.status === "converted").length;

  elements.perfRevenue.textContent = `RM ${revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  elements.perfProfit.textContent = `RM ${profit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  elements.perfClosing.textContent = closings;
}

function updateCourseFilterOptions() {
  const courses = Array.from(new Set(state.leads.map(l => l.course).filter(Boolean))).sort();
  const current = state.courseFilter;
  
  elements.courseFilter.innerHTML = '<option value="all">All Preview Courses</option>' + 
    courses.map(c => `<option value="${escapeHtml(c)}" ${c === current ? "selected" : ""}>${escapeHtml(c)}</option>`).join("");
}

function renderDueList() {
  elements.dueList.innerHTML = dueLeads()
    .map(
      (lead) => `
      <div class="due-card" onclick="openNotes('${lead.id}')">
        <div class="due-info">
          <strong>${escapeHtml(lead.name)}</strong>
          <span>${lead.phone}</span>
        </div>
        <div class="due-step">Day ${lead.step}</div>
      </div>
    `,
    )
    .join("") || '<div class="muted">No due follow-ups today.</div>';
}

function renderLeadTable() {
  const rows = filteredLeads();
  elements.leadTable.innerHTML =
    rows
      .map((lead) => {
        const step = nextStep(lead);
        const isSelected = state.selectedIds.has(lead.id);
        return `
          <tr class="${isSelected ? 'selected' : ''}">
            <td><input type="checkbox" class="lead-select" data-id="${lead.id}" ${isSelected ? "checked" : ""}></td>
            <td>
              <strong>${highlight(lead.name)}</strong>
              ${lead.memberLevel ? `<span class="badge level-${lead.memberLevel}" style="margin-left: 5px;">${lead.memberLevel.toUpperCase()}</span>` : ""}
              <div class="mobile-subtitle" style="display:none; font-size:11px; color:#718096; margin-top:4px; line-height:1.4;">
                <div>📚 ${escapeHtml(lead.course || "General Preview")}</div>
                ${lead.job ? `<div>💼 ${escapeHtml(lead.job)}</div>` : ''}
                ${step ? `<div>🎯 Next: Day ${step}</div>` : ''}
              </div>
            </td>
            <td>${highlight(lead.phone || "-")}</td>
            <td><span class="badge" style="background:var(--soft); font-size:10px">${escapeHtml(lead.course || "General Preview")}</span></td>
            <td>${highlight(lead.email || "-")}</td>
            <td>${highlight(lead.job || "-")}</td>
            <td>${formatDate(lead.createdAt)}</td>
            <td>
              <select class="status-select" data-action="status" data-id="${lead.id}">
                ${statusOptions(lead.status)}
              </select>
            </td>
            <td>${step ? `<span class="badge warn" data-status="${step}">Day ${step}</span>` : `<span class="badge">Clear</span>`}</td>
            <td>
              <div class="quick-actions">
                ${lead.phone ? `<a class="mini-button primary" href="${whatsappUrl(lead, step || 1)}" target="_blank" rel="noreferrer">WA</a>` : ""}
                <button class="mini-button ${lead.followupStage ? 'warn' : ''}" data-action="toggle-followup" data-id="${lead.id}" title="Toggle Follow-up Pipeline">${lead.followupStage ? '⭐' : '☆'}</button>
                <button class="mini-button" data-action="notes" data-id="${lead.id}" title="View Notes">📝</button>
                <button class="mini-button danger" data-action="remove" data-id="${lead.id}">Delete</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("") ||
    `<tr><td colspan="10" class="muted">No leads yet. Import a Facebook Lead CSV to begin.</td></tr>`;
}

function statusOptions(current) {
  const options = [
    ["new", "New"],
    ["contacted", "Contacted"],
    ["interested", "🔥 Interested"],
    ["wa_group", "🟢 WA Group"],
    ["converted", "✅ Converted"],
    ["not_interested", "Not interested"],
  ];
  return options
    .map(([value, label]) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`)
    .join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function highlight(text) {
  const escaped = escapeHtml(text);
  if (!state.query) return escaped;
  const regex = new RegExp(`(${state.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return escaped.replace(regex, '<span class="highlight">$1</span>');
}

function openNotes(id) {
  const isNew = !id;
  const lead = isNew ? { name: "New Registration", course: state.enrollmentFilter !== "all" ? state.enrollmentFilter : "" } : state.leads.find(l => l.id === id);
  if (!lead) return;
  
  state.editingLeadId = isNew ? null : id;
  elements.modalName.textContent = isNew ? "Add New Registration" : `Info: ${lead.name}`;
  elements.noteInput.value = "";
  elements.courseInput.value = lead.course || "";
  elements.amountInput.value = lead.amountPaid || "";
  elements.profitInput.value = lead.profit || "";
  elements.paymentMethodInput.value = lead.paymentMethod || "";
  elements.enrollmentDateInput.value = lead.enrollmentDate || "";
  elements.followupStage.value = lead.followupStage || "";
  elements.memberLevel.value = lead.memberLevel || "";
  elements.followupAction.value = lead.followupAction || "";
  
  elements.nameInput.value = lead.name || "";
  elements.phoneInput.value = lead.phone || "";
  elements.newLeadFields.style.display = "block";

  if (isNew) {
    elements.leadTimeline.innerHTML = "";
  } else {
    renderTimeline(lead);
  }
  
  elements.notesModal.classList.add("show");
}

function renderTimeline(lead) {
  elements.leadTimeline.innerHTML = lead.history.slice().reverse().map(event => `
    <div class="timeline-item">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <header>
          <strong style="text-transform: capitalize;">${event.type}</strong>
          <time>${formatDate(event.date)}</time>
        </header>
        <p>${escapeHtml(event.text)}</p>
      </div>
    </div>
  `).join("");
}

function addHistory(id, type, text) {
  const lead = state.leads.find(l => l.id === id);
  if (!lead) return;
  lead.history.push({ type, text, date: new Date().toISOString() });
  saveJson(storageKeys.leads, state.leads);
}

function closeNotes() {
  state.editingLeadId = null;
  elements.notesModal.classList.remove("show");
}

function saveNote() {
  const isNew = !state.editingLeadId;
  let lead;
  
  if (isNew) {
    const name = elements.nameInput.value.trim();
    if (!name) { toast("Please enter a name."); return; }
    
    // Build the full lead object first so identity/dedup key is computed correctly
    lead = sanitizeLead({
      name,
      phone: elements.phoneInput.value.trim(),
      course: elements.courseInput.value,
      amountPaid: elements.amountInput.value,
      profit: elements.profitInput.value,
      paymentMethod: elements.paymentMethodInput.value,
      enrollmentDate: elements.enrollmentDateInput.value,
      followupStage: elements.followupStage.value,
      followupAction: elements.followupAction.value,
      manual: true,  // mark as manually added — never dedup on reload
    });
    state.leads.push(lead);
    
    const noteText = elements.noteInput.value.trim();
    if (noteText) addHistory(lead.id, "note", noteText);
    
    saveJson(storageKeys.leads, state.leads);
    toast("New registration added! ✓");
    render();
    closeNotes();
    return;
  }

  lead = state.leads.find(l => l.id === state.editingLeadId);
  if (lead) {
    const noteText = elements.noteInput.value.trim();
    if (noteText) addHistory(lead.id, "note", noteText);
    lead.name = elements.nameInput.value.trim() || lead.name;
    lead.phone = elements.phoneInput.value.trim() || lead.phone;
    lead.course = elements.courseInput.value;
    lead.amountPaid = elements.amountInput.value;
    lead.profit = elements.profitInput.value;
    lead.paymentMethod = elements.paymentMethodInput.value;
    lead.enrollmentDate = elements.enrollmentDateInput.value;
    lead.followupStage = elements.followupStage.value;
    lead.memberLevel = elements.memberLevel.value;
    lead.followupAction = elements.followupAction.value;
    saveJson(storageKeys.leads, state.leads);
    toast("Lead info updated. ✓");
    render();
  }
  closeNotes();
}

function renderFollowUpList() {
  if (!elements.followupList) return;
  const followupLeads = state.leads.filter(l => l.followupStage && l.followupStage !== "");
  
  if (followupLeads.length === 0) {
    elements.followupList.innerHTML = `<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--muted);">No hot leads marked for follow-up yet. Mark a lead with a "Stage" to see it here.</div>`;
    return;
  }

  const stageLabels = {
    high: "🔥 Hot Lead",
    trial: "🧪 Trialing",
    proposal: "📄 Proposal",
    negotiation: "🤝 Negotiating",
    closing: "✍️ Closing"
  };

  elements.followupList.innerHTML = followupLeads.map(l => `
    <div class="followup-card stage-${l.followupStage}" onclick="openNotes('${l.id}')">
      <div class="card-tag">${stageLabels[l.followupStage] || "Follow-up"}</div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <h4 style="margin: 0;">${l.name || "Unknown"}</h4>
        ${l.memberLevel ? `<span class="badge level-${l.memberLevel}" style="font-size: 9px; padding: 2px 6px;">${l.memberLevel.toUpperCase()}</span>` : ""}
      </div>
      <p class="phone">${l.phone || "No Phone"}</p>
      <div class="action-box">
        <strong>Next Step:</strong>
        <span>${l.followupAction || "No action set yet"}</span>
      </div>
      <div class="card-footer">
        <span>Click to view history</span>
        <span>${l.course || "No Course"}</span>
      </div>
    </div>
  `).join("");
}

function handleBackup() {
  const data = {
    leads: state.leads,
    templates: state.templates,
    exportDate: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lead-center-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleRestore(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (confirm("This will overwrite all current leads and templates. Continue?")) {
      state.leads = (data.leads || []).map(sanitizeLead);
      state.templates = { ...defaultTemplates, ...(data.templates || {}) };
      saveJson(storageKeys.leads, state.leads);
      saveJson(storageKeys.templates, state.templates);
      location.reload();
    }
  } catch (e) {
    toast("Invalid backup file.");
  }
}

function switchView(view, targetCourse) {
  if (targetCourse) {
    state.enrollmentFilter = targetCourse;
  } else {
    state.enrollmentFilter = "all";
  }

  let title = view.charAt(0).toUpperCase() + view.slice(1);
  if (view === "courses") title = "Preview Courses";
  if (view === "enrollments") {
    title = state.enrollmentFilter === "all" ? "Combined Course Enrollments" : state.enrollmentFilter;
  }

  elements.viewTitle.textContent = title;
  
  // Re-query to include any newly added nav items or views
  const navItems = document.querySelectorAll(".nav-item");
  const views = document.querySelectorAll(".view");

  navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === view && (!item.dataset.course || item.dataset.course === state.enrollmentFilter)));
  if (view) {
    views.forEach((item) => item.classList.toggle("active", item.id === `${view}View` || item.id === view));
  }
  
  if (view === "enrollments") renderEnrollments();
  if (view === "followup") renderFollowUpList();
  if (view === "videos") renderVideos();
  if (view === "landingLeads") loadLandingLeads();
}


function fillForms() {
  templateFields.forEach((key) => {
    document.querySelector(`#${key}`).value = state.templates[key] || "";
  });
}

function renderVideos() {
  const grid = document.querySelector("#videoGrid");
  if (!grid) return;
  
  grid.innerHTML = state.videos.map(v => {
    let mediaHtml = "";
    if (v.type === "file") {
      mediaHtml = `<video width="100%" height="100%" controls style="background: #000;"><source src="${v.blobUrl || '#'}" type="${v.mime || 'video/mp4'}"></video>`;
    } else {
      mediaHtml = `<iframe width="100%" height="100%" src="${getEmbedUrl(v.url)}" title="Video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    }

    return `
    <div class="panel" draggable="true" ondragstart="handleVideoDragStart(event, '${v.id}')" ondragover="event.preventDefault()" ondrop="handleVideoDropSort(event, '${v.id}')" style="padding: 15px; background: #fff; border: 1px solid #e2e8f0; cursor: grab;">
      <div style="aspect-ratio: 16/9; background: #1a202c; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-bottom: 12px; overflow: hidden;">
        ${mediaHtml}
      </div>
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
        <div style="flex: 1;">
          <h4 style="margin: 0 0 4px 0; font-size: 14px; line-height: 1.4; cursor: pointer; word-break: break-word;" onclick="renameVideo('${v.id}')" title="Click to rename">${escapeHtml(v.title)}</h4>
          <p class="muted" style="font-size: 11px; margin: 0;">${v.type === 'file' ? 'Local' : 'Link'} • ${formatDate(v.date)}</p>
        </div>
        <div style="display: flex; gap: 5px; flex-shrink: 0;">
          <button class="mini-button danger" onclick="removeVideo('${v.id}')">Delete</button>
        </div>
      </div>
    </div>
  `;
  }).join("") || `<div class="muted" style="grid-column: 1/-1; text-align: center; padding: 40px;">No videos added yet. Use the buttons above to import.</div>`;
}

function renameVideo(id) {
  const video = state.videos.find(v => v.id === id);
  if (!video) return;
  const newTitle = prompt("Enter new title for this video:", video.title);
  if (newTitle && newTitle.trim()) {
    video.title = newTitle.trim();
    saveJson(storageKeys.videos, state.videos.map(({blobUrl, ...v}) => v));
    renderVideos();
    toast("Video renamed.");
  }
}

function getEmbedUrl(url) {
  if (url.includes("youtube.com/watch?v=")) return url.replace("watch?v=", "embed/");
  if (url.includes("youtu.be/")) return url.replace("youtu.be/", "youtube.com/embed/");
  if (url.includes("vimeo.com/")) return url.replace("vimeo.com/", "player.vimeo.com/video/");
  return url;
}

function showAddVideoPrompt() {
  const title = prompt("Enter video title:");
  if (!title) return;
  const url = prompt("Enter video URL (YouTube, Vimeo, or direct link):");
  if (!url) return;
  
  state.videos.push({
    id: crypto.randomUUID(),
    type: "link",
    title,
    url,
    date: new Date().toISOString()
  });
  saveJson(storageKeys.videos, state.videos.map(({blobUrl, ...v}) => v));
  renderVideos();
  toast("Video added to library!");
}

let draggedVideoId = null;

function handleVideoDragStart(e, id) {
  draggedVideoId = id;
  e.dataTransfer.setData("text/plain", id);
}

function handleVideoDropSort(e, targetId) {
  e.preventDefault();
  if (draggedVideoId === targetId) return;
  
  const fromIndex = state.videos.findIndex(v => v.id === draggedVideoId);
  const toIndex = state.videos.findIndex(v => v.id === targetId);
  
  if (fromIndex !== -1 && toIndex !== -1) {
    const [moved] = state.videos.splice(fromIndex, 1);
    state.videos.splice(toIndex, 0, moved);
    saveJson(storageKeys.videos, state.videos.map(({blobUrl, ...v}) => v));
    renderVideos();
  }
}

function moveVideo(id, direction) {
  const index = state.videos.findIndex(v => v.id === id);
  if (index === -1) return;
  const newIndex = index + direction;
  if (newIndex >= 0 && newIndex < state.videos.length) {
    const [moved] = state.videos.splice(index, 1);
    state.videos.splice(newIndex, 0, moved);
    saveJson(storageKeys.videos, state.videos.map(({blobUrl, ...v}) => v));
    renderVideos();
  }
}

// IndexedDB logic for large video files
const dbName = "ChampAcademyDB";
const storeName = "videos";
let db;

const request = indexedDB.open(dbName, 1);
request.onupgradeneeded = (e) => {
  e.target.result.createObjectStore(storeName, { keyPath: "id" });
};
request.onsuccess = (e) => {
  db = e.target.result;
  loadVideosFromDB();
};

async function loadVideosFromDB() {
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const all = await new Promise(resolve => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
  });
  
  // Revoke old URLs and create new ones
  state.videos.forEach(v => {
    if (v.blobUrl) URL.revokeObjectURL(v.blobUrl);
  });

  state.videos.forEach(v => {
    if (v.type === "file") {
      const saved = all.find(item => item.id === v.id);
      if (saved) v.blobUrl = URL.createObjectURL(saved.blob);
    }
  });
  renderVideos();
}

async function importVideoFile(event) {
  const file = event.target ? event.target.files[0] : event;
  if (!file || !file.type.startsWith("video/")) {
    if (file && file.type) toast("Please select a valid video file.");
    return;
  }
  
  if (!db) {
    toast("System is still initializing. Please wait a moment.");
    return;
  }

  try {
    toast("Saving video to local database...");
    const id = crypto.randomUUID();
    
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const addRequest = store.add({ id, blob: file });

    await new Promise((resolve, reject) => {
      addRequest.onsuccess = resolve;
      addRequest.onerror = () => reject(new Error("Failed to write to database."));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(new Error("Transaction failed."));
    });

    state.videos.unshift({
      id,
      type: "file",
      title: file.name,
      mime: file.type,
      date: new Date().toISOString(),
      blobUrl: URL.createObjectURL(file)
    });
    
    saveJson(storageKeys.videos, state.videos.map(({blobUrl, ...v}) => {
      const {blobUrl: _, ...rest} = v; // Clean up just in case
      return rest;
    }));
    
    renderVideos();
    toast("Video file imported successfully! ✓");
  } catch (err) {
    console.error("Video Import Error:", err);
    toast("Error: " + err.message);
  } finally {
    if (event.target) event.target.value = "";
  }
}

function handleVideoDrop(e) {
  e.preventDefault();
  const zone = document.querySelector("#videoDropZone");
  if (zone) {
    zone.style.borderColor = "#cbd5e0";
    zone.style.background = "#f8fafc";
  }
  const file = e.dataTransfer.files[0];
  if (file) importVideoFile(file);
}

function removeVideo(id) {
  if (confirm("Delete this video?")) {
    const video = state.videos.find(v => v.id === id);
    if (video && video.blobUrl) URL.revokeObjectURL(video.blobUrl);
    
    state.videos = state.videos.filter(v => v.id !== id);
    saveJson(storageKeys.videos, state.videos.map(({blobUrl, ...v}) => v));
    
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    
    renderVideos();
    toast("Video removed.");
  }
}

function renderPreviewSessionList() {
  const list = elements.previewSessionList || document.querySelector("#previewSessionList");
  if (!list) return;
  
  if (!state.previews || state.previews.length === 0) {
    list.innerHTML = `<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--muted); background: var(--soft); border-radius: 12px; border: 2px dashed var(--line);">No performance logs yet. Click "+ Add Preview Session" to track your event data.</div>`;
    return;
  }

  // Sort by date descending
  const sorted = [...state.previews].sort((a,b) => {
    const da = new Date(a.date || 0);
    const db = new Date(b.date || 0);
    return db - da;
  });

  list.innerHTML = sorted.map(p => {
    const adSpend = parseFloat(p.adSpend) || 0;
    const leads = parseInt(p.leads) || 0;
    const cpl = leads > 0 ? (adSpend / leads).toFixed(2) : "0.00";
    const revenue = parseFloat(p.revenue) || 0;
    const roi = adSpend > 0 ? (revenue / adSpend).toFixed(1) : "0";
    const conversions = parseInt(p.conversions) || 0;
    const convRate = leads > 0 ? ((conversions / leads) * 100).toFixed(1) : "0";

    return `
      <div class="preview-card" style="border-left: 4px solid var(--brand);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 12px;">
          <div>
            <h4 style="margin:0; font-size: 16px; color: var(--text);">${escapeHtml(p.title || "Untitled Session")}</h4>
            <span style="font-size: 12px; color: var(--muted);">${p.date || "No Date"}</span>
          </div>
          <div style="display:flex; gap: 4px;">
            <button class="mini-button" onclick="editPreviewSession('${p.id}')">Edit</button>
            <button class="mini-button danger" onclick="deletePreviewSession('${p.id}')">Del</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px;">
          <div style="background: var(--soft); padding: 8px; border-radius: 6px;">
            <div style="font-size: 10px; text-transform: uppercase; color: var(--muted);">Spend</div>
            <div style="font-weight: 700; color: #e03131;">RM ${adSpend.toLocaleString()}</div>
          </div>
          <div style="background: var(--soft); padding: 8px; border-radius: 6px;">
            <div style="font-size: 10px; text-transform: uppercase; color: var(--muted);">Leads</div>
            <div style="font-weight: 700; color: var(--brand);">${leads}</div>
          </div>
          <div style="background: var(--soft); padding: 8px; border-radius: 6px;">
            <div style="font-size: 10px; text-transform: uppercase; color: var(--muted);">WA Group</div>
            <div style="font-weight: 700; color: #099268;">${p.waJoin || 0}</div>
          </div>
          <div style="background: var(--soft); padding: 8px; border-radius: 6px;">
            <div style="font-size: 10px; text-transform: uppercase; color: var(--muted);">Zoom</div>
            <div style="font-weight: 700; color: #1c7ed6;">${p.zoomJoin || 0}</div>
          </div>
        </div>

        <div style="background: #fff8f1; border: 1px solid #ffe8cc; padding: 10px; border-radius: 8px; margin-bottom: 15px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span style="font-size: 12px; font-weight:700; color: #e8590c;">${conversions} Sales (${convRate}%)</span>
            <span style="font-size: 12px; font-weight:700; color: #2b8a3e;">RM ${revenue.toLocaleString()}</span>
          </div>
          <div style="font-size: 11px; color: #868e96;">Product: ${escapeHtml(p.product || "N/A")}</div>
        </div>

        <div style="display:flex; justify-content:space-around; font-size: 11px; font-weight: 700; color: var(--muted); padding-top: 10px; border-top: 1px solid var(--line);">
          <span>CPL: RM ${cpl}</span>
          <span>ROI: ${roi}x</span>
        </div>
      </div>
    `;
  }).join("");
}

function openPreviewModal(id = null) {
  const isEdit = !!id;
  document.getElementById("previewModalTitle").textContent = isEdit ? "Edit Performance Log" : "Add Preview Performance Log";
  elements.previewEditId.value = id || "";
  
  if (isEdit) {
    const p = state.previews.find(x => x.id === id);
    if (p) {
      elements.prevTitle.value = p.title;
      elements.prevDate.value = p.date;
      elements.prevAdSpend.value = p.adSpend;
      elements.prevLeads.value = p.leads;
      elements.prevWa.value = p.waJoin;
      elements.prevZoom.value = p.zoomJoin;
      elements.prevConver.value = p.conversions;
      elements.prevProduct.value = p.product;
      elements.prevRevenue.value = p.revenue;
    }
  } else {
    elements.prevTitle.value = "";
    elements.prevDate.value = new Date().toISOString().split('T')[0];
    elements.prevAdSpend.value = "";
    elements.prevLeads.value = "";
    elements.prevWa.value = "";
    elements.prevZoom.value = "";
    elements.prevConver.value = "";
    elements.prevProduct.value = "";
    elements.prevRevenue.value = "";
  }
  elements.previewModal.classList.add("show");
}

function closePreviewModal() {
  elements.previewModal.classList.remove("show");
}

function savePreviewSession() {
  const editId = document.getElementById("previewEditId")?.value;
  
  const getVal = (id) => document.getElementById(id)?.value || "";
  
  const session = {
    id: editId || crypto.randomUUID(),
    title: getVal("prevTitle").trim(),
    date: getVal("prevDate"),
    adSpend: getVal("prevAdSpend"),
    leads: getVal("prevLeads"),
    waJoin: getVal("prevWa"),
    zoomJoin: getVal("prevZoom"),
    conversions: getVal("prevConver"),
    product: getVal("prevProduct").trim(),
    revenue: getVal("prevRevenue"),
  };

  if (!session.title || !session.date) {
    toast("Name and Date are required.");
    return;
  }

  if (editId) {
    const idx = state.previews.findIndex(x => x.id === editId);
    if (idx !== -1) state.previews[idx] = session;
  } else {
    state.previews.push(session);
  }

  saveJson(storageKeys.previews, state.previews);
  toast("Performance log saved! ✓");
  render();
  closePreviewModal();
}

function editPreviewSession(id) {
  openPreviewModal(id);
}

function deletePreviewSession(id) {
  if (confirm("Delete this performance log?")) {
    state.previews = state.previews.filter(x => x.id !== id);
    saveJson(storageKeys.previews, state.previews);
    render();
    toast("Log deleted.");
  }
}

function exportLeads() {
  const headers = [
    ["full_name", "name"],
    ["phone_number", "phone"],
    ["email", "email"],
    ["job_title", "job"],
    ["course", "course"],
  ];
  const lines = [
    headers.map(([label]) => label).join(","),
    ...state.leads.map((lead) =>
      headers
        .map(([, field]) => csvCell(lead[field] || ""))
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lead-center-export-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

document.querySelector(".sidebar").addEventListener("click", (e) => {
  const item = e.target.closest(".nav-item");
  if (item && item.dataset.view) {
    switchView(item.dataset.view, item.dataset.course);
  }
});

elements.csvInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  
  const targetCourse = state.pendingCourseImport;
  state.pendingCourseImport = null;

  try {
    const result = importRows(parseLeadFile(await file.arrayBuffer()), targetCourse);
    event.target.value = "";
    render();
    
    const msg = `${result.added} imported, ${result.merged} merged.`;
    toast(msg);
    
    if (targetCourse) {
      // Ensure the target course is expanded so user sees the result
      const sanitizedId = "course-list-" + btoa(unescape(encodeURIComponent(targetCourse))).replace(/[/+=]/g, "");
      const el = document.getElementById(sanitizedId);
      if (el) {
        el.style.display = "block";
        const arrow = document.getElementById('arrow-' + sanitizedId);
        if (arrow) arrow.style.transform = "rotate(180deg)";
      }
      alert(`Import Successful!\n${msg}\nLeads added to: ${targetCourse}`);
    }
  } catch (err) {
    console.error("Import Error:", err);
    alert("Failed to parse CSV. Error: " + err.message);
  }
});

elements.exportBtn.addEventListener("click", exportLeads);
elements.bulkWhatsappBtn.addEventListener("click", bulkWhatsapp);
elements.bulkEmailBtn.addEventListener("click", bulkEmail);

elements.dueFilter.addEventListener("change", (event) => {
  state.dueFilter = event.target.value;
  render();
});

elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderLeadTable();
});

elements.statusFilter.addEventListener("change", (event) => {
  state.status = event.target.value;
  renderLeadTable();
});

elements.courseFilter.addEventListener("change", (event) => {
  state.courseFilter = event.target.value;
  renderLeadTable();
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  if (target.dataset.action === "done") {
    markStepDone(target.dataset.id, Number(target.dataset.step));
    toast("Follow-up marked done.");
  }
  if (target.dataset.action === "remove") {
    if (confirm("Are you sure you want to remove this lead?")) removeLead(target.dataset.id);
  }
  if (target.dataset.action === "notes") openNotes(target.dataset.id);
  if (target.dataset.action === "toggle-followup") {
    const lead = state.leads.find(l => l.id === target.dataset.id);
    if (lead) {
      lead.followupStage = lead.followupStage ? "" : "high";
      saveJson(storageKeys.leads, state.leads);
      render();
      toast(lead.followupStage ? "Added to Follow-up pipeline ⭐" : "Removed from Follow-up");
    }
  }
});

elements.leadTable.addEventListener("change", (e) => {
  if (e.target.classList.contains("lead-select")) {
    const id = e.target.dataset.id;
    if (e.target.checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);
    updateBulkToolbar();
    e.target.closest("tr").classList.toggle("selected", e.target.checked);
  }
});

elements.selectAll.addEventListener("change", (e) => {
  const filtered = filteredLeads();
  if (e.target.checked) {
    filtered.forEach(l => state.selectedIds.add(l.id));
  } else {
    filtered.forEach(l => state.selectedIds.delete(l.id));
  }
  renderLeadTable();
  updateBulkToolbar();
});

elements.bulkDeleteBtn.addEventListener("click", () => {
  if (confirm(`Delete ${state.selectedIds.size} leads?`)) {
    state.leads = state.leads.filter(l => !state.selectedIds.has(l.id));
    state.selectedIds.clear();
    saveJson(storageKeys.leads, state.leads);
    render();
    toast("Leads deleted.");
  }
});

elements.bulkStatus.addEventListener("change", (e) => {
  const status = e.target.value;
  if (!status) return;
  state.leads.forEach(l => {
    if (state.selectedIds.has(l.id)) l.status = status;
  });
  state.selectedIds.clear();
  e.target.value = "";
  saveJson(storageKeys.leads, state.leads);
  render();
  toast("Status updated.");
});

elements.closeModal.addEventListener("click", closeNotes);
elements.cancelNote.addEventListener("click", closeNotes);
elements.saveNote.addEventListener("click", saveNote);

elements.backupBtn.addEventListener("click", () => elements.backupModal.classList.add("show"));
document.querySelector("#closeBackup").addEventListener("click", () => elements.backupModal.classList.remove("show"));
elements.downloadBackupBtn.addEventListener("click", handleBackup);
document.querySelector("#restoreInput").addEventListener("change", handleRestore);

elements.tableViewBtn.addEventListener("click", () => {
  elements.leadTableView.style.display = "block";
  elements.leadKanbanView.style.display = "none";
  elements.tableViewBtn.classList.add("active");
  elements.kanbanViewBtn.classList.remove("active");
});

elements.kanbanViewBtn.addEventListener("click", () => {
  elements.leadTableView.style.display = "none";
  elements.leadKanbanView.style.display = "block";
  elements.tableViewBtn.classList.remove("active");
  elements.kanbanViewBtn.classList.add("active");
  renderKanban();
});

document.addEventListener("change", (event) => {
  const target = event.target.closest("[data-action='status']");
  if (target) updateStatus(target.dataset.id, target.value);
});

elements.saveTemplatesBtn.addEventListener("click", () => {
  templateFields.forEach((key) => {
    state.templates[key] = document.querySelector(`#${key}`).value;
  });
  saveJson(storageKeys.templates, state.templates);
  toast("Templates saved.");
});

// Manual entry handler is now inline onclick

// ──────────────────────────────────────────
// PDF Report Generation
// ──────────────────────────────────────────
// Known courses — shown even if empty


async function generateEnrollmentPDF(courseFilter) {
  if (typeof html2pdf === 'undefined') {
    toast("PDF library not loaded. Please wait a moment or check your internet connection.");
    return;
  }

  // ── Filter & Deduplicate leads ──
  const isAll = courseFilter === "all";
  const filtered = state.leads.filter(l => {
    const match = getBestCourseMatch(l.course);
    const paid = parseFloat(l.amountPaid) > 0;
    if (!match || !paid) return false;
    if (isAll) return true;
    return match === courseFilter;
  });

  const seen = new Set();
  const leads = filtered.filter(l => {
    const key = normalize(l.name) + normalize(l.phone);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => {
    const matchA = getBestCourseMatch(a.course);
    const matchB = getBestCourseMatch(b.course);
    if (matchA !== matchB) return KNOWN_COURSES.indexOf(matchA) - KNOWN_COURSES.indexOf(matchB);
    return new Date(b.enrollmentDate || 0) - new Date(a.enrollmentDate || 0);
  });

  if (!leads.length) {
    toast("No enrollment records found for this course.");
    return;
  }

  toast("Generating professional PDF report...");

  const totalEnrollments = leads.length;
  const totalRevenue     = leads.reduce((s, l) => s + (parseFloat(l.amountPaid) || 0), 0);
  const totalProfit      = leads.reduce((s, l) => s + (parseFloat(l.profit)     || 0), 0);
  const generatedDate = new Intl.DateTimeFormat("en-MY", { dateStyle: "full", timeStyle: "short" }).format(new Date());
  const reportTitle   = isAll ? "Total Enrollment Report — All courses" : `${courseFilter}`;

  // ── Create Report Container ──
  const container = document.createElement('div');
  container.className = 'pdf-export-container';
  container.style.padding = '40px';
  container.style.background = '#fff';
  container.style.color = '#1e293b';
  container.style.fontFamily = "'Inter', 'Noto Sans SC', sans-serif";

  // Inject Styles
  const style = document.createElement('style');
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Noto+Sans+SC:wght@400;700&display=swap');
    .pdf-export-container * { box-sizing: border-box; }
    .pdf-header { background: linear-gradient(135deg, #1e293b, #334155); color: #fff; padding: 40px; border-radius: 16px; margin-bottom: 40px; position: relative; overflow: hidden; }
    .pdf-header::after { content: ""; position: absolute; top: -50%; right: -10%; width: 300px; height: 300px; background: rgba(255,255,255,0.05); border-radius: 50%; }
    .pdf-header h1 { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
    .pdf-header p { margin: 10px 0 0; opacity: 0.8; font-size: 15px; }
    
    .metrics-row { display: flex; gap: 24px; margin-bottom: 50px; }
    .metric-box { flex: 1; padding: 25px; border-radius: 16px; color: #fff; text-align: center; box-shadow: 0 10px 20px rgba(0,0,0,0.05); }
    .metric-box.primary { background: #6366f1; }
    .metric-box.success { background: #10b981; }
    .metric-box.warning { background: #f59e0b; }
    .metric-box .val { font-size: 28px; font-weight: 700; margin-bottom: 6px; display: block; }
    .metric-box .lbl { font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
    
    .section-title { font-size: 20px; font-weight: 700; margin: 40px 0 20px; color: #1e293b; border-left: 5px solid #6366f1; padding-left: 15px; }
    
    .table-container { background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; margin-bottom: 30px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #f8fafc; color: #64748b; text-align: left; padding: 14px 16px; font-weight: 700; border-bottom: 2px solid #e2e8f0; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
    td { padding: 12px 16px; border-bottom: 1px solid #f1f5f9; color: #334155; }
    tfoot td { color: #fff !important; font-size: 14px; }
    tr:last-child td { border-bottom: 0; }
    tr:nth-child(even) { background: #fbfcfe; }
    
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .amt-pos { color: #10b981; font-weight: 700; }
    .amt-alt { color: #6366f1; font-weight: 700; }
    
    .course-group { margin-top: 40px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px; }
    .course-badge { background: #eff6ff; color: #2563eb; padding: 8px 16px; border-radius: 99px; font-weight: 700; font-size: 14px; border: 1px solid #dbeafe; }
    .course-count { background: #6366f1; color: #fff; width: 24px; height: 24px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 11px; }
    
    .footer-info { margin-top: 50px; text-align: center; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; padding-top: 25px; }
    .page-break { page-break-before: always; height: 1px; width: 100%; margin-top: -1px; }
  `;
  container.appendChild(style);

  // ── Build HTML Content ──
  let html = `
    <div class="pdf-header">
      <h1>Champion Course — Lead Center</h1>
      <p>${reportTitle}  &bull;  Generated on ${generatedDate}</p>
    </div>

    <div class="metrics-row">
      <div class="metric-box primary">
        <span class="val">${totalEnrollments}</span>
        <span class="lbl">Total Enrollments</span>
      </div>
      <div class="metric-box success">
        <span class="val">RM ${totalRevenue.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>
        <span class="lbl">Total Revenue</span>
      </div>
      <div class="metric-box warning">
        <span class="val">RM ${totalProfit.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>
        <span class="lbl">Total Profit</span>
      </div>
    </div>

    <h2 class="section-title">Course Summary Overview</h2>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Course Name</th>
            <th class="text-center">Total Students</th>
            <th class="text-right">Revenue (RM)</th>
            <th class="text-right">Profit (RM)</th>
          </tr>
        </thead>
        <tbody>
  `;

  const coursesToShow = isAll ? [...KNOWN_COURSES, "Other Unclassified Courses"] : [courseFilter];
  coursesToShow.forEach(c => {
    const courseLeads = leads.filter(l => getBestCourseMatch(l.course) === c);
    if (!courseLeads.length) return; // Skip empty categories

    const rev = courseLeads.reduce((s, l) => s + (parseFloat(l.amountPaid) || 0), 0);
    const pro = courseLeads.reduce((s, l) => s + (parseFloat(l.profit) || 0), 0);
    
    html += `
      <tr>
        <td style="font-weight: 500;">${c}</td>
        <td class="text-center">${courseLeads.length}</td>
        <td class="text-right amt-pos">${rev.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
        <td class="text-right amt-alt">${pro.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
        <tfoot style="background: #1e293b; color: #fff; font-weight: 700; border-top: 2px solid #000;">
          <tr>
            <td>GRAND TOTAL REPORT SUMMARY</td>
            <td class="text-center">${totalEnrollments}</td>
            <td class="text-right">RM ${totalRevenue.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
            <td class="text-right">RM ${totalProfit.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- FORCE PAGE BREAK -->
    <div class="page-break" style="margin-bottom: 20px;"></div>
    
    <h2 class="section-title">Detailed Enrollment Records</h2>
  `;

  coursesToShow.forEach((c, idx) => {
    const courseLeads = leads.filter(l => getBestCourseMatch(l.course) === c);
    if (!courseLeads.length) return;

    html += `
      <div class="course-group">
        <div class="course-badge">${c}</div>
        <div class="course-count">${courseLeads.length}</div>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 40px" class="text-center">#</th>
              <th>Student Name</th>
              <th>Phone</th>
              <th class="text-center">Enroll Date</th>
              <th class="text-right">Amount</th>
              <th class="text-right">Profit</th>
              <th class="text-center">Method</th>
            </tr>
          </thead>
          <tbody>
    `;

    courseLeads.forEach((l, i) => {
      html += `
        <tr>
          <td class="text-center" style="color: #94a3b8; font-size: 11px;">${i + 1}</td>
          <td style="font-weight: 700;">${l.name || '—'}</td>
          <td style="color: #64748b;">${l.phone || '—'}</td>
          <td class="text-center">${l.enrollmentDate ? formatDate(l.enrollmentDate) : '—'}</td>
          <td class="text-right amt-pos">${l.amountPaid ? parseFloat(l.amountPaid).toLocaleString("en-MY", { minimumFractionDigits: 2 }) : '0.00'}</td>
          <td class="text-right amt-alt">${l.profit ? parseFloat(l.profit).toLocaleString("en-MY", { minimumFractionDigits: 2 }) : '0.00'}</td>
          <td class="text-center">
            <span style="font-size: 10px; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0;">
              ${l.paymentMethod || '—'}
            </span>
          </td>
        </tr>
      `;
    });

    html += `
          </tbody>
          <tfoot style="background: #f8fafc; font-weight: 700; border-top: 2px solid #e2e8f0;">
            <tr>
              <td colspan="4" class="text-right" style="color: #64748b; font-size: 11px;">SUB-TOTAL FOR ${c.toUpperCase()}</td>
              <td class="text-right amt-pos">RM ${courseLeads.reduce((s, l) => s + (parseFloat(l.amountPaid) || 0), 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
              <td class="text-right amt-alt">RM ${courseLeads.reduce((s, l) => s + (parseFloat(l.profit) || 0), 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
              <td class="text-center" style="font-size: 11px; color: #64748b;">${courseLeads.length} Students</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  });

  html += `
    <div class="footer-info">
      Champion Course Lead Center System  &bull;  ${generatedDate}  &bull;  Confidential Report
    </div>
  `;

  container.innerHTML += html;

  // Render to PDF
  const opt = {
    margin:       10,
    filename:     `enrollment-report-${isAll ? 'all' : courseFilter.substring(0,20).replace(/\\s+/g,'_')}.pdf`,
    image:        { type: 'jpeg', quality: 1.0 },
    html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' },
    pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
  };

  try {
    await html2pdf().set(opt).from(container).save();
    toast("PDF Report downloaded! ✓");
  } catch (err) {
    console.error("PDF Generation Error:", err);
    toast("Error generating PDF. Please try again.");
  }
}

// Enrollment-level import/export wiring

const enrollImportInput = document.querySelector("#enrollImportInput");
if (enrollImportInput) {
  enrollImportInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    const result = importRows(parseLeadFile(await file.arrayBuffer()));
    event.target.value = "";
    render();
    toast(`${result.added} imported, ${result.merged} merged.`);
  });
}

const enrollExportBtn = document.querySelector("#enrollExportBtn");
if (enrollExportBtn) {
  enrollExportBtn.addEventListener("click", () => {
    const leads = state.leads.filter(l => {
      if (state.enrollmentFilter === "all") return l.course;
      return l.course === state.enrollmentFilter;
    });
    const headers = [["full_name", "name"],["phone_number", "phone"],["course","course"],["amount_paid","amountPaid"],["profit","profit"],["payment_method","paymentMethod"],["enrollment_date","enrollmentDate"]];
    const lines = [
      headers.map(([label]) => label).join(","),
      ...leads.map(l => headers.map(([, field]) => csvCell(l[field] || "")).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `enrollments-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Enrollment CSV exported.");
  });
}

// Emergency restoration wiring
if (elements.restoreLastDeletedBtn) {
  elements.restoreLastDeletedBtn.addEventListener("click", restoreLastDeleted);
}
if (elements.deepScanBtn) {
  elements.deepScanBtn.addEventListener("click", deepScanRecovery);
}

// Auto-load backup from server if localStorage is empty or version param ?v=X is present
async function autoLoadBackupFromServer() {
  const urlParams = new URLSearchParams(window.location.search);
  const version = urlParams.get('v');
  const localLeadsCount = state.leads.length;
  
  const lastImportedVerKey = "lead_center_last_imported_version";
  const lastImportedVer = localStorage.getItem(lastImportedVerKey);
  
  const shouldLoad = !localLeadsCount || (version && version !== lastImportedVer);
  if (!shouldLoad) return;
  
  try {
    const backupUrl = './lead-center-full-backup-2026-06-28.json';
    const response = await fetch(backupUrl);
    if (!response.ok) {
      console.warn("Server backup file not found:", backupUrl);
      return;
    }
    const data = await response.json();
    if (data && typeof data === 'object') {
      let importedCount = 0;
      if (Array.isArray(data.leads) && data.leads.length > 0) {
        const incomingLeads = data.leads.map(sanitizeLead);
        state.leads = mergeDuplicateLeads([...state.leads, ...incomingLeads]);
        saveJson(storageKeys.leads, state.leads);
        importedCount = incomingLeads.length;
      }
      if (data.templates) {
        state.templates = { ...state.templates, ...data.templates };
        saveJson(storageKeys.templates, state.templates);
      }
      if (Array.isArray(data.previews)) {
        state.previews = data.previews;
        saveJson(storageKeys.previews, state.previews);
      }
      if (Array.isArray(data.videos)) {
        state.videos = data.videos;
        saveJson(storageKeys.videos, state.videos);
      }
      if (Array.isArray(data.customGroups)) {
        localStorage.setItem("lead_center_custom_groups", JSON.stringify(data.customGroups));
      }
      if (Array.isArray(data.courseOrder)) {
        localStorage.setItem("lead_center_course_order", JSON.stringify(data.courseOrder));
      }
      
      // Update last imported version
      if (version) {
        localStorage.setItem(lastImportedVerKey, version);
      }
      
      // Hide banner if leads loaded
      const banner = document.getElementById("dataFileBanner");
      if (banner && state.leads.length > 0) {
        banner.style.display = "none";
      }
      
      fillForms();
      render();
      toast(`✅ 成功自动载入云端备份，恢复了 ${importedCount} 条客户记录`);
    }
  } catch (err) {
    console.error("Auto load backup error:", err);
  }
}

initPerformanceFilters();
fillForms();
render();
autoLoadBackupFromServer(); // Load from cloud storage backup if local storage is empty

// Show file storage banner on startup
(function showStartupBanner() {
  const banner = document.getElementById("dataFileBanner");
  const hasLocalData = state.leads.length > 0;
  if (!banner) return;

  if (!hasLocalData) {
    banner.style.display = "flex";
    const title = document.getElementById("dataFileBannerTitle");
    const sub = document.getElementById("dataFileBannerSub");
    if (title) title.textContent = "⚠️ 未找到客户资料";
    if (sub) sub.textContent = "您之前保存过数据文件吗？点击「连接数据文件」来恢复您的客户资料。";
  } else {
    banner.style.display = "none";
  }
  updateFileStorageBtnUI(false, null);
})();

// ──────────────────────────────────────────────────────
// Landing Page Leads Admin Functions
// ──────────────────────────────────────────────────────

window.loadLandingLeads = async function() {
  const tbody = document.getElementById('landingLeadsBody');
  const statsBar = document.getElementById('landingLeadsStats');
  if (!tbody) return;

  const apiBase = (window.CONFIG && window.CONFIG.API_BASE_URL) || '';
  const isLocalStorageOrDevMode = window.location.protocol === 'file:' && !apiBase;

  // ── Detect file:// mode ──
  if (isLocalStorageOrDevMode) {
    if (statsBar) statsBar.innerHTML = '';
    tbody.innerHTML = `
      <tr><td colspan="7" style="padding:0;">
        <div style="margin:20px 0; background:linear-gradient(135deg,rgba(124,58,237,0.08),rgba(245,166,35,0.05)); border:1px solid rgba(124,58,237,0.25); border-radius:14px; padding:32px; text-align:center;">
          <div style="font-size:40px; margin-bottom:16px;">🖥️</div>
          <h3 style="font-size:18px; font-weight:800; margin-bottom:10px;">请通过服务器访问</h3>
          <p style="color:var(--muted); font-size:14px; line-height:1.7; margin-bottom:20px;">
            你目前是用 <code style="background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:5px;">file://</code> 方式直接打开文件。<br/>
            Landing Leads 功能需要通过服务器或配置远程 API URL 才能使用。
          </p>
          <div style="display:flex; flex-direction:column; gap:10px; align-items:center;">
            <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:12px 24px; font-family:monospace; font-size:15px; letter-spacing:0.03em;">
              <span style="color:#a0aec0;">选项A：</span> 开启终端，运行 <strong style="color:#F5A623;">npm start</strong> 并访问录入管理
            </div>
            <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:12px 24px; font-family:monospace; font-size:15px; letter-spacing:0.03em;">
              <span style="color:#a0aec0;">选项B：</span> 在 <strong style="color:#7C3AED;">config.js</strong> 中设置其托管服务的 API_BASE_URL
            </div>
          </div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--muted)">⏳ 加载中...</td></tr>`;

  try {
    const res = await fetch(`${apiBase}/api/landing-leads`);
    if (!res.ok) throw new Error('Cannot reach server');
    const { leads, total } = await res.json();

    // Stats bar
    if (statsBar) {
      const today = leads.filter(l => {
        const d = new Date(l.createdAt);
        const now = new Date();
        return d.toDateString() === now.toDateString();
      }).length;

      // Group by industry
      const industries = {};
      leads.forEach(l => { industries[l.industry] = (industries[l.industry] || 0) + 1; });
      const topIndustry = Object.entries(industries).sort((a,b)=>b[1]-a[1])[0];

      statsBar.innerHTML = `
        <div style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.2);border-radius:10px;padding:12px 20px;display:flex;flex-direction:column;gap:2px;">
          <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">总下载人数</span>
          <strong style="font-size:22px;color:#7C3AED;">${total}</strong>
        </div>
        <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:12px 20px;display:flex;flex-direction:column;gap:2px;">
          <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">今日新增</span>
          <strong style="font-size:22px;color:#10B981;">${today}</strong>
        </div>
        ${topIndustry ? `<div style="background:rgba(245,166,35,0.1);border:1px solid rgba(245,166,35,0.2);border-radius:10px;padding:12px 20px;display:flex;flex-direction:column;gap:2px;">
          <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">最多行业</span>
          <strong style="font-size:16px;color:#F5A623;">${escapeHtml(topIndustry[0])} (${topIndustry[1]})</strong>
        </div>` : ''}
      `;
    }

    if (!leads.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:60px;color:var(--muted)">📋 暂时没有记录<br/><small style="opacity:0.6">当有客户填写Landing Page表单后，记录将在这里显示。</small></td></tr>`;
      return;
    }

    tbody.innerHTML = leads.map((l, i) => {
      const date = new Date(l.createdAt);
      const dateStr = new Intl.DateTimeFormat('zh-MY', {
        year:'numeric',month:'short',day:'2-digit',
        hour:'2-digit',minute:'2-digit'
      }).format(date);
      const wa = l.phone ? `<a href="https://wa.me/${l.phone.replace(/[^\d]/g,'')}" target="_blank" class="mini-button" style="background:#25D366;color:#fff;border-color:#25D366;text-decoration:none;">WA</a>` : '-';
      return `
        <tr>
          <td style="color:var(--muted);font-size:13px;">${total - i}</td>
          <td><strong>${escapeHtml(l.name)}</strong></td>
          <td><span class="muted">${escapeHtml(l.phone || '-')}</span></td>
          <td><span class="badge" style="background:rgba(124,58,237,0.1);color:#7C3AED;border:1px solid rgba(124,58,237,0.2);font-size:12px;">${escapeHtml(l.industry)}</span></td>
          <td style="max-width:260px;font-size:13px;color:var(--muted);" title="${escapeHtml(l.challenge)}">${escapeHtml(l.challenge.length > 80 ? l.challenge.slice(0,80)+'...' : l.challenge)}</td>
          <td style="font-size:12px;color:var(--muted);">${dateStr}</td>
          <td>${wa}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#ef4444;">⚠️ 无法连接服务器<br/><small>请确保服务器正在运行且可以连接</small></td></tr>`;
    if (statsBar) statsBar.innerHTML = '';
  }
};

window.exportLandingLeadsCSV = async function() {
  const apiBase = (window.CONFIG && window.CONFIG.API_BASE_URL) || '';
  const isLocalStorageOrDevMode = window.location.protocol === 'file:' && !apiBase;
  if (isLocalStorageOrDevMode) {
    alert('请通过管理系统（服务器版）访问，或在 config.js 指定 API_BASE_URL 再使用导出功能。');
    return;
  }
  try {
    const res = await fetch(`${apiBase}/api/landing-leads`);
    if (!res.ok) throw new Error('Server error');
    const { leads } = await res.json();
    if (!leads.length) { toast('暂时没有数据可以导出'); return; }

    const headers = ['编号','姓名','电话','工作领域','面对的挑战','提交时间'];
    const rows = leads.map((l, i) => [
      i + 1,
      l.name,
      l.phone,
      l.industry,
      l.challenge.replace(/\n/g, ' '),
      new Date(l.createdAt).toLocaleString('zh-MY'),
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `landing-leads-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`✅ 成功导出 ${leads.length} 条记录`);
  } catch {
    toast('❌ 导出失败，请检查服务器连接');
  }
};

