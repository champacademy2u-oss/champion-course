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
  zoomSettings: "lead_center_zoom_settings",
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

const defaultZoomSettings = {
  eventName: "",
  subtitle: "",
  speakerName: "",
  eventDate: "",
  eventTime: "",
  registrationUrl: "",
  status: "draft",
  seatLimit: 0,
  sendWhatsapp: true,
  sendEmail: true,
  whatsappTemplateName: "champion_zoom_confirmation",
  whatsappReminderTemplateName: "champion_zoom_reminder",
  whatsappMessage: "Hi {{name}}，您已成功报名 {{event}}。\n\n日期：{{date}}\n时间：{{time}}\nZoom 报名链接：{{zoom_link}}",
  emailSubject: "{{event}}｜Zoom 报名确认",
  emailBody: "Hi {{name}}，\n\n感谢您报名 {{event}}。\n\n日期：{{date}}\n时间：{{time}}\nZoom 报名链接：{{zoom_link}}\n\nChampion Academy",
  reminderEmailSubject: "提醒｜{{event}} 即将开始",
  reminderEmailBody: "Hi {{name}}，\n\n提醒您，{{event}} 将在 {{date}} {{time}} 开始。\n\nZoom 链接：{{zoom_link}}\n\nChampion Academy",
  updatedAt: "",
};

// ──────────────────────────────────────────
// Firebase Firestore Cloud Storage
// All data is synced to Google Firebase cloud.
// SECURITY: Google sign-in is the portable administrator identity. Existing
// browser-only administrators may continue anonymously until they link that
// authorized UID to Google from Mailbox. New devices then sign in with the same
// Google account and receive the same Firebase UID and allowlist permissions.
// ──────────────────────────────────────────
let _db = null;
let _storage = null;
let _authUser = null;

function waitForInitialFirebaseUser(auth, timeoutMs = 5000) {
  return new Promise(resolve => {
    let settled = false;
    let unsubscribe = () => {};
    const timeout = window.setTimeout(() => finish(auth.currentUser || null), timeoutMs);
    function finish(user) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe();
      resolve(user || null);
    }
    unsubscribe = auth.onAuthStateChanged(finish, () => finish(null));
  });
}

function firebaseUserUsesGoogle(user) {
  return Boolean(user && !user.isAnonymous && (user.providerData || []).some(provider => provider?.providerId === "google.com"));
}

async function initFirebase() {
  if (!window.FIREBASE_CONFIG) return false;
  try {
    const fbApp = firebase.initializeApp(window.FIREBASE_CONFIG);

    // Preserve a Google administrator across restarts. Only create an anonymous
    // browser identity when this device has never signed in with Google.
    if (firebase.auth) {
      try {
        const auth = firebase.auth(fbApp);
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        _authUser = await waitForInitialFirebaseUser(auth);
        if (!_authUser) {
          const cred = await auth.signInAnonymously();
          _authUser = cred.user;
        }
        console.log(`[Firebase] Signed in with ${firebaseUserUsesGoogle(_authUser) ? 'Google administrator' : 'browser identity'}.`);
      } catch (authErr) {
        console.warn('[Firebase] Sign-in initialization failed:', authErr.message);
        // Continue without auth: app uses localStorage fallback. If rules are
        // deployed as auth-required, Firestore calls will fail and fall back.
      }
    }

    _db = firebase.firestore(fbApp);
    _db.enablePersistence().catch((err) => {
      console.warn('[Firebase] Offline persistence enable failed:', err.code);
    });
    try {
      _storage = firebase.storage(fbApp);
      console.log('[Firebase] Cloud Storage initialized.');
    } catch (storageErr) {
      console.warn('[Firebase] Cloud Storage failed to init:', storageErr);
    }
    console.log('[Firebase] Firestore connected' + (_authUser ? ' (authenticated).' : ' (NO AUTH).'));
    return true;
  } catch (e) {
    console.warn('[Firebase] Failed to init:', e);
    return false;
  }
}

async function fbSaveLead(lead) {
  if (!_db || !lead?.id) return;
  try { await _db.collection('leads').doc(lead.id).set(lead); } catch(e) { console.warn('fbSaveLead error:', e); }
}
async function fbDeleteLead(id) {
  if (!_db) return false;
  try {
    await _db.collection('leads').doc(id).delete();
    return true;
  } catch(e) {
    console.warn('fbDeleteLead error:', e);
    throw e;
  }
}
async function fbSaveLeadsBatch(leads) {
  if (!_db) return;
  const CHUNK_SIZE = 400;
  for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
    const chunk = leads.slice(i, i + CHUNK_SIZE);
    const batch = _db.batch();
    chunk.forEach(lead => {
      if (lead.id) {
        batch.set(_db.collection('leads').doc(lead.id), lead);
      }
    });
    try {
      await batch.commit();
    } catch (e) {
      console.warn('fbSaveLeadsBatch chunk error:', e);
    }
  }
}
async function fbDeleteLeadsBatch(ids, options = {}) {
  if (!_db) return false;
  const CHUNK_SIZE = 400;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const batch = _db.batch();
    chunk.forEach(id => {
      batch.delete(_db.collection('leads').doc(id));
    });
    try {
      await batch.commit();
    } catch (e) {
      console.warn('fbDeleteLeadsBatch chunk error:', e);
      if (options.throwOnError) throw e;
    }
  }
  return true;
}
async function fbSaveCollection(collectionName, items) {
  if (!_db) return;
  const CHUNK_SIZE = 400;
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const batch = _db.batch();
    chunk.forEach(item => { if (item.id) batch.set(_db.collection(collectionName).doc(item.id), item); });
    try { await batch.commit(); } catch(e) { console.warn('fbSaveCollection error:', e); }
  }
}
async function fbSaveConfig(docId, data) {
  if (!_db) return;
  try { await _db.collection('config').doc(docId).set(data); } catch(e) { console.warn('fbSaveConfig error:', e); }
}
async function fbSaveLayout() {
  if (!_db) return;
  const customGroups = loadJson("lead_center_custom_groups", []);
  const courseOrder = loadJson("lead_center_course_order", []);
  try {
    await _db.collection('config').doc('layout').set({ customGroups, courseOrder });
  } catch (e) {
    console.warn('fbSaveLayout error:', e);
  }
}

// ──────────────────────────────────────────
// Legacy Local File Storage (kept for offline fallback)
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
      zoomSettings: state.zoomSettings,
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
    if (data.zoomSettings) {
      state.zoomSettings = normalizeZoomSettings(data.zoomSettings);
      saveJson(storageKeys.zoomSettings, state.zoomSettings);
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
  courseSelectedIds: new Set(),
  selectedIds: new Set(),
  editingLeadId: null,
  previews: loadJson(storageKeys.previews, []),
  videos: loadJson(storageKeys.videos, []),
  zoomSettings: normalizeZoomSettings(loadJson(storageKeys.zoomSettings, defaultZoomSettings)),
};

const BULK_WHATSAPP_BATCH_SIZE = 10;
const whatsappBulkCore = globalThis.WhatsappBulkCore;
let bulkWhatsappPreviewState = {
  selectedCount: 0,
  selectedLeads: [],
  sendable: [],
  excluded: [],
  cursor: 0,
  template: "",
  imageFile: null,
  imagePreviewUrl: "",
  imageCopied: false,
  started: false,
};

if (!whatsappBulkCore) {
  throw new Error("WhatsApp bulk safety module failed to load.");
}

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
  bulkWhatsappModal: document.querySelector("#bulkWhatsappModal"),
  closeBulkWhatsappModal: document.querySelector("#closeBulkWhatsappModal"),
  cancelBulkWhatsapp: document.querySelector("#cancelBulkWhatsapp"),
  openBulkWhatsappBatch: document.querySelector("#openBulkWhatsappBatch"),
  bulkWhatsappConsent: document.querySelector("#bulkWhatsappConsent"),
  bulkWhatsappSelectedCount: document.querySelector("#bulkWhatsappSelectedCount"),
  bulkWhatsappValidCount: document.querySelector("#bulkWhatsappValidCount"),
  bulkWhatsappExcludedCount: document.querySelector("#bulkWhatsappExcludedCount"),
  bulkWhatsappBatchCount: document.querySelector("#bulkWhatsappBatchCount"),
  bulkWhatsappBatchTitle: document.querySelector("#bulkWhatsappBatchTitle"),
  bulkWhatsappBatchSummary: document.querySelector("#bulkWhatsappBatchSummary"),
  bulkWhatsappPreviewBody: document.querySelector("#bulkWhatsappPreviewBody"),
  bulkWhatsappExcludedDetails: document.querySelector("#bulkWhatsappExcludedDetails"),
  bulkWhatsappExcludedSummary: document.querySelector("#bulkWhatsappExcludedSummary"),
  bulkWhatsappExcludedList: document.querySelector("#bulkWhatsappExcludedList"),
  bulkWhatsappMessagePreview: document.querySelector("#bulkWhatsappMessagePreview"),
  bulkWhatsappMessageInput: document.querySelector("#bulkWhatsappMessageInput"),
  bulkWhatsappEmojiButtons: document.querySelectorAll("[data-wa-emoji]"),
  bulkWhatsappEncodingWarning: document.querySelector("#bulkWhatsappEncodingWarning"),
  bulkWhatsappEncodingWarningText: document.querySelector("#bulkWhatsappEncodingWarningText"),
  removeBulkWhatsappBrokenChars: document.querySelector("#removeBulkWhatsappBrokenChars"),
  saveBulkWhatsappMessage: document.querySelector("#saveBulkWhatsappMessage"),
  bulkWhatsappImageInput: document.querySelector("#bulkWhatsappImageInput"),
  bulkWhatsappImagePreview: document.querySelector("#bulkWhatsappImagePreview"),
  bulkWhatsappImageThumb: document.querySelector("#bulkWhatsappImageThumb"),
  bulkWhatsappImageSummary: document.querySelector("#bulkWhatsappImageSummary"),
  bulkWhatsappImageStatus: document.querySelector("#bulkWhatsappImageStatus"),
  copyBulkWhatsappImage: document.querySelector("#copyBulkWhatsappImage"),
  removeBulkWhatsappImage: document.querySelector("#removeBulkWhatsappImage"),
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
  emailInput: document.querySelector("#emailInput"),
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
  perfClosing: document.querySelector("#perfClosing"),
  saveZoomSettingsBtn: document.querySelector("#saveZoomSettingsBtn"),
  copyZoomLinkBtn: document.querySelector("#copyZoomLinkBtn"),
  newZoomEventBtn: document.querySelector("#newZoomEventBtn"),
  zoomAdminDashboard: document.querySelector("#zoomAdminDashboard"),
  zoomEventPicker: document.querySelector("#zoomEventPicker"),
  zoomEventId: document.querySelector("#zoomEventId"),
  zoomEventName: document.querySelector("#zoomEventName"),
  zoomEventSubtitle: document.querySelector("#zoomEventSubtitle"),
  zoomSpeakerName: document.querySelector("#zoomSpeakerName"),
  zoomSeatLimit: document.querySelector("#zoomSeatLimit"),
  zoomEventDate: document.querySelector("#zoomEventDate"),
  zoomEventTime: document.querySelector("#zoomEventTime"),
  zoomEventStatus: document.querySelector("#zoomEventStatus"),
  zoomRegistrationUrl: document.querySelector("#zoomRegistrationUrl"),
  zoomSendWhatsapp: document.querySelector("#zoomSendWhatsapp"),
  zoomSendEmail: document.querySelector("#zoomSendEmail"),
  zoomWhatsappTemplateName: document.querySelector("#zoomWhatsappTemplateName"),
  zoomWhatsappReminderTemplateName: document.querySelector("#zoomWhatsappReminderTemplateName"),
  zoomWhatsappMessage: document.querySelector("#zoomWhatsappMessage"),
  zoomEmailSubject: document.querySelector("#zoomEmailSubject"),
  zoomEmailBody: document.querySelector("#zoomEmailBody"),
  zoomReminderEmailSubject: document.querySelector("#zoomReminderEmailSubject"),
  zoomReminderEmailBody: document.querySelector("#zoomReminderEmailBody"),
  zoomLinkStatus: document.querySelector("#zoomLinkStatus"),
  zoomUpdatedAt: document.querySelector("#zoomUpdatedAt"),
  zoomRegistrationCount: document.querySelector("#zoomRegistrationCount"),
  zoomDeliveryStatus: document.querySelector("#zoomDeliveryStatus"),
  zoomDeliveryNote: document.querySelector("#zoomDeliveryNote"),
  zoomSaveState: document.querySelector("#zoomSaveState"),
  zoomRegistrationsBody: document.querySelector("#zoomRegistrationsBody"),
  refreshZoomDataBtn: document.querySelector("#refreshZoomDataBtn"),
  emailCampaignListBody: document.querySelector("#emailCampaignListBody"),
  emailAdminAuthPanel: document.querySelector("#emailAdminAuthPanel"),
  emailAdminAuthTitle: document.querySelector("#emailAdminAuthTitle"),
  emailAdminAuthStatus: document.querySelector("#emailAdminAuthStatus"),
  emailAdminSignInBtn: document.querySelector("#emailAdminSignInBtn"),
  emailAdminSignOutBtn: document.querySelector("#emailAdminSignOutBtn"),
  emailRefreshCampaignsBtn: document.querySelector("#emailRefreshCampaignsBtn"),
  emailNewCampaignBtn: document.querySelector("#emailNewCampaignBtn"),
  emailCampaignId: document.querySelector("#emailCampaignId"),
  emailCampaignName: document.querySelector("#emailCampaignName"),
  emailCampaignSubject: document.querySelector("#emailCampaignSubject"),
  emailCampaignPreview: document.querySelector("#emailCampaignPreview"),
  emailCampaignBody: document.querySelector("#emailCampaignBody"),
  emailCampaignCtaLabel: document.querySelector("#emailCampaignCtaLabel"),
  emailCampaignCtaUrl: document.querySelector("#emailCampaignCtaUrl"),
  emailDraftState: document.querySelector("#emailDraftState"),
  emailAppendRecipientsBtn: document.querySelector("#emailAppendRecipientsBtn"),
  emailSaveDraftBtn: document.querySelector("#emailSaveDraftBtn"),
  emailSendTestBtn: document.querySelector("#emailSendTestBtn"),
  emailAudienceSourceFilter: document.querySelector("#emailAudienceSourceFilter"),
  emailAudienceSearch: document.querySelector("#emailAudienceSearch"),
  emailAudienceSelectAll: document.querySelector("#emailAudienceSelectAll"),
  emailAudienceSummary: document.querySelector("#emailAudienceSummary"),
  emailAudienceBody: document.querySelector("#emailAudienceBody"),
  emailPreviewAudienceBtn: document.querySelector("#emailPreviewAudienceBtn"),
  emailAudienceAudit: document.querySelector("#emailAudienceAudit"),
  emailConsentConfirmed: document.querySelector("#emailConsentConfirmed"),
  emailStartCampaignBtn: document.querySelector("#emailStartCampaignBtn"),
  emailStartRequirement: document.querySelector("#emailStartRequirement"),
  emailProviderNote: document.querySelector("#emailProviderNote"),
  emailPauseCampaignBtn: document.querySelector("#emailPauseCampaignBtn"),
  emailSendProgress: document.querySelector("#emailSendProgress"),
  emailReportCard: document.querySelector("#emailReportCard"),
  emailReportTitle: document.querySelector("#emailReportTitle"),
  emailRefreshReportBtn: document.querySelector("#emailRefreshReportBtn"),
  emailExportReportBtn: document.querySelector("#emailExportReportBtn"),
  emailReportStats: document.querySelector("#emailReportStats"),
  emailReportStatusFilter: document.querySelector("#emailReportStatusFilter"),
  emailReportSearch: document.querySelector("#emailReportSearch"),
  emailReportBody: document.querySelector("#emailReportBody")
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
  // Also sync to Firebase if connected
  if (_db) {
    if (key === storageKeys.leads) {
      // Leads are individually synced via saveLead/removeLead — skip batch here
    } else if (key === storageKeys.previews) {
      fbSaveCollection('previews', value).catch(()=>{});
    } else if (key === storageKeys.videos) {
      fbSaveCollection('videos', value).catch(()=>{});
    } else if (key === storageKeys.templates) {
      fbSaveConfig('templates', value).catch(()=>{});
    } else if (key === storageKeys.zoomSettings) {
      fbSaveConfig('zoom', value).catch(()=>{});
    }
  }
}

const zoomAdminApiOverride = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? new URLSearchParams(location.search).get("zoom_api_base")
  : "";
const ZOOM_FUNCTIONS_BASE_URL = String(zoomAdminApiOverride || window.ZOOM_PUBLIC_CONFIG?.functionsBaseUrl || "").replace(/\/$/, "");
const ZOOM_SINGLE_ENDPOINT = !zoomAdminApiOverride && window.ZOOM_PUBLIC_CONFIG?.singleEndpoint === true;
const zoomAdminState = { events: [], registrations: [], legacy: null, service: {}, selectedId: "", loaded: false, authorized: false, currentUid: "" };
const EMAIL_CAMPAIGN_API_URL = String(window.EMAIL_CAMPAIGN_CONFIG?.apiBaseUrl || "").replace(/\/$/, "");
const emailCampaignState = {
  initialized: false,
  loading: false,
  initPromise: null,
  dirty: false,
  campaigns: [],
  candidates: [],
  selectedKeys: new Set(),
  activeCampaign: null,
  audienceAudit: null,
  report: null,
  service: null,
  sending: false,
  appendMode: false
};

function updateEmailAdminAuthUi(message = "") {
  if (!elements.emailAdminAuthPanel) return;
  const user = _authUser || window.firebase?.auth?.().currentUser || null;
  const googleAdmin = firebaseUserUsesGoogle(user);
  elements.emailAdminAuthPanel.classList.toggle("is-google", googleAdmin);
  elements.emailAdminAuthTitle.textContent = googleAdmin ? "Google 管理员账号已登录" : "Email 管理员账号";
  elements.emailAdminAuthStatus.textContent = message || (googleAdmin
    ? "这项登录可以在电脑 Chrome 与手机沿用；其他设备请使用同一个 Google 账号。"
    : user?.isAnonymous
      ? "目前是只属于这个浏览器的临时身份。请绑定 Google 管理员账号，才能在手机或其他 Chrome 使用。"
      : "请使用获授权的 Google 管理员账号登录。"
  );
  elements.emailAdminSignInBtn.hidden = googleAdmin;
  elements.emailAdminSignOutBtn.hidden = !googleAdmin;
}

async function signInEmailAdminWithGoogle() {
  const auth = window.firebase?.auth?.();
  if (!auth || !window.firebase?.auth?.GoogleAuthProvider) {
    toast("❌ Google 管理员登录尚未载入，请刷新页面再试");
    return;
  }
  const button = elements.emailAdminSignInBtn;
  button.disabled = true;
  button.textContent = "正在打开 Google 登录…";
  updateEmailAdminAuthUi("请选择 Champion Academy 的管理员 Google 账号。");
  try {
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const current = auth.currentUser;
    let result;
    if (current?.isAnonymous) {
      try {
        result = await current.linkWithPopup(provider);
      } catch (error) {
        if (error?.code !== "auth/credential-already-in-use") throw error;
        const credential = error.credential || firebase.auth.GoogleAuthProvider.credentialFromError?.(error);
        if (!credential) throw error;
        result = await auth.signInWithCredential(credential);
      }
    } else {
      result = await auth.signInWithPopup(provider);
    }
    _authUser = result.user;
    updateEmailAdminAuthUi("登录成功，正在重新读取云端资料…");
    toast("✅ Google 管理员账号登录成功");
    window.setTimeout(() => window.location.reload(), 500);
  } catch (error) {
    const cancelled = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(error?.code);
    const providerDisabled = error?.code === "auth/operation-not-allowed";
    updateEmailAdminAuthUi(providerDisabled
      ? "Firebase 尚未启用 Google 登录，请先完成管理员设置。"
      : cancelled
        ? "Google 登录已取消；需要时可以重新点击登录。"
        : "Google 登录失败，请确认弹出窗口没有被封锁后重试。"
    );
    if (!cancelled) console.error("Email administrator Google sign-in failed:", error);
  } finally {
    button.disabled = false;
    button.textContent = "使用 Google 管理员账号登录";
  }
}

async function signOutEmailAdminGoogle() {
  if (!confirm("退出后，这台设备将无法读取客户和 Email Campaign，直到再次登录。确定退出吗？")) return;
  try {
    await window.firebase?.auth?.().signOut();
    _authUser = null;
    window.location.reload();
  } catch (error) {
    toast("❌ 无法退出管理员账号，请稍后再试");
  }
}

function normalizeZoomSettings(value) {
  const data = value && typeof value === "object" ? value : {};
  return {
    eventName: clean(data.title || data.eventName),
    subtitle: clean(data.subtitle),
    speakerName: clean(data.speakerName),
    eventDate: clean(data.eventDate),
    eventTime: clean(data.eventTime),
    registrationUrl: clean(data.joinUrl || data.registrationUrl),
    status: ["draft", "published", "closed"].includes(data.status) ? data.status : "draft",
    seatLimit: Math.max(0, Number(data.seatLimit) || 0),
    sendWhatsapp: data.sendWhatsapp !== false,
    sendEmail: data.sendEmail !== false,
    whatsappTemplateName: clean(data.whatsappTemplateName) || defaultZoomSettings.whatsappTemplateName,
    whatsappReminderTemplateName: clean(data.whatsappReminderTemplateName) || defaultZoomSettings.whatsappReminderTemplateName,
    whatsappMessage: clean(data.whatsappMessage) || defaultZoomSettings.whatsappMessage,
    emailSubject: clean(data.emailSubject) || defaultZoomSettings.emailSubject,
    emailBody: clean(data.emailBody) || defaultZoomSettings.emailBody,
    reminderEmailSubject: clean(data.reminderEmailSubject) || defaultZoomSettings.reminderEmailSubject,
    reminderEmailBody: clean(data.reminderEmailBody) || defaultZoomSettings.reminderEmailBody,
    updatedAt: clean(data.updatedAt),
  };
}

function zoomApiUrl(name) {
  if (!ZOOM_FUNCTIONS_BASE_URL) throw new Error("Zoom 云端服务尚未设置");
  return ZOOM_SINGLE_ENDPOINT
    ? `${ZOOM_FUNCTIONS_BASE_URL}?action=${encodeURIComponent(name)}`
    : `${ZOOM_FUNCTIONS_BASE_URL}/${name}`;
}

async function zoomAdminRequest(name, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!zoomAdminApiOverride) {
    const token = await zoomFirebaseAdminToken();
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(zoomApiUrl(name), { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) zoomAdminState.authorized = false;
    throw new Error(data.error || "Zoom 后台操作失败");
  }
  return data;
}

async function zoomFirebaseAdminToken() {
  const auth = window.firebase?.auth?.();
  let user = _authUser || auth?.currentUser || null;
  if (!user && auth) {
    user = await new Promise(resolve => {
      const timeout = window.setTimeout(() => resolve(null), 5000);
      let unsubscribe = () => {};
      unsubscribe = auth.onAuthStateChanged(current => {
        if (!current) return;
        window.clearTimeout(timeout);
        unsubscribe();
        resolve(current);
      });
    });
  }
  if (user) {
    zoomAdminState.currentUid = user.uid;
    window.__zoomAdminUid = user.uid;
    return user.getIdToken();
  }

  // Some browsers block the Firebase CDN. Keep the no-password admin flow
  // working through Firebase's official anonymous-auth REST endpoints.
  const apiKey = clean(window.FIREBASE_CONFIG?.apiKey);
  if (!apiKey) throw new Error("无法确认管理员浏览器，请刷新页面再试");
  const storageKey = "champZoomAdminIdentityV1";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { saved = {}; }

  let identity;
  if (saved.refreshToken) {
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: saved.refreshToken })
    });
    identity = await response.json().catch(() => ({}));
    if (response.ok) {
      identity = {
        idToken: identity.id_token,
        refreshToken: identity.refresh_token,
        localId: identity.user_id
      };
    } else {
      localStorage.removeItem(storageKey);
      identity = null;
    }
  }

  if (!identity?.idToken) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true })
    });
    identity = await response.json().catch(() => ({}));
    if (!response.ok || !identity.idToken) throw new Error("无法建立管理员浏览器身份，请稍后再试");
  }

  localStorage.setItem(storageKey, JSON.stringify({ localId: identity.localId, refreshToken: identity.refreshToken }));
  zoomAdminState.currentUid = identity.localId;
  window.__zoomAdminUid = identity.localId;
  return identity.idToken;
}

function zoomDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-MY", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function fillZoomEventForm(event = {}) {
  const settings = normalizeZoomSettings(event);
  elements.zoomEventId.value = clean(event.id);
  elements.zoomEventName.value = settings.eventName;
  elements.zoomEventSubtitle.value = settings.subtitle;
  elements.zoomSpeakerName.value = settings.speakerName;
  elements.zoomSeatLimit.value = settings.seatLimit || "";
  elements.zoomEventDate.value = settings.eventDate;
  elements.zoomEventTime.value = settings.eventTime;
  elements.zoomEventStatus.value = settings.status;
  elements.zoomRegistrationUrl.value = settings.registrationUrl;
  elements.zoomSendWhatsapp.checked = settings.sendWhatsapp;
  elements.zoomSendEmail.checked = settings.sendEmail;
  elements.zoomWhatsappTemplateName.value = settings.whatsappTemplateName;
  elements.zoomWhatsappReminderTemplateName.value = settings.whatsappReminderTemplateName;
  elements.zoomWhatsappMessage.value = settings.whatsappMessage;
  elements.zoomEmailSubject.value = settings.emailSubject;
  elements.zoomEmailBody.value = settings.emailBody;
  elements.zoomReminderEmailSubject.value = settings.reminderEmailSubject;
  elements.zoomReminderEmailBody.value = settings.reminderEmailBody;
  elements.copyZoomLinkBtn.disabled = !settings.registrationUrl;
}

function zoomDeliveryBadge(status) {
  const safeStatus = ["sent", "failed", "disabled", "pending"].includes(status) ? status : "pending";
  const labels = { sent: "已发送", failed: "失败", disabled: "未启用", pending: "处理中" };
  return `<span class="zoom-delivery-badge ${safeStatus}">${labels[safeStatus]}</span>`;
}

function renderZoomRegistrations() {
  const eventTitles = Object.fromEntries(zoomAdminState.events.map(event => [event.id, event.title]));
  elements.zoomRegistrationsBody.innerHTML = zoomAdminState.registrations.length
    ? zoomAdminState.registrations.map(registration => {
        const confirmation = registration.deliveries?.confirmation || {};
        return `<tr>
          <td><strong>${escapeHtml(registration.name)}</strong><small>${escapeHtml(registration.phone)} · ${escapeHtml(registration.email)}</small></td>
          <td>${escapeHtml(eventTitles[registration.eventId] || "已归档活动")}</td>
          <td>${escapeHtml(zoomDateTime(registration.createdAt))}</td>
          <td>${zoomDeliveryBadge(confirmation.whatsapp)}</td>
          <td>${zoomDeliveryBadge(confirmation.email)}</td>
          <td><button class="text-button zoom-resend-btn" data-registration-id="${escapeHtml(registration.id)}" type="button">重新发送</button></td>
        </tr>`;
      }).join("")
    : '<tr><td colspan="6" class="muted">还没有报名记录</td></tr>';
}

function renderZoomSettings() {
  if (!elements.zoomAdminDashboard) return;
  elements.zoomAdminDashboard.hidden = false;
  elements.newZoomEventBtn.disabled = false;
  if (!zoomAdminState.loaded) return;

  const currentValue = zoomAdminState.selectedId;
  elements.zoomEventPicker.innerHTML = '<option value="">建立新活动</option>' + zoomAdminState.events.map(event =>
    `<option value="${escapeHtml(event.id)}">${escapeHtml(event.title)} · ${event.status === "published" ? "报名中" : event.status === "closed" ? "已关闭" : "草稿"}</option>`
  ).join("");
  elements.zoomEventPicker.value = currentValue;

  const selected = zoomAdminState.events.find(event => event.id === currentValue) || null;
  if (selected) fillZoomEventForm(selected);
  else if (!elements.zoomEventName.value) fillZoomEventForm(zoomAdminState.events.length ? {} : (zoomAdminState.legacy || state.zoomSettings));

  const published = zoomAdminState.events.find(event => event.status === "published") || null;
  elements.zoomLinkStatus.textContent = published ? published.title : "没有发布中的活动";
  elements.zoomLinkStatus.style.color = published ? "var(--brand)" : "#c05621";
  elements.zoomUpdatedAt.textContent = published ? `开始：${zoomDateTime(published.startsAt)}` : "请建立或选择活动";
  elements.zoomRegistrationCount.textContent = String(zoomAdminState.registrations.length);
  const servicesReady = zoomAdminState.service.whatsappConfigured && zoomAdminState.service.emailConfigured;
  elements.zoomDeliveryStatus.textContent = servicesReady ? "已连接" : "等待配置";
  elements.zoomDeliveryStatus.classList.toggle("status-pending", !servicesReady);
  elements.zoomDeliveryNote.textContent = servicesReady ? "WhatsApp 与 Email 可自动发送" : "完成 Meta 与 Resend 设置后启用";
  renderZoomRegistrations();
}

async function loadZoomAdminData() {
  if (elements.zoomSaveState) elements.zoomSaveState.textContent = "正在读取最新资料…";
  try {
    const data = await zoomAdminRequest("adminZoomData");
    zoomAdminState.events = Array.isArray(data.events) ? data.events : [];
    zoomAdminState.registrations = Array.isArray(data.registrations) ? data.registrations : [];
    zoomAdminState.legacy = data.legacy || null;
    zoomAdminState.service = data.service || {};
    if (!zoomAdminState.selectedId) {
      zoomAdminState.selectedId = (zoomAdminState.events.find(event => event.status === "published") || zoomAdminState.events[0] || {}).id || "";
    }
    zoomAdminState.authorized = true;
    zoomAdminState.loaded = true;
    elements.zoomSaveState.textContent = `最后读取：${new Intl.DateTimeFormat("zh-MY", { timeStyle: "short" }).format(new Date())}`;
    renderZoomSettings();
  } catch (error) {
    zoomAdminState.authorized = false;
    zoomAdminState.loaded = false;
    if (!elements.zoomEventName.value) fillZoomEventForm(state.zoomSettings || defaultZoomSettings);
    if (elements.zoomSaveState) elements.zoomSaveState.textContent = "云端资料尚未连接";
    renderZoomSettings();
  }
}

async function initZoomAdmin() {
  if (!elements.zoomEventName.value) fillZoomEventForm(state.zoomSettings || defaultZoomSettings);
  renderZoomSettings();
  if (!zoomAdminState.loaded) await loadZoomAdminData();
}

function newZoomEvent() {
  zoomAdminState.selectedId = "";
  elements.zoomEventPicker.value = "";
  fillZoomEventForm(defaultZoomSettings);
  elements.zoomSaveState.textContent = "正在建立新活动";
  elements.zoomEventName.focus();
}

function zoomUrlIsValid(value) {
  if (!value) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

async function saveZoomSettings() {
  const joinUrl = elements.zoomRegistrationUrl.value.trim();
  if (!zoomUrlIsValid(joinUrl)) {
    alert("请输入以 https:// 开头的完整 Zoom 链接。");
    elements.zoomRegistrationUrl.focus();
    return;
  }
  if (!elements.zoomEventName.value.trim() || !elements.zoomEventDate.value || !elements.zoomEventTime.value) {
    toast("请填写活动名称、日期和时间");
    return;
  }

  const payload = {
    id: elements.zoomEventId.value,
    title: elements.zoomEventName.value,
    subtitle: elements.zoomEventSubtitle.value,
    speakerName: elements.zoomSpeakerName.value,
    seatLimit: Number(elements.zoomSeatLimit.value) || 0,
    eventDate: elements.zoomEventDate.value,
    eventTime: elements.zoomEventTime.value,
    status: elements.zoomEventStatus.value,
    joinUrl,
    sendWhatsapp: elements.zoomSendWhatsapp.checked,
    sendEmail: elements.zoomSendEmail.checked,
    whatsappTemplateName: elements.zoomWhatsappTemplateName.value,
    whatsappReminderTemplateName: elements.zoomWhatsappReminderTemplateName.value,
    whatsappMessage: elements.zoomWhatsappMessage.value,
    emailSubject: elements.zoomEmailSubject.value,
    emailBody: elements.zoomEmailBody.value,
    reminderEmailSubject: elements.zoomReminderEmailSubject.value,
    reminderEmailBody: elements.zoomReminderEmailBody.value
  };

  elements.saveZoomSettingsBtn.disabled = true;
  elements.saveZoomSettingsBtn.textContent = "保存中…";
  try {
    const data = await zoomAdminRequest("saveZoomEvent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    zoomAdminState.selectedId = data.event.id;
    elements.zoomSaveState.textContent = "活动已保存";
    await loadZoomAdminData();
    toast(data.event.status === "published" ? "✅ 活动已发布，报名页现在开放" : "✅ Zoom 活动已保存");
  } catch (error) {
    toast(`❌ ${error.message}`);
  } finally {
    elements.saveZoomSettingsBtn.disabled = false;
    elements.saveZoomSettingsBtn.textContent = "保存活动";
  }
}

async function copyZoomLink() {
  const value = elements.zoomRegistrationUrl.value.trim();
  if (!value) return toast("请先加入 Zoom 链接");
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    elements.zoomRegistrationUrl.focus();
    elements.zoomRegistrationUrl.select();
    document.execCommand("copy");
  }
  toast("✅ Zoom 链接已复制");
}

async function resendZoomRegistration(registrationId) {
  if (!confirm("确定要重新发送本场 Zoom 资料到这位客户的 WhatsApp 与 Email？")) return;
  try {
    await zoomAdminRequest("resendZoomNotification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationId, stage: "confirmation" })
    });
    toast("✅ 已完成重新发送");
    await loadZoomAdminData();
  } catch (error) {
    toast(`❌ ${error.message}`);
  }
}

// Smart lead save — writes individual lead doc to Firebase
function saveLead(lead) {
  const arr = state.leads;
  saveJson(storageKeys.leads, arr);
  fbSaveLead(lead).catch(()=>{});
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
  // Sync all current leads to Firebase (covers both new additions and merged updates)
  fbSaveLeadsBatch(state.leads).catch(()=>{});
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
  const phone = whatsappBulkCore.normalizeMalaysiaPhone(lead.phone);
  if (!phone.valid) {
    toast("电话号码格式无效，请先更新客户资料。");
    return;
  }
  window.open(whatsappBulkCore.whatsappUrl(phone.phone, text), "_blank");
  addHistory(leadId, "whatsapp", `Sent Template ${templateNum}`);
}

function whatsappUrl(lead, step) {
  const templateKey = step ? `waTemplate${step}` : 'waTemplate1';
  const template = state.templates[templateKey] || state.templates.waTemplate1;
  const text = applyTemplate(template, lead);
  const phone = whatsappBulkCore.normalizeMalaysiaPhone(lead.phone);
  return phone.valid ? whatsappBulkCore.whatsappUrl(phone.phone, text) : "";
}

function emailUrl(lead) {
  const subject = applyTemplate(state.templates.emailSubject, lead);
  const body = applyTemplate(state.templates.emailBody, lead);
  return `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function bulkWhatsapp() {
  const selectedLeads = state.leads.filter((lead) => state.selectedIds.has(lead.id));
  if (!selectedLeads.length) {
    toast("请先勾选至少一位客户。");
    return;
  }

  const template = state.templates.bulkWhatsapp || defaultTemplates.bulkWhatsapp;
  cleanupBulkWhatsappImage();

  bulkWhatsappPreviewState = {
    selectedCount: selectedLeads.length,
    selectedLeads,
    sendable: [],
    excluded: [],
    cursor: 0,
    template,
    imageFile: null,
    imagePreviewUrl: "",
    imageCopied: false,
    started: false,
  };

  elements.bulkWhatsappMessageInput.value = template;
  elements.bulkWhatsappImageInput.value = "";
  elements.bulkWhatsappConsent.checked = false;
  rebuildBulkWhatsappAudience();
  renderBulkWhatsappPreview();
  elements.bulkWhatsappModal.classList.add("show");
}

function rebuildBulkWhatsappAudience() {
  const audience = whatsappBulkCore.prepareAudience(
    bulkWhatsappPreviewState.selectedLeads,
    (lead) => applyTemplate(bulkWhatsappPreviewState.template, lead),
  );
  bulkWhatsappPreviewState.sendable = audience.sendable;
  bulkWhatsappPreviewState.excluded = audience.excluded;
}

function currentBulkWhatsappBatch() {
  return whatsappBulkCore.getBatch(
    bulkWhatsappPreviewState.sendable,
    bulkWhatsappPreviewState.cursor,
    BULK_WHATSAPP_BATCH_SIZE,
  );
}

function renderBulkWhatsappPreview() {
  const batch = currentBulkWhatsappBatch();
  const totalBatches = Math.ceil(bulkWhatsappPreviewState.sendable.length / BULK_WHATSAPP_BATCH_SIZE);
  const remainingBatches = batch.items.length
    ? Math.ceil((bulkWhatsappPreviewState.sendable.length - bulkWhatsappPreviewState.cursor) / BULK_WHATSAPP_BATCH_SIZE)
    : 0;

  elements.bulkWhatsappSelectedCount.textContent = String(bulkWhatsappPreviewState.selectedCount);
  elements.bulkWhatsappValidCount.textContent = String(bulkWhatsappPreviewState.sendable.length);
  elements.bulkWhatsappExcludedCount.textContent = String(bulkWhatsappPreviewState.excluded.length);
  elements.bulkWhatsappBatchCount.textContent = String(remainingBatches);
  elements.bulkWhatsappBatchTitle.textContent = batch.items.length
    ? `第 ${batch.batchNumber} 批／共 ${totalBatches} 批`
    : "没有可打开的号码";
  elements.bulkWhatsappBatchSummary.textContent = batch.items.length
    ? `本批 ${batch.items.length} 人；完成后还有 ${batch.remaining} 人。电话号码只显示脱敏版本。`
    : "请修正已排除客户的电话号码后再试。";

  elements.bulkWhatsappPreviewBody.innerHTML = batch.items.length
    ? batch.items.map((entry) => `
        <tr>
          <td><strong>${escapeHtml(entry.lead.name || "未命名客户")}</strong></td>
          <td>${escapeHtml(entry.lead.course || "General Preview")}</td>
          <td>${escapeHtml(entry.maskedPhone)}</td>
          <td>${entry.normalized
            ? '<span class="bulk-wa-normalized">已自动补 60</span>'
            : '<span class="bulk-wa-unchanged">号码无需修改</span>'}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="4" class="muted">本批没有有效电话号码。</td></tr>';

  const hasExcluded = bulkWhatsappPreviewState.excluded.length > 0;
  elements.bulkWhatsappExcludedDetails.hidden = !hasExcluded;
  elements.bulkWhatsappExcludedSummary.textContent = `查看 ${bulkWhatsappPreviewState.excluded.length} 位已排除客户`;
  elements.bulkWhatsappExcludedList.innerHTML = hasExcluded
    ? bulkWhatsappPreviewState.excluded.map((entry) =>
        `<li>${escapeHtml(entry.lead?.name || "未命名客户")}：${escapeHtml(entry.reason)}</li>`,
      ).join("")
    : "";

  elements.bulkWhatsappMessagePreview.textContent = batch.items[0]?.message || "—";
  renderBulkWhatsappComposer();
  elements.openBulkWhatsappBatch.textContent = `打开本批 ${batch.items.length} 个聊天`;
  updateBulkWhatsappOpenButton();
}

function formatBulkWhatsappImageSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderBulkWhatsappComposer() {
  const hasImage = Boolean(bulkWhatsappPreviewState.imageFile);
  const locked = bulkWhatsappPreviewState.started;
  const encoding = whatsappBulkCore.inspectMessageEncoding(bulkWhatsappPreviewState.template);
  elements.bulkWhatsappMessageInput.disabled = locked;
  elements.saveBulkWhatsappMessage.disabled = locked || !encoding.valid;
  elements.bulkWhatsappEmojiButtons.forEach((button) => { button.disabled = locked; });
  elements.bulkWhatsappEncodingWarning.hidden = encoding.valid;
  elements.bulkWhatsappEncodingWarningText.textContent = encoding.valid
    ? ""
    : `发现 ${encoding.replacementCount} 个损坏符号（�）。无法判断原来的 Emoji，请先清除并重新插入。`;
  elements.bulkWhatsappImageInput.disabled = locked;
  elements.removeBulkWhatsappImage.disabled = locked;
  elements.bulkWhatsappImagePreview.hidden = !hasImage;

  if (!hasImage) return;
  const file = bulkWhatsappPreviewState.imageFile;
  elements.bulkWhatsappImageThumb.src = bulkWhatsappPreviewState.imagePreviewUrl;
  elements.bulkWhatsappImageSummary.textContent = `${file.type.replace("image/", "").toUpperCase()} · ${formatBulkWhatsappImageSize(file.size)}`;
  elements.bulkWhatsappImageStatus.textContent = bulkWhatsappPreviewState.imageCopied
    ? "图片已复制。本批每个聊天都需要粘贴一次。"
    : "打开本批聊天前，请先复制图片。";
  elements.copyBulkWhatsappImage.textContent = bulkWhatsappPreviewState.imageCopied ? "重新复制图片" : "复制图片";
}

function handleBulkWhatsappMessageInput() {
  if (bulkWhatsappPreviewState.started) return;
  bulkWhatsappPreviewState.template = elements.bulkWhatsappMessageInput.value;
  rebuildBulkWhatsappAudience();
  renderBulkWhatsappPreview();
}

function insertBulkWhatsappEmoji(emoji) {
  if (bulkWhatsappPreviewState.started || !emoji) return;
  const input = elements.bulkWhatsappMessageInput;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.setRangeText(emoji, start, end, "end");
  handleBulkWhatsappMessageInput();
  input.focus();
}

function removeBulkWhatsappBrokenCharacters() {
  if (bulkWhatsappPreviewState.started) return;
  const input = elements.bulkWhatsappMessageInput;
  const encoding = whatsappBulkCore.inspectMessageEncoding(input.value);
  if (encoding.valid) return;
  input.value = encoding.message.replace(/\uFFFD/g, "");
  handleBulkWhatsappMessageInput();
  input.focus();
  toast(`已清除 ${encoding.replacementCount} 个损坏符号，请用 Emoji 按钮重新插入。`);
}

function saveBulkWhatsappMessageTemplate() {
  if (bulkWhatsappPreviewState.started) return;
  if (!whatsappBulkCore.inspectMessageEncoding(elements.bulkWhatsappMessageInput.value).valid) {
    toast("文案仍有损坏符号，请先清除并重新插入 Emoji。");
    return;
  }
  state.templates.bulkWhatsapp = elements.bulkWhatsappMessageInput.value;
  const settingsField = document.querySelector("#bulkWhatsapp");
  if (settingsField) settingsField.value = state.templates.bulkWhatsapp;
  saveJson(storageKeys.templates, state.templates);
  toast("已保存为默认 WhatsApp 群发文案。");
}

function cleanupBulkWhatsappImage() {
  if (bulkWhatsappPreviewState.imagePreviewUrl) {
    URL.revokeObjectURL(bulkWhatsappPreviewState.imagePreviewUrl);
  }
  if (elements.bulkWhatsappImageThumb) elements.bulkWhatsappImageThumb.removeAttribute("src");
}

function removeBulkWhatsappImage() {
  if (bulkWhatsappPreviewState.started) return;
  cleanupBulkWhatsappImage();
  bulkWhatsappPreviewState.imageFile = null;
  bulkWhatsappPreviewState.imagePreviewUrl = "";
  bulkWhatsappPreviewState.imageCopied = false;
  elements.bulkWhatsappImageInput.value = "";
  renderBulkWhatsappPreview();
}

function handleBulkWhatsappImageSelection(event) {
  if (bulkWhatsappPreviewState.started) return;
  const [file] = event.target.files;
  if (!file) return;

  const validation = whatsappBulkCore.validateImageFile(file);
  if (!validation.valid) {
    event.target.value = "";
    toast(validation.reason);
    return;
  }

  cleanupBulkWhatsappImage();
  bulkWhatsappPreviewState.imageFile = file;
  bulkWhatsappPreviewState.imagePreviewUrl = URL.createObjectURL(file);
  bulkWhatsappPreviewState.imageCopied = false;
  renderBulkWhatsappPreview();
}

async function imageFileToPngBlob(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("图片转换失败"));
    }, "image/png");
  });
}

async function copyBulkWhatsappImage() {
  const file = bulkWhatsappPreviewState.imageFile;
  if (!file) return;
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    toast("此浏览器无法复制图片，请使用 Chrome 并允许剪贴板权限。");
    return;
  }

  elements.copyBulkWhatsappImage.disabled = true;
  elements.copyBulkWhatsappImage.textContent = "正在复制…";
  try {
    const pngBlob = await imageFileToPngBlob(file);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    bulkWhatsappPreviewState.imageCopied = true;
    toast("图片已复制；请在每个 WhatsApp 聊天粘贴一次。");
  } catch (error) {
    console.error("Copy WhatsApp image failed:", error);
    bulkWhatsappPreviewState.imageCopied = false;
    toast("图片复制失败，请允许剪贴板权限后重试。");
  } finally {
    elements.copyBulkWhatsappImage.disabled = false;
    renderBulkWhatsappComposer();
    updateBulkWhatsappOpenButton();
  }
}

function updateBulkWhatsappOpenButton() {
  const batch = currentBulkWhatsappBatch();
  const imageReady = !bulkWhatsappPreviewState.imageFile || bulkWhatsappPreviewState.imageCopied;
  const messageReady = whatsappBulkCore.inspectMessageEncoding(bulkWhatsappPreviewState.template).valid;
  elements.openBulkWhatsappBatch.disabled = !batch.items.length || !elements.bulkWhatsappConsent.checked || !imageReady || !messageReady;
  elements.openBulkWhatsappBatch.title = !messageReady
    ? "文案包含损坏符号，请先清除并重新插入 Emoji"
    : imageReady ? "" : "请先复制所选图片";
}

function closeBulkWhatsappPreview() {
  elements.bulkWhatsappModal.classList.remove("show");
  elements.bulkWhatsappConsent.checked = false;
  cleanupBulkWhatsappImage();
  bulkWhatsappPreviewState.imageFile = null;
  bulkWhatsappPreviewState.imagePreviewUrl = "";
  bulkWhatsappPreviewState.imageCopied = false;
}

function openBulkWhatsappBatch() {
  const batch = currentBulkWhatsappBatch();
  if (!whatsappBulkCore.inspectMessageEncoding(bulkWhatsappPreviewState.template).valid) {
    toast("文案包含损坏符号，请先清除并重新插入 Emoji。");
    return;
  }
  if (!elements.bulkWhatsappConsent.checked || !batch.items.length) return;

  batch.items.forEach((entry) => {
    window.open(entry.url, "_blank", "noopener,noreferrer");
  });

  bulkWhatsappPreviewState.started = true;
  bulkWhatsappPreviewState.imageCopied = false;
  bulkWhatsappPreviewState.cursor = batch.nextCursor;
  if (batch.remaining > 0) {
    elements.bulkWhatsappConsent.checked = false;
    renderBulkWhatsappPreview();
    toast(`已打开第 ${batch.batchNumber} 批 ${batch.items.length} 个聊天；请检查弹窗后再继续下一批。`);
    return;
  }

  closeBulkWhatsappPreview();
  toast(`已打开最后一批 ${batch.items.length} 个聊天。系统不会自动按发送。`);
}

async function bulkEmail() {
  const leads = filteredLeads().filter(lead => lead.email);
  if (!leads.length) {
    toast("No email addresses found.");
    return;
  }
  switchView("emailCampaigns");
  await initEmailCampaigns();
  emailCampaignState.selectedKeys = new Set(leads.map(lead => `leads:${lead.id}`));
  emailCampaignState.dirty = true;
  renderEmailAudience();
  resetEmailAudienceAudit();
  toast(`${leads.length} 位 Leads 已加入 Email Campaign 名单。`);
}

function emailCandidateKey(source, sourceId) {
  return `${source}:${sourceId}`;
}

function emailCampaignStatusLabel(status) {
  return ({
    draft: "草稿",
    preparing: "准备中",
    sending: "发送中",
    paused: "已暂停",
    completed: "已完成"
  })[status] || status || "草稿";
}

function emailRecipientStatusLabel(status) {
  return ({
    queued: "排队中",
    sending: "发送中",
    sent: "已发送",
    delivered: "已送达",
    opened: "已开启（估算）",
    clicked: "已点击",
    bounced: "退信",
    failed: "失败",
    complained: "投诉",
    unsubscribed: "已退订"
  })[status] || status || "排队中";
}

function emailFormatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-MY", {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

async function emailCampaignRequest(action, options = {}) {
  if (!EMAIL_CAMPAIGN_API_URL) throw new Error("Email Campaign API 尚未设置");
  const token = await zoomFirebaseAdminToken();
  const method = options.method || "GET";
  const url = new URL(EMAIL_CAMPAIGN_API_URL);
  url.searchParams.set("action", action);
  Object.entries(options.query || {}).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {})
    },
    body: method === "POST" ? JSON.stringify(options.body || {}) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Email Campaign 操作失败");
  return data;
}

function emailCandidateFromLead(lead) {
  return {
    source: "leads",
    sourceId: lead.id,
    sourceLabel: "Leads",
    name: lead.name || "-",
    email: lead.email || "",
    course: lead.course || ""
  };
}

function emailCandidateFromPreview(lead) {
  const source = lead.source === CHAMP_LEARNING_LEAD_SOURCE ? "preview_learning" : "preview_landing";
  return {
    source,
    sourceId: lead.id,
    sourceLabel: source === "preview_learning" ? "Preview Leads" : "Landing Leads",
    name: lead.name || "-",
    email: lead.email || "",
    course: lead.course || ""
  };
}

async function loadEmailAudienceCandidates() {
  const candidates = state.leads.filter(lead => lead.id && lead.email).map(emailCandidateFromLead);
  let previewLeads = [];
  if (_db) {
    try {
      const snap = await _db.collection("preview_leads").get();
      previewLeads = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn("Email audience preview_leads load failed:", error.message);
    }
  } else {
    previewLeads = [
      ...(window._previewLeadsCache || []),
      ...(window._champPreviewLeadsCache || [])
    ];
  }
  previewLeads
    .filter(lead => lead.id && lead.email && [CHAMP_LEARNING_LEAD_SOURCE, CHAMP_PREVIEW_LEAD_SOURCE].includes(lead.source))
    .forEach(lead => candidates.push(emailCandidateFromPreview(lead)));
  const seen = new Set();
  emailCampaignState.candidates = candidates.filter(candidate => {
    const key = emailCandidateKey(candidate.source, candidate.sourceId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  renderEmailAudience();
}

function filteredEmailCandidates() {
  const source = elements.emailAudienceSourceFilter?.value || "all";
  const query = normalize(elements.emailAudienceSearch?.value || "");
  return emailCampaignState.candidates.filter(candidate => {
    if (source !== "all" && candidate.source !== source) return false;
    if (!query) return true;
    return [candidate.name, candidate.email, candidate.course]
      .some(value => normalize(value).includes(query));
  });
}

function renderEmailAudience() {
  if (!elements.emailAudienceBody) return;
  const candidates = filteredEmailCandidates();
  if (!candidates.length) {
    elements.emailAudienceBody.innerHTML = `<tr><td colspan="4" class="muted">没有符合条件且拥有 Email 的客户。</td></tr>`;
  } else {
    elements.emailAudienceBody.innerHTML = candidates.map(candidate => {
      const key = emailCandidateKey(candidate.source, candidate.sourceId);
      return `<tr><td><input class="email-audience-select" type="checkbox" data-key="${escapeHtml(key)}" ${emailCampaignState.selectedKeys.has(key) ? "checked" : ""}></td><td><strong>${escapeHtml(candidate.name)}</strong>${candidate.course ? `<br><small class="muted">${escapeHtml(candidate.course)}</small>` : ""}</td><td>${escapeHtml(candidate.email)}</td><td>${escapeHtml(candidate.sourceLabel)}</td></tr>`;
    }).join("");
  }
  const selected = emailCampaignState.selectedKeys.size;
  elements.emailAudienceSummary.textContent = selected
    ? emailCampaignState.appendMode
      ? `已选择 ${selected} 位客户；审核会自动排除这个 Campaign 已经寄过的人，只保留新增收件人。`
      : `已选择 ${selected} 位客户；服务器会再次验证、去重并检查永久排除名单。`
    : emailCampaignState.appendMode
      ? "请选择今天新报名的人；也可选择目前全部结果，审核时会自动排除已经寄过的人。"
      : "尚未选择收件人。";
  const filteredKeys = candidates.map(candidate => emailCandidateKey(candidate.source, candidate.sourceId));
  elements.emailAudienceSelectAll.checked = Boolean(filteredKeys.length) && filteredKeys.every(key => emailCampaignState.selectedKeys.has(key));
  elements.emailAudienceSelectAll.indeterminate = filteredKeys.some(key => emailCampaignState.selectedKeys.has(key)) && !elements.emailAudienceSelectAll.checked;
  updateEmailCampaignWorkflow();
}

function emailAudienceSelections() {
  const groups = new Map();
  emailCampaignState.selectedKeys.forEach(key => {
    const candidate = emailCampaignState.candidates.find(item => emailCandidateKey(item.source, item.sourceId) === key);
    if (!candidate) return;
    if (!groups.has(candidate.source)) groups.set(candidate.source, []);
    groups.get(candidate.source).push(candidate.sourceId);
  });
  return Array.from(groups, ([source, ids]) => ({ source, ids }));
}

function applyEmailSelections(selections = []) {
  emailCampaignState.selectedKeys = new Set();
  selections.forEach(selection => (selection.ids || []).forEach(id => {
    emailCampaignState.selectedKeys.add(emailCandidateKey(selection.source, id));
  }));
  renderEmailAudience();
}

function emailFormData() {
  return {
    id: elements.emailCampaignId.value,
    internalName: elements.emailCampaignName.value,
    subject: elements.emailCampaignSubject.value,
    previewText: elements.emailCampaignPreview.value,
    bodyText: elements.emailCampaignBody.value,
    ctaLabel: elements.emailCampaignCtaLabel.value,
    ctaUrl: elements.emailCampaignCtaUrl.value,
    selections: emailAudienceSelections()
  };
}

function setEmailFormDisabled(contentDisabled, audienceDisabled = contentDisabled) {
  [
    elements.emailCampaignName,
    elements.emailCampaignSubject,
    elements.emailCampaignPreview,
    elements.emailCampaignBody,
    elements.emailCampaignCtaLabel,
    elements.emailCampaignCtaUrl
  ].forEach(element => { if (element) element.disabled = contentDisabled; });
  [
    elements.emailAudienceSourceFilter,
    elements.emailAudienceSearch,
    elements.emailAudienceSelectAll
  ].forEach(element => { if (element) element.disabled = audienceDisabled; });
  elements.emailAudienceBody?.querySelectorAll("input").forEach(input => { input.disabled = audienceDisabled; });
}

function resetEmailAudienceAudit() {
  emailCampaignState.audienceAudit = null;
  if (elements.emailAudienceAudit) {
    elements.emailAudienceAudit.hidden = true;
    elements.emailAudienceAudit.textContent = "";
  }
  updateEmailCampaignWorkflow();
}

function emailCampaignStartBlocker() {
  const campaign = emailCampaignState.activeCampaign;
  if (!campaign) return "请先建立 Campaign，填写内容并保存草稿。";
  if (campaign.status === "completed" && !emailCampaignState.appendMode) return "这个 Campaign 已完成；如需寄给新报名者，请点击「追加新收件人」。";
  if (campaign.status === "completed" && emailCampaignState.appendMode) {
    if (!emailCampaignState.selectedKeys.size) return "请选择今天新报名、尚未寄送的收件人。";
    if (!emailCampaignState.audienceAudit?.stats) return "请先点击「审核新增名单」。";
    if (!(Number(emailCampaignState.audienceAudit.stats.valid) > 0)) return "名单中没有尚未寄送的新收件人。";
    if (!elements.emailConsentConfirmed.checked) return "请先勾选新增收件人同意确认。";
    if (emailCampaignState.service && !emailCampaignState.service.canSendCampaign) {
      return emailCampaignState.service.message || "Email 发送服务尚未完成配置。";
    }
    return "";
  }
  if (["sending", "paused", "preparing"].includes(campaign.status)) return "";
  if (!elements.emailCampaignId.value) return "请先点击「保存草稿」。";
  if (emailCampaignState.dirty) return "内容有修改，请先重新保存草稿。";
  const testCurrent = Boolean(
    campaign.testSentAt
    && campaign.testSentContentVersion === campaign.contentVersion
    && campaign.testProvider === emailCampaignState.service?.provider
  );
  if (!testCurrent) return "请先点击「寄测试邮件」，并在管理员测试邮箱确认收到。";
  if (!emailCampaignState.selectedKeys.size) return "请先选择至少一位已同意接收 Email 的收件人。";
  if (!emailCampaignState.audienceAudit?.stats) return "请先点击「审核名单」。";
  if (!(Number(emailCampaignState.audienceAudit.stats.valid) > 0)) return "名单审核后没有可发送的有效收件人。";
  if (!elements.emailConsentConfirmed.checked) return "请先勾选收件人同意确认。";
  if (emailCampaignState.service && !emailCampaignState.service.canSendCampaign) {
    return emailCampaignState.service.message || "Email 发送服务尚未完成配置。";
  }
  return "";
}

function updateEmailCampaignWorkflow() {
  if (!elements.emailSaveDraftBtn) return;
  const campaign = emailCampaignState.activeCampaign;
  const status = campaign?.status || "draft";
  const locked = status !== "draft";
  const appendMode = status === "completed" && emailCampaignState.appendMode;
  const hasDraft = Boolean(elements.emailCampaignId.value);
  const testCurrent = !emailCampaignState.dirty && Boolean(
    campaign?.testSentAt
    && campaign?.testSentContentVersion === campaign?.contentVersion
    && campaign?.testProvider === emailCampaignState.service?.provider
  );
  setEmailFormDisabled(locked, locked && !appendMode);
  if (elements.emailAppendRecipientsBtn) elements.emailAppendRecipientsBtn.hidden = status !== "completed" || appendMode;
  elements.emailSaveDraftBtn.disabled = locked;
  elements.emailSendTestBtn.disabled = locked || !hasDraft || emailCampaignState.dirty;
  elements.emailPreviewAudienceBtn.disabled = (!appendMode && (locked || !hasDraft || emailCampaignState.dirty)) || !emailCampaignState.selectedKeys.size;
  elements.emailPreviewAudienceBtn.textContent = appendMode ? "审核新增名单" : "审核名单";
  elements.emailPauseCampaignBtn.hidden = status !== "sending";
  elements.emailStartCampaignBtn.textContent = appendMode
    ? "确认并发送新增名单"
    : ["sending", "paused", "preparing"].includes(status) ? "继续发送" : "确认并开始发送";
  const startBlocker = emailCampaignStartBlocker();
  elements.emailStartCampaignBtn.disabled = status === "completed" && !appendMode;
  elements.emailStartCampaignBtn.title = startBlocker;
  if (elements.emailStartRequirement) {
    elements.emailStartRequirement.textContent = startBlocker
      ? `下一步：${startBlocker}`
      : "所有寄送前检查已完成，可以确认发送。";
  }
  if (elements.emailProviderNote) {
    elements.emailProviderNote.textContent = emailCampaignState.service?.message
      || "正在读取 Email 发送服务状态。";
  }
  elements.emailDraftState.textContent = appendMode
    ? "追加模式：原邮件内容与旧报告保持不变"
    : !hasDraft ? "尚未保存" : emailCampaignState.dirty ? "有尚未保存的修改" : testCurrent ? "测试邮件已寄出" : "草稿已保存，等待测试";
}

async function beginEmailCampaignAppend(campaignId = "") {
  const campaign = campaignId ? emailCampaignState.campaigns.find(item => item.id === campaignId) : emailCampaignState.activeCampaign;
  if (!campaign) {
    toast("❌ 找不到 Campaign，请先刷新记录。");
    return;
  }
  if (campaign.status !== "completed") {
    toast("ℹ️ 只有已完成的 Campaign 可以追加新收件人。");
    return;
  }
  fillEmailCampaignForm(campaign);
  emailCampaignState.appendMode = true;
  emailCampaignState.audienceAudit = null;
  emailCampaignState.dirty = false;
  emailCampaignState.selectedKeys = new Set();
  elements.emailConsentConfirmed.checked = false;
  elements.emailSendProgress.textContent = "";
  resetEmailAudienceAudit();
  renderEmailAudience();
  updateEmailCampaignWorkflow();
  await loadEmailCampaignReport(campaign.id, { quiet: true });
  elements.emailAudienceSummary.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => elements.emailAudienceSearch?.focus({ preventScroll: true }), 300);
  toast("✅ 已进入追加模式；请选择今天新报名的人，旧报告会继续保留。");
}

function markEmailCampaignDirty() {
  emailCampaignState.dirty = true;
  resetEmailAudienceAudit();
  updateEmailCampaignWorkflow();
}

function markEmailAudienceChanged() {
  if (emailCampaignState.appendMode) {
    resetEmailAudienceAudit();
    updateEmailCampaignWorkflow();
    return;
  }
  markEmailCampaignDirty();
}

function newEmailCampaign({ revealEditor = false } = {}) {
  emailCampaignState.activeCampaign = null;
  emailCampaignState.audienceAudit = null;
  emailCampaignState.report = null;
  emailCampaignState.dirty = false;
  emailCampaignState.appendMode = false;
  emailCampaignState.selectedKeys = new Set();
  elements.emailCampaignId.value = "";
  elements.emailCampaignName.value = "";
  elements.emailCampaignSubject.value = "{{name}}，Champion Academy 有一项通知";
  elements.emailCampaignPreview.value = "请查看这项最新通知";
  elements.emailCampaignBody.value = "Hi {{name}}，\n\n这里填写需要通知客户的内容。\n\nChampion Academy";
  elements.emailCampaignCtaLabel.value = "查看详情";
  elements.emailCampaignCtaUrl.value = "";
  elements.emailConsentConfirmed.checked = false;
  elements.emailSendProgress.textContent = "";
  elements.emailReportCard.hidden = true;
  resetEmailAudienceAudit();
  renderEmailAudience();
  updateEmailCampaignWorkflow();

  if (revealEditor) {
    elements.emailCampaignName.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => elements.emailCampaignName.focus({ preventScroll: true }), 300);
    toast("✍️ 新 Campaign 已建立，请填写 Email 内容。");
  }
}

function fillEmailCampaignForm(campaign) {
  emailCampaignState.activeCampaign = campaign;
  emailCampaignState.dirty = false;
  emailCampaignState.appendMode = false;
  elements.emailCampaignId.value = campaign.id || "";
  elements.emailCampaignName.value = campaign.internalName || "";
  elements.emailCampaignSubject.value = campaign.subject || "";
  elements.emailCampaignPreview.value = campaign.previewText || "";
  elements.emailCampaignBody.value = campaign.bodyText || "";
  elements.emailCampaignCtaLabel.value = campaign.ctaLabel || "";
  elements.emailCampaignCtaUrl.value = campaign.ctaUrl || "";
  elements.emailConsentConfirmed.checked = Boolean(campaign.startedAt);
  applyEmailSelections(campaign.selections || []);
  resetEmailAudienceAudit();
  updateEmailCampaignWorkflow();
}

function renderEmailCampaignList() {
  if (!elements.emailCampaignListBody) return;
  if (!emailCampaignState.campaigns.length) {
    elements.emailCampaignListBody.innerHTML = `<tr><td colspan="5" class="muted">还没有 Campaign，点击“建立 Campaign”开始。</td></tr>`;
    return;
  }
  elements.emailCampaignListBody.innerHTML = emailCampaignState.campaigns.map(campaign => `
    <tr>
      <td><strong>${escapeHtml(campaign.internalName)}</strong><br><small class="muted">${escapeHtml(campaign.subject)}</small></td>
      <td><span class="email-status-badge status-${escapeHtml(campaign.status)}">${escapeHtml(emailCampaignStatusLabel(campaign.status))}</span></td>
      <td>${Number(campaign.audience?.valid) || "-"}</td>
      <td>${emailFormatDate(campaign.updatedAt)}</td>
      <td><div class="email-campaign-row-actions"><button class="mini-button email-campaign-open" data-campaign-id="${escapeHtml(campaign.id)}">${campaign.status === "draft" ? "编辑" : "查看"}</button>${campaign.status === "completed" ? `<button class="mini-button email-campaign-append" data-campaign-id="${escapeHtml(campaign.id)}">追加收件人</button>` : ""}</div></td>
    </tr>`).join("");
}

async function loadEmailCampaigns() {
  if (!elements.emailCampaignListBody) return;
  elements.emailCampaignListBody.innerHTML = `<tr><td colspan="5" class="muted">正在读取 Campaign…</td></tr>`;
  try {
    const data = await emailCampaignRequest("list");
    emailCampaignState.campaigns = data.campaigns || [];
    emailCampaignState.service = data.service || null;
    renderEmailCampaignList();
    updateEmailCampaignWorkflow();
  } catch (error) {
    elements.emailCampaignListBody.innerHTML = `<tr><td colspan="5" style="color:#b91c1c">${escapeHtml(error.message)}</td></tr>`;
    if (/没有 Email 管理权限|未授权/.test(error.message)) {
      updateEmailAdminAuthUi("当前账号没有 Email 管理权限。请使用获授权的 Google 管理员账号登录。");
    }
  }
}

async function initEmailCampaigns() {
  if (emailCampaignState.loading) return emailCampaignState.initPromise;
  emailCampaignState.loading = true;
  emailCampaignState.initPromise = (async () => {
    try {
      await Promise.all([loadEmailAudienceCandidates(), loadEmailCampaigns()]);
      if (!emailCampaignState.initialized) newEmailCampaign();
      emailCampaignState.initialized = true;
    } finally {
      emailCampaignState.loading = false;
    }
  })();
  return emailCampaignState.initPromise;
}

async function saveEmailCampaignDraft() {
  elements.emailSaveDraftBtn.disabled = true;
  elements.emailDraftState.textContent = "保存中…";
  try {
    const data = await emailCampaignRequest("save-draft", { method: "POST", body: emailFormData() });
    emailCampaignState.activeCampaign = data.campaign;
    emailCampaignState.dirty = false;
    elements.emailCampaignId.value = data.campaign.id;
    resetEmailAudienceAudit();
    await loadEmailCampaigns();
    toast("✅ Email Campaign 草稿已保存");
  } catch (error) {
    toast(`❌ ${error.message}`);
  } finally {
    updateEmailCampaignWorkflow();
  }
}

async function sendEmailCampaignTest() {
  if (!confirm("将寄送一封测试邮件到系统预设的管理员测试邮箱。继续吗？")) return;
  elements.emailSendTestBtn.disabled = true;
  elements.emailSendTestBtn.textContent = "寄送中…";
  try {
    const data = await emailCampaignRequest("send-test", {
      method: "POST",
      body: { campaignId: elements.emailCampaignId.value }
    });
    emailCampaignState.activeCampaign.testSentAt = data.sentAt;
    emailCampaignState.activeCampaign.testSentContentVersion = emailCampaignState.activeCampaign.contentVersion;
    emailCampaignState.activeCampaign.testProvider = data.provider;
    await loadEmailCampaigns();
    toast("✅ 测试邮件已寄出，请检查收件箱与 CTA 链接");
  } catch (error) {
    toast(`❌ ${error.message}`);
  } finally {
    elements.emailSendTestBtn.textContent = "寄测试邮件";
    updateEmailCampaignWorkflow();
  }
}

async function previewEmailAudience() {
  elements.emailPreviewAudienceBtn.disabled = true;
  elements.emailPreviewAudienceBtn.textContent = "审核中…";
  try {
    const data = await emailCampaignRequest("preview-audience", {
      method: "POST",
      body: emailCampaignState.appendMode
        ? { campaignId: elements.emailCampaignId.value, selections: emailAudienceSelections(), incremental: true }
        : { campaignId: elements.emailCampaignId.value }
    });
    emailCampaignState.audienceAudit = data;
    const stats = data.stats || {};
    elements.emailAudienceAudit.hidden = false;
    elements.emailAudienceAudit.textContent = `选中 ${stats.selected || 0}；${emailCampaignState.appendMode ? "新增有效" : "有效"} ${stats.valid || 0}；排除 ${stats.excluded || 0}（已经寄过 ${stats.alreadyAdded || 0}、Email 无效 ${stats.invalid || 0}、重复 ${stats.duplicate || 0}、永久排除 ${stats.suppressed || 0}、未同意 ${stats.noConsent || 0}、记录不存在 ${stats.missing || 0}）。`;
    toast("✅ 名单审核完成");
  } catch (error) {
    toast(`❌ ${error.message}`);
  } finally {
    elements.emailPreviewAudienceBtn.textContent = "审核名单";
    updateEmailCampaignWorkflow();
  }
}

async function openEmailCampaign(campaignId) {
  const campaign = emailCampaignState.campaigns.find(item => item.id === campaignId);
  if (!campaign) return;
  fillEmailCampaignForm(campaign);
  if (campaign.status !== "draft") await loadEmailCampaignReport(campaign.id);
  else elements.emailReportCard.hidden = true;
  document.getElementById("emailCampaignsView")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function startEmailCampaign() {
  const campaign = emailCampaignState.activeCampaign;
  const appendMode = emailCampaignState.appendMode;
  const blocker = emailCampaignStartBlocker();
  if (blocker) {
    toast(`ℹ️ ${blocker}`);
    elements.emailStartRequirement?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const isResume = ["sending", "paused", "preparing"].includes(campaign.status);
  const valid = Number(emailCampaignState.audienceAudit?.stats?.valid) || Number(campaign.audience?.valid) || 0;
  const message = appendMode
    ? `将把相同 Email 追加寄送给 ${valid} 位尚未寄过的新收件人；旧报告会保留。确定继续吗？`
    : isResume
      ? "继续处理尚未寄出的收件人吗？"
      : `将真实寄送给 ${valid} 位有效收件人。寄送后无法撤回，确定继续吗？`;
  if (!confirm(message)) return;
  elements.emailStartCampaignBtn.disabled = true;
  try {
    const data = await emailCampaignRequest(appendMode ? "append-audience" : "start", {
      method: "POST",
      body: {
        campaignId: campaign.id,
        consentConfirmed: elements.emailConsentConfirmed.checked,
        ...(appendMode ? { selections: emailAudienceSelections() } : {})
      }
    });
    emailCampaignState.appendMode = false;
    emailCampaignState.activeCampaign = { ...campaign, ...(data.campaign || {}), status: "sending" };
    await loadEmailCampaigns();
    await processEmailCampaignBatches();
  } catch (error) {
    toast(`❌ ${error.message}`);
    updateEmailCampaignWorkflow();
  }
}

async function processEmailCampaignBatches() {
  if (emailCampaignState.sending) return;
  emailCampaignState.sending = true;
  let sent = 0;
  let failed = 0;
  updateEmailCampaignWorkflow();
  try {
    while (emailCampaignState.sending) {
      const data = await emailCampaignRequest("send-next", {
        method: "POST",
        body: { campaignId: emailCampaignState.activeCampaign.id }
      });
      sent += Number(data.sent) || 0;
      failed += Number(data.failed) || 0;
      elements.emailSendProgress.textContent = `本次处理：已发送 ${sent}，失败 ${failed}`;
      await loadEmailCampaignReport(emailCampaignState.activeCampaign.id, { quiet: true });
      if (data.paused) {
        emailCampaignState.activeCampaign.status = "paused";
        toast(`⏸ ${data.reason || "Campaign 已暂停"}`);
        break;
      }
      if (data.completed || !data.hasMore) {
        emailCampaignState.activeCampaign.status = "completed";
        toast("✅ Campaign 寄送流程已完成");
        break;
      }
      if (!data.processed) {
        toast("发送工作仍在处理中，请稍后点击继续发送。");
        break;
      }
    }
  } catch (error) {
    toast(`❌ ${error.message}`);
  } finally {
    emailCampaignState.sending = false;
    await loadEmailCampaigns();
    updateEmailCampaignWorkflow();
  }
}

async function pauseEmailCampaign() {
  if (!emailCampaignState.activeCampaign) return;
  emailCampaignState.sending = false;
  elements.emailPauseCampaignBtn.disabled = true;
  try {
    const data = await emailCampaignRequest("pause", {
      method: "POST",
      body: { campaignId: emailCampaignState.activeCampaign.id }
    });
    emailCampaignState.activeCampaign = { ...emailCampaignState.activeCampaign, ...data.campaign };
    await loadEmailCampaigns();
    toast("⏸ Campaign 已暂停；当前处理中批次可能仍会完成。");
  } catch (error) {
    toast(`❌ ${error.message}`);
  } finally {
    elements.emailPauseCampaignBtn.disabled = false;
    updateEmailCampaignWorkflow();
  }
}

function emailReportRecipientIsNotClicked(recipient) {
  return ["sent", "delivered", "opened"].includes(recipient.status);
}

function filteredEmailReportRecipients() {
  const report = emailCampaignState.report;
  if (!report) return [];
  const status = elements.emailReportStatusFilter.value;
  const query = elements.emailReportSearch.value.trim().toLowerCase();
  return report.recipients.filter(recipient => {
    if (status === "not_clicked" && !emailReportRecipientIsNotClicked(recipient)) return false;
    if (status !== "all" && status !== "not_clicked" && recipient.status !== status) return false;
    return !query || recipient.name.toLowerCase().includes(query) || recipient.email.toLowerCase().includes(query);
  });
}

function renderEmailCampaignReport() {
  const report = emailCampaignState.report;
  if (!report) return;
  elements.emailReportCard.hidden = false;
  elements.emailReportTitle.textContent = `${report.campaign.internalName}｜Campaign 报告`;
  const summary = report.summary || {};
  const stats = [
    ["选中", summary.selected], ["有效", summary.valid], ["排除", summary.excluded], ["已发送", summary.sent],
    ["已送达", summary.delivered], ["开启（估算）", summary.opened], ["已点击", summary.clicked], ["未点击", summary.notClicked],
    ["退信", summary.bounced], ["失败", summary.failed], ["投诉", summary.complained], ["退订", summary.unsubscribed]
  ];
  elements.emailReportStats.innerHTML = stats.map(([label, value]) => `<div class="email-report-stat"><span>${label}</span><strong>${Number(value) || 0}</strong></div>`).join("");
  const recipients = filteredEmailReportRecipients();
  elements.emailReportBody.innerHTML = recipients.length ? recipients.map(recipient => `
    <tr><td><strong>${escapeHtml(recipient.name)}</strong><br><small class="muted">${escapeHtml(recipient.sourceLabel || recipient.course || "")}</small></td><td>${escapeHtml(recipient.email)}</td><td><span class="email-status-badge status-${escapeHtml(recipient.status)}">${escapeHtml(emailRecipientStatusLabel(recipient.status))}</span>${recipient.lastError ? `<br><small style="color:#b91c1c">${escapeHtml(recipient.lastError)}</small>` : ""}</td><td>${emailFormatDate(recipient.sentAt)}</td><td>${emailFormatDate(recipient.firstOpenedAt)}</td><td>${emailFormatDate(recipient.firstClickedAt)}</td></tr>`).join("") : `<tr><td colspan="6" class="muted">没有符合筛选条件的收件人。</td></tr>`;
}

async function loadEmailCampaignReport(campaignId, options = {}) {
  if (!campaignId) return;
  if (!options.quiet) elements.emailReportBody.innerHTML = `<tr><td colspan="6" class="muted">正在读取报告…</td></tr>`;
  try {
    emailCampaignState.report = await emailCampaignRequest("report", { query: { campaignId } });
    renderEmailCampaignReport();
  } catch (error) {
    if (!options.quiet) toast(`❌ ${error.message}`);
  }
}

function exportEmailCampaignReport() {
  if (!emailCampaignState.report) return;
  const headers = ["name", "email", "source", "status", "sent_at", "delivered_at", "opened_at", "clicked_at", "bounced_at", "failed_at", "complained_at", "unsubscribed_at"];
  const rows = filteredEmailReportRecipients().map(recipient => [
    recipient.name, recipient.email, recipient.sourceLabel, emailRecipientStatusLabel(recipient.status), recipient.sentAt,
    recipient.deliveredAt, recipient.firstOpenedAt, recipient.firstClickedAt, recipient.bouncedAt, recipient.failedAt,
    recipient.complainedAt, recipient.unsubscribedAt
  ]);
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `email-campaign-${emailCampaignState.report.campaign.id}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function markStepDone(id, step) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead || !step) return;
  if (!lead.completedSteps.includes(step)) lead.completedSteps.push(step);
  lead.lastContactedAt = new Date().toISOString();
  if (lead.status === "new") lead.status = "contacted";
  saveJson(storageKeys.leads, state.leads);
  fbSaveLead(lead).catch(()=>{});
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
  fbSaveLead(lead).catch(()=>{});
  render();
}

function removeLead(id) {
  const toDelete = state.leads.find(l => l.id === id);
  state.leads = state.leads.filter((lead) => lead.id !== id);
  saveJson(storageKeys.leads, state.leads);
  if (toDelete) fbDeleteLead(id).catch(()=>{});
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
  const currentLeadIds = new Set(state.leads.map(lead => lead.id));
  state.courseSelectedIds.forEach(id => {
    if (!currentLeadIds.has(id)) state.courseSelectedIds.delete(id);
  });

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
  const oldOrderStr = localStorage.getItem("lead_center_course_order");
  const newOrderStr = JSON.stringify(courseOrder);
  if (oldOrderStr !== newOrderStr) {
    localStorage.setItem("lead_center_course_order", newOrderStr);
    fbSaveLayout();
  }

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
      const selectedCount = leads.filter(lead => state.courseSelectedIds.has(lead.id)).length;
      const escapedCourse = course.replace(/'/g, "\\'");
      
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
          <div class="course-selection-toolbar">
            <label class="course-select-all">
              <input
                id="select-all-${sanitizedId}"
                type="checkbox"
                ${selectedCount === leads.length ? "checked" : ""}
                onchange="toggleCourseGroupSelection('${sanitizedId}', this.checked)"
              />
              <span>Select all</span>
            </label>
            <div class="course-selection-summary">
              <span id="selected-count-${sanitizedId}">${selectedCount} selected</span>
              <button
                id="delete-selected-${sanitizedId}"
                class="mini-tag danger course-delete-selected"
                onclick="deleteSelectedCourseLeads('${escapedCourse}', '${sanitizedId}', this)"
                ${selectedCount ? "" : "disabled"}
              >🗑 DELETE SELECTED</button>
            </div>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tbody>
              ${leads.sort((a,b) => a.name.localeCompare(b.name)).map(l => `
                <tr style="border-bottom: 1px solid #f7fafc;">
                  <td class="course-lead-check-cell">
                    <input
                      class="course-lead-checkbox"
                      type="checkbox"
                      value="${l.id}"
                      ${state.courseSelectedIds.has(l.id) ? "checked" : ""}
                      onchange="toggleCourseLeadSelection('${l.id}', '${sanitizedId}', this.checked)"
                      aria-label="Select lead"
                    />
                  </td>
                  <td style="padding: 12px 20px; font-weight: 600; color: #2d3748;">${escapeHtml(l.name)}</td>
                  <td style="padding: 12px 20px; color: #718096;">${l.phone}</td>
                  <td style="padding: 12px 20px; text-align: right; display:flex; justify-content:flex-end; gap:6px;">
                    <button class="mini-tag" onclick="openLeadDetails('${l.id}')">EDIT</button>
                    <button class="mini-tag danger" onclick="deleteCourseLead('${l.id}', this)" title="Delete Lead">🗑 DELETE</button>
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
    fbSaveLayout();
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
    fbSaveLayout();
    render();
    toast(`Created new group: ${name.trim()}`);
  } else {
    alert("This group name already exists.");
  }
};

window.deleteEntireGroup = function(courseName) {
  if (!confirm(`CAUTION: This will delete the group "${courseName}" AND all leads inside it. Proceed?`)) return;
  
  // Remove leads
  const toDelete = state.leads.filter(l => (l.course || "No Preview Course Assigned") === courseName);
  toDelete.forEach(lead => state.courseSelectedIds.delete(lead.id));
  state.leads = state.leads.filter(l => (l.course || "No Preview Course Assigned") !== courseName);
  saveJson(storageKeys.leads, state.leads);
  if (toDelete.length > 0) {
    fbDeleteLeadsBatch(toDelete.map(l => l.id)).catch(()=>{});
  }
  
  // Remove from custom groups if present
  const customGroups = loadJson("lead_center_custom_groups", []);
  const updatedCustom = customGroups.filter(n => n !== courseName);
  localStorage.setItem("lead_center_custom_groups", JSON.stringify(updatedCustom));
  fbSaveLayout();
  
  render();
  toast(`Deleted group: ${courseName}`);
};

window.deleteCourseLead = async function(leadId, button) {
  const lead = state.leads.find(item => item.id === leadId);
  if (!lead) {
    toast("Lead not found.");
    return;
  }

  const leadLabel = lead.name || "this lead";
  if (!confirm(`Delete "${leadLabel}" from this course group? This cannot be undone.`)) return;

  const originalText = button?.textContent || "🗑 DELETE";
  if (button) {
    button.disabled = true;
    button.textContent = "DELETING...";
  }

  try {
    await fbDeleteLead(leadId);
    state.courseSelectedIds.delete(leadId);
    state.leads = state.leads.filter(item => item.id !== leadId);
    saveJson(storageKeys.leads, state.leads);
    render();
    toast("Lead deleted.");
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
    toast("Delete failed. Lead was not removed.");
  }
};

function updateCourseSelectionToolbar(listId) {
  const list = document.getElementById(listId);
  if (!list) return;

  const checkboxes = Array.from(list.querySelectorAll(".course-lead-checkbox"));
  const selectedCount = checkboxes.filter(checkbox => checkbox.checked).length;
  const selectAll = document.getElementById(`select-all-${listId}`);
  const count = document.getElementById(`selected-count-${listId}`);
  const deleteButton = document.getElementById(`delete-selected-${listId}`);

  if (selectAll) {
    selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
  }
  if (count) count.textContent = `${selectedCount} selected`;
  if (deleteButton) deleteButton.disabled = selectedCount === 0;
}

window.toggleCourseLeadSelection = function(leadId, listId, checked) {
  if (checked) state.courseSelectedIds.add(leadId);
  else state.courseSelectedIds.delete(leadId);
  updateCourseSelectionToolbar(listId);
};

window.toggleCourseGroupSelection = function(listId, checked) {
  const list = document.getElementById(listId);
  if (!list) return;

  list.querySelectorAll(".course-lead-checkbox").forEach(checkbox => {
    checkbox.checked = checked;
    if (checked) state.courseSelectedIds.add(checkbox.value);
    else state.courseSelectedIds.delete(checkbox.value);
  });
  updateCourseSelectionToolbar(listId);
};

window.deleteSelectedCourseLeads = async function(courseName, listId, button) {
  const courseLeadIds = new Set(
    state.leads
      .filter(lead => (lead.course || "No Preview Course Assigned") === courseName)
      .map(lead => lead.id),
  );
  const selectedIds = Array.from(state.courseSelectedIds).filter(id => courseLeadIds.has(id));
  if (!selectedIds.length) {
    toast("Select at least one lead.");
    return;
  }

  if (!confirm(`Delete ${selectedIds.length} selected lead(s) from "${courseName}"? This cannot be undone.`)) return;

  const originalText = button?.textContent || "🗑 DELETE SELECTED";
  if (button) {
    button.disabled = true;
    button.textContent = "DELETING...";
  }

  try {
    await fbDeleteLeadsBatch(selectedIds, { throwOnError: true });
    const selectedIdSet = new Set(selectedIds);
    state.leads = state.leads.filter(lead => !selectedIdSet.has(lead.id));
    selectedIds.forEach(id => state.courseSelectedIds.delete(id));
    saveJson(storageKeys.leads, state.leads);
    render();

    const list = document.getElementById(listId);
    if (list) {
      list.style.display = "block";
      const arrow = document.getElementById(`arrow-${listId}`);
      if (arrow) arrow.style.transform = "rotate(180deg)";
    }
    toast(`${selectedIds.length} lead(s) deleted.`);
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
    toast("Delete failed. Selected leads were not removed.");
  }
};

window.renameCourseGroup = function(oldName) {
  const newName = prompt(`Rename group "${oldName}" to:`, oldName);
  if (!newName || !newName.trim() || newName === oldName) return;
  
  const updatedLeads = [];
  state.leads = state.leads.map(l => {
    if ((l.course || "No Preview Course Assigned") === oldName) {
      const updated = { ...l, course: newName.trim() };
      updatedLeads.push(updated);
      return updated;
    }
    return l;
  });
  
  saveJson(storageKeys.leads, state.leads);
  if (updatedLeads.length > 0) {
    fbSaveLeadsBatch(updatedLeads).catch(()=>{});
  }
  
  // Also rename the group in customGroups if it's there
  const customGroups = loadJson("lead_center_custom_groups", []);
  const idx = customGroups.indexOf(oldName);
  if (idx > -1) {
    customGroups[idx] = newName.trim();
    localStorage.setItem("lead_center_custom_groups", JSON.stringify(customGroups));
  }
  
  // Rename in courseOrder
  let order = loadJson("lead_center_course_order", []);
  const oIdx = order.indexOf(oldName);
  if (oIdx > -1) {
    order[oIdx] = newName.trim();
    localStorage.setItem("lead_center_course_order", JSON.stringify(order));
  }
  fbSaveLayout();
  
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
    const deletedIds = [...state.enrollSelectedIds];
    state.leads = state.leads.filter(l => !state.enrollSelectedIds.has(l.id));
    state.enrollSelectedIds.clear();
    saveJson(storageKeys.leads, state.leads);
    fbDeleteLeadsBatch(deletedIds).catch(()=>{});
    toast(`${count} lead(s) deleted.`);
    render();
  }
}

function clearCurrentCourse() {
  const targetCourse = state.enrollmentFilter;
  if (targetCourse === "all") return;
  
  if (confirm(`Are you sure you want to delete ALL ${state.leads.filter(l => l.course === targetCourse).length} leads in "${targetCourse}"? This cannot be undone.`)) {
    const toDelete = state.leads.filter(l => l.course === targetCourse);
    state.leads = state.leads.filter(l => l.course !== targetCourse);
    saveJson(storageKeys.leads, state.leads);
    if (toDelete.length > 0) {
      fbDeleteLeadsBatch(toDelete.map(l => l.id)).catch(()=>{});
    }
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
  elements.bulkWhatsappBtn.disabled = count === 0;
  elements.bulkWhatsappBtn.textContent = count > 0 ? `WhatsApp Preview (${count})` : "Bulk WhatsApp (Selected)";
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
  elements.emailInput.value = lead.email || "";
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
  fbSaveLead(lead).catch(()=>{});
}

function closeNotes() {
  state.editingLeadId = null;
  elements.notesModal.classList.remove("show");
}

function saveNote() {
  const isNew = !state.editingLeadId;
  const email = clean(elements.emailInput.value);
  if (email && !elements.emailInput.checkValidity()) {
    toast("Please enter a valid email address.");
    elements.emailInput.focus();
    return;
  }
  let lead;
  
  if (isNew) {
    const name = elements.nameInput.value.trim();
    if (!name) { toast("Please enter a name."); return; }
    
    // Build the full lead object first so identity/dedup key is computed correctly
    lead = sanitizeLead({
      name,
      phone: elements.phoneInput.value.trim(),
      email,
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
    fbSaveLead(lead).catch(()=>{});
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
    lead.email = email;
    lead.course = elements.courseInput.value;
    lead.amountPaid = elements.amountInput.value;
    lead.profit = elements.profitInput.value;
    lead.paymentMethod = elements.paymentMethodInput.value;
    lead.enrollmentDate = elements.enrollmentDateInput.value;
    lead.followupStage = elements.followupStage.value;
    lead.memberLevel = elements.memberLevel.value;
    lead.followupAction = elements.followupAction.value;
    saveJson(storageKeys.leads, state.leads);
    fbSaveLead(lead).catch(()=>{});
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
    previews: state.previews || [],
    videos: state.videos || [],
    zoomSettings: state.zoomSettings,
    customGroups: JSON.parse(localStorage.getItem('lead_center_custom_groups') || 'null'),
    courseOrder: JSON.parse(localStorage.getItem('lead_center_course_order') || 'null'),
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
      if (data.zoomSettings) {
        state.zoomSettings = normalizeZoomSettings(data.zoomSettings);
        saveJson(storageKeys.zoomSettings, state.zoomSettings);
      }
      // Push to Firebase before reloading so the data is in the cloud
      if (_db) {
        toast('⏳ 正在上传数据到云端，请稍候...');
        await fbSaveLeadsBatch(state.leads);
        await fbSaveConfig('templates', state.templates);
        if (data.zoomSettings) await fbSaveConfig('zoom', state.zoomSettings);
        if (data.previews) await fbSaveCollection('previews', data.previews);
      }
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
  if (view === "previewLeads") title = "Preview Leads";
  if (view === "landingLeads") title = "Landing Leads";
  if (view === "ebookLeads") title = "Ebook Leads";
  if (view === "zoom") title = "Zoom";
  if (view === "emailCampaigns") title = "Email Campaigns";
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
  if (view === "zoom") initZoomAdmin();
  if (view === "emailCampaigns") initEmailCampaigns();
  if (view === "ebookLeads") loadLandingLeads();
  if (view === "landingLeads") loadChampPreviewLeads();
  if (view === "previewLeads") loadPreviewLeads();
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
      const srcUrl = v.url || v.blobUrl || "";
      if (!srcUrl || srcUrl === "#") {
        mediaHtml = `<div style="color:var(--muted); text-align:center; padding: 20px 10px; font-size:12px; line-height:1.5;">⚠️ 视频源在此设备不可用<br/><small style="opacity:0.7">只保存在旧版本的浏览器中。请删除该视频，并重新在此新版本中上传导入该视频，系统会自动上传至云端以同步到所有设备。</small></div>`;
      } else {
        mediaHtml = `<video width="100%" height="100%" controls style="background: #000;"><source src="${srcUrl}" type="${v.mime || 'video/mp4'}"></video>`;
      }
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
          <p class="muted" style="font-size: 11px; margin: 0;">${v.type === 'file' ? 'Cloud File' : 'Link'} • ${formatDate(v.date)}</p>
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
  
  if (!_storage) {
    // If Firebase storage is not initialized, fallback to IndexedDB locally
    console.warn("Firebase Storage is not initialized, falling back to IndexedDB local storage.");
    if (!db) {
      toast("System is initializing. Please try again in a moment.");
      return;
    }
    try {
      toast("Saving video to local browser database (other devices won't see this)...");
      const id = crypto.randomUUID();
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const addRequest = store.add({ id, blob: file });
      await new Promise((resolve, reject) => {
        addRequest.onsuccess = resolve;
        addRequest.onerror = () => reject(new Error("Local write failed."));
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
        const {blobUrl: _, ...rest} = v;
        return rest;
      }));
      renderVideos();
      toast("Video imported locally! ✓");
    } catch(err) {
      toast("Error: " + err.message);
    } finally {
      if (event.target) event.target.value = "";
    }
    return;
  }

  try {
    const id = crypto.randomUUID();
    const fileName = `${id}_${file.name}`;
    
    toast("⏳ 正在准备上传视频至云存储 (等候上传)...");
    
    // Save to IndexedDB as local offline cache
    if (db) {
      try {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).add({ id, blob: file });
      } catch (dbErr) {
        console.warn("Failed to write offline copy to IndexedDB:", dbErr);
      }
    }

    const storageRef = _storage.ref().child('videos/' + fileName);
    const uploadTask = storageRef.put(file);

    // Watch upload progress
    await new Promise((resolve, reject) => {
      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          toast(`⏳ 视频上传进度: ${progress}% ...`);
        }, 
        (error) => {
          reject(error);
        }, 
        () => {
          resolve();
        }
      );
    });

    toast("✨ 正在生成云端链接...");
    const downloadUrl = await storageRef.getDownloadURL();

    state.videos.unshift({
      id,
      type: "file",
      title: file.name,
      mime: file.type,
      date: new Date().toISOString(),
      url: downloadUrl,
      fileName: fileName // store filename so we can delete it from Storage later
    });
    
    saveJson(storageKeys.videos, state.videos.map(({blobUrl, ...v}) => {
      const {blobUrl: _, ...rest} = v;
      return rest;
    }));
    
    renderVideos();
    toast("✅ 视频已上传成功，所有设备都可以同步观看了！");
  } catch (err) {
    console.error("Video Cloud Upload Error:", err);
    toast("❌ 上传失败: " + err.message);
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
    if (!video) return;
    
    if (video.blobUrl) URL.revokeObjectURL(video.blobUrl);
    
    // If uploading via storage with fileName, attempt to delete from Cloud Storage
    if (_storage && video.fileName) {
      _storage.ref().child('videos/' + video.fileName).delete().catch(err => {
        console.warn("Could not delete from Cloud Storage (might already be gone):", err);
      });
    }

    state.videos = state.videos.filter(v => v.id !== id);
    saveJson(storageKeys.videos, state.videos.map(({blobUrl, ...v}) => v));
    
    if (db) {
      try {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).delete(id);
      } catch (dbErr) {
        console.warn("Could not delete from IndexedDB:", dbErr);
      }
    }
    
    renderVideos();
    toast("Video deleted.");
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
elements.closeBulkWhatsappModal.addEventListener("click", closeBulkWhatsappPreview);
elements.cancelBulkWhatsapp.addEventListener("click", closeBulkWhatsappPreview);
elements.bulkWhatsappConsent.addEventListener("change", updateBulkWhatsappOpenButton);
elements.bulkWhatsappMessageInput.addEventListener("input", handleBulkWhatsappMessageInput);
elements.bulkWhatsappEmojiButtons.forEach((button) => button.addEventListener("click", () => {
  insertBulkWhatsappEmoji(button.dataset.waEmoji);
}));
elements.removeBulkWhatsappBrokenChars.addEventListener("click", removeBulkWhatsappBrokenCharacters);
elements.saveBulkWhatsappMessage.addEventListener("click", saveBulkWhatsappMessageTemplate);
elements.bulkWhatsappImageInput.addEventListener("change", handleBulkWhatsappImageSelection);
elements.copyBulkWhatsappImage.addEventListener("click", copyBulkWhatsappImage);
elements.removeBulkWhatsappImage.addEventListener("click", removeBulkWhatsappImage);
elements.openBulkWhatsappBatch.addEventListener("click", openBulkWhatsappBatch);
elements.bulkWhatsappModal.addEventListener("click", (event) => {
  if (event.target === elements.bulkWhatsappModal) closeBulkWhatsappPreview();
});
elements.bulkEmailBtn.addEventListener("click", bulkEmail);
if (elements.emailRefreshCampaignsBtn) elements.emailRefreshCampaignsBtn.addEventListener("click", loadEmailCampaigns);
if (elements.emailAdminSignInBtn) elements.emailAdminSignInBtn.addEventListener("click", signInEmailAdminWithGoogle);
if (elements.emailAdminSignOutBtn) elements.emailAdminSignOutBtn.addEventListener("click", signOutEmailAdminGoogle);
if (elements.emailNewCampaignBtn) elements.emailNewCampaignBtn.addEventListener("click", () => newEmailCampaign({ revealEditor: true }));
if (elements.emailAppendRecipientsBtn) elements.emailAppendRecipientsBtn.addEventListener("click", () => beginEmailCampaignAppend());
if (elements.emailSaveDraftBtn) elements.emailSaveDraftBtn.addEventListener("click", saveEmailCampaignDraft);
if (elements.emailSendTestBtn) elements.emailSendTestBtn.addEventListener("click", sendEmailCampaignTest);
if (elements.emailPreviewAudienceBtn) elements.emailPreviewAudienceBtn.addEventListener("click", previewEmailAudience);
if (elements.emailStartCampaignBtn) elements.emailStartCampaignBtn.addEventListener("click", startEmailCampaign);
if (elements.emailPauseCampaignBtn) elements.emailPauseCampaignBtn.addEventListener("click", pauseEmailCampaign);
if (elements.emailRefreshReportBtn) elements.emailRefreshReportBtn.addEventListener("click", () => {
  const campaignId = emailCampaignState.report?.campaign?.id || emailCampaignState.activeCampaign?.id;
  loadEmailCampaignReport(campaignId);
});
if (elements.emailExportReportBtn) elements.emailExportReportBtn.addEventListener("click", exportEmailCampaignReport);
if (elements.emailCampaignListBody) elements.emailCampaignListBody.addEventListener("click", event => {
  const appendButton = event.target.closest(".email-campaign-append");
  if (appendButton?.dataset.campaignId) {
    beginEmailCampaignAppend(appendButton.dataset.campaignId);
    return;
  }
  const button = event.target.closest(".email-campaign-open");
  if (button?.dataset.campaignId) openEmailCampaign(button.dataset.campaignId);
});
if (elements.emailAudienceBody) elements.emailAudienceBody.addEventListener("change", event => {
  const checkbox = event.target.closest(".email-audience-select");
  if (!checkbox?.dataset.key) return;
  if (checkbox.checked) emailCampaignState.selectedKeys.add(checkbox.dataset.key);
  else emailCampaignState.selectedKeys.delete(checkbox.dataset.key);
  markEmailAudienceChanged();
  renderEmailAudience();
});
if (elements.emailAudienceSelectAll) elements.emailAudienceSelectAll.addEventListener("change", event => {
  filteredEmailCandidates().forEach(candidate => {
    const key = emailCandidateKey(candidate.source, candidate.sourceId);
    if (event.target.checked) emailCampaignState.selectedKeys.add(key);
    else emailCampaignState.selectedKeys.delete(key);
  });
  markEmailAudienceChanged();
  renderEmailAudience();
});
if (elements.emailAudienceSourceFilter) elements.emailAudienceSourceFilter.addEventListener("change", renderEmailAudience);
if (elements.emailAudienceSearch) elements.emailAudienceSearch.addEventListener("input", renderEmailAudience);
if (elements.emailConsentConfirmed) elements.emailConsentConfirmed.addEventListener("change", updateEmailCampaignWorkflow);
[
  elements.emailCampaignName,
  elements.emailCampaignSubject,
  elements.emailCampaignPreview,
  elements.emailCampaignBody,
  elements.emailCampaignCtaLabel,
  elements.emailCampaignCtaUrl
].filter(Boolean).forEach(input => input.addEventListener("input", markEmailCampaignDirty));
if (elements.emailReportStatusFilter) elements.emailReportStatusFilter.addEventListener("change", renderEmailCampaignReport);
if (elements.emailReportSearch) elements.emailReportSearch.addEventListener("input", renderEmailCampaignReport);
if (elements.saveZoomSettingsBtn) elements.saveZoomSettingsBtn.addEventListener("click", saveZoomSettings);
if (elements.copyZoomLinkBtn) elements.copyZoomLinkBtn.addEventListener("click", copyZoomLink);
if (elements.newZoomEventBtn) elements.newZoomEventBtn.addEventListener("click", newZoomEvent);
if (elements.refreshZoomDataBtn) elements.refreshZoomDataBtn.addEventListener("click", loadZoomAdminData);
if (elements.zoomEventPicker) elements.zoomEventPicker.addEventListener("change", event => {
  zoomAdminState.selectedId = event.target.value;
  const selected = zoomAdminState.events.find(item => item.id === zoomAdminState.selectedId);
  if (selected) fillZoomEventForm(selected);
  else newZoomEvent();
});
if (elements.zoomRegistrationsBody) elements.zoomRegistrationsBody.addEventListener("click", event => {
  const button = event.target.closest(".zoom-resend-btn");
  if (button?.dataset.registrationId) resendZoomRegistration(button.dataset.registrationId);
});
document.querySelectorAll(".zoom-copy-template").forEach(button => button.addEventListener("click", async () => {
  const target = document.getElementById(button.dataset.copyTarget);
  if (!target) return;
  try {
    await navigator.clipboard.writeText(target.value);
  } catch {
    target.focus();
    target.select();
    document.execCommand("copy");
  }
  toast("✅ 模板已复制");
}));

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
    const deletedIds = [...state.selectedIds];
    state.leads = state.leads.filter(l => !state.selectedIds.has(l.id));
    state.selectedIds.clear();
    saveJson(storageKeys.leads, state.leads);
    fbDeleteLeadsBatch(deletedIds).catch(()=>{});
    render();
    toast("Leads deleted.");
  }
});

elements.bulkStatus.addEventListener("change", (e) => {
  const status = e.target.value;
  if (!status) return;
  const modified = [];
  state.leads.forEach(l => {
    if (state.selectedIds.has(l.id)) {
      l.status = status;
      modified.push(l);
    }
  });
  state.selectedIds.clear();
  e.target.value = "";
  saveJson(storageKeys.leads, state.leads);
  fbSaveLeadsBatch(modified).catch(()=>{});
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
  const BACKUP_URL = './lead-center-full-backup-2026-07-04-v3.json';
  const BACKUP_VER_KEY = 'lead_center_backup_last_loaded';
  
  // Track which backup file we last loaded so we don't reload on every page view.
  // Change the value below when you upload a newer backup file.
  const BACKUP_ID = '2026-07-04-v3';
  const alreadyLoaded = localStorage.getItem(BACKUP_VER_KEY);
  if (alreadyLoaded === BACKUP_ID) return; // already loaded this exact backup

  try {
    const response = await fetch(BACKUP_URL);
    if (!response.ok) {
      console.warn('[Backup] File not found:', BACKUP_URL);
      return;
    }
    const data = await response.json();
    if (!data || typeof data !== 'object') return;

    let importedCount = 0;
    if (Array.isArray(data.leads) && data.leads.length > 0) {
      // Merge incoming with any existing local leads, deduplicating by id
      const incomingLeads = data.leads.map(sanitizeLead);
      state.leads = mergeDuplicateLeads([...incomingLeads, ...state.leads]);
      saveJson(storageKeys.leads, state.leads);
      importedCount = data.leads.length;
    }
    if (data.templates) {
      state.templates = { ...state.templates, ...data.templates };
      saveJson(storageKeys.templates, state.templates);
    }
    if (Array.isArray(data.previews) && data.previews.length > 0) {
      state.previews = data.previews;
      saveJson(storageKeys.previews, state.previews);
    }
    if (Array.isArray(data.videos) && data.videos.length > 0) {
      state.videos = data.videos;
      saveJson(storageKeys.videos, state.videos);
    }
    if (data.zoomSettings) {
      state.zoomSettings = normalizeZoomSettings(data.zoomSettings);
      saveJson(storageKeys.zoomSettings, state.zoomSettings);
    }
    if (Array.isArray(data.customGroups)) {
      localStorage.setItem('lead_center_custom_groups', JSON.stringify(data.customGroups));
    }
    if (Array.isArray(data.courseOrder)) {
      localStorage.setItem('lead_center_course_order', JSON.stringify(data.courseOrder));
    }

    // Mark this backup version as loaded so it won't reload on next visit
    localStorage.setItem(BACKUP_VER_KEY, BACKUP_ID);

    fillForms();
    render();
    if (importedCount > 0) {
      toast(`✅ 数据已就绪，共 ${importedCount} 条客户记录`);
    }
  } catch (err) {
    console.error('[Backup] Load error:', err);
  }
}

// ─── Firebase startup: load all data from Firestore then render ───
async function initFromFirebase() {
  // Initialize Firebase and restore Google admin (or the existing browser
  // identity) before any database read.
  const initialized = await initFirebase();
  updateEmailAdminAuthUi();
  if (!initialized || !_db) {
    // No Firebase — fall back to localStorage + JSON backup
    initPerformanceFilters();
    fillForms();
    render();
    autoLoadBackupFromServer();
    return;
  }

  try {
    toast('⏳ 正在从云端加载数据...');

    // Load leads
    const leadsSnap = await _db.collection('leads').get();
    if (!leadsSnap.empty) {
      const fbLeads = leadsSnap.docs.map(d => d.data());
      state.leads = mergeDuplicateLeads(fbLeads.map(sanitizeLead));
      saveJson(storageKeys.leads, state.leads);
    }

    // Load previews
    const previewsSnap = await _db.collection('previews').get();
    if (!previewsSnap.empty) {
      state.previews = previewsSnap.docs.map(d => d.data());
      saveJson(storageKeys.previews, state.previews);
    }

    // Load videos
    const videosSnap = await _db.collection('videos').get();
    if (!videosSnap.empty) {
      state.videos = videosSnap.docs.map(d => d.data());
      saveJson(storageKeys.videos, state.videos);
    }

    // Load templates
    const templatesDoc = await _db.collection('config').doc('templates').get();
    if (templatesDoc.exists) {
      state.templates = { ...defaultTemplates, ...templatesDoc.data() };
      saveJson(storageKeys.templates, state.templates);
    }

    // Load editable Zoom event settings. No WhatsApp credentials or admin
    // phone numbers are stored in this public-facing configuration document.
    const zoomDoc = await _db.collection('config').doc('zoom').get();
    if (zoomDoc.exists) {
      state.zoomSettings = normalizeZoomSettings(zoomDoc.data());
      localStorage.setItem(storageKeys.zoomSettings, JSON.stringify(state.zoomSettings));
    }

    // Load layout config
    const layoutDoc = await _db.collection('config').doc('layout').get();
    if (layoutDoc.exists) {
      const layout = layoutDoc.data();
      if (layout.customGroups) localStorage.setItem('lead_center_custom_groups', JSON.stringify(layout.customGroups));
      if (layout.courseOrder) localStorage.setItem('lead_center_course_order', JSON.stringify(layout.courseOrder));
    }

    initPerformanceFilters();
    fillForms();
    render();
    toast(`✅ 云端数据加载完成，共 ${state.leads.length} 条记录`);
    setupRealTimeSync(); // Start live listeners after first load
  } catch (err) {
    console.error('[Firebase] initFromFirebase error:', err);
    // Fallback to localStorage
    initPerformanceFilters();
    fillForms();
    render();
    toast('⚠️ 云端加载失败，显示本地缓存数据');
  }
}

// ─── Real-time sync: onSnapshot listeners so all devices update instantly ───
let _unsubscribeLeads = null;
let _unsubscribePreviews = null;
let _unsubscribeVideos = null;
let _unsubscribeTemplates = null;
let _unsubscribeLayout = null;
let _unsubscribePreviewLeads = null;
let _unsubscribeZoom = null;

function setupRealTimeSync() {
  if (!_db) return;

  // Unsubscribe from any previous listeners (safety)
  if (_unsubscribeLeads) _unsubscribeLeads();
  if (_unsubscribePreviews) _unsubscribePreviews();
  if (_unsubscribeVideos) _unsubscribeVideos();
  if (_unsubscribeTemplates) _unsubscribeTemplates();
  if (_unsubscribeLayout) _unsubscribeLayout();
  if (_unsubscribePreviewLeads) _unsubscribePreviewLeads();
  if (_unsubscribeZoom) _unsubscribeZoom();

  // ── Leads ──
  _unsubscribeLeads = _db.collection('leads').onSnapshot(snap => {
    // Skip if all changes are from this device's own writes (hasPendingWrites)
    const hasRemoteChange = snap.docChanges().some(c => !c.doc.metadata.hasPendingWrites);
    if (!hasRemoteChange) return;

    const fbLeads = snap.docs.map(d => d.data());
    state.leads = mergeDuplicateLeads(fbLeads.map(sanitizeLead));
    saveJson(storageKeys.leads, state.leads);
    render();
    console.log('[Sync] Leads updated from cloud.');
  }, err => console.warn('[Sync] leads onSnapshot error:', err));

  // ── Previews ──
  _unsubscribePreviews = _db.collection('previews').onSnapshot(snap => {
    if (snap.docChanges().every(c => c.doc.metadata.hasPendingWrites)) return;
    state.previews = snap.docs.map(d => d.data());
    saveJson(storageKeys.previews, state.previews);
    render();
    console.log('[Sync] Previews updated from cloud.');
  }, err => console.warn('[Sync] previews onSnapshot error:', err));

  // ── Videos ──
  _unsubscribeVideos = _db.collection('videos').onSnapshot(snap => {
    if (snap.docChanges().every(c => c.doc.metadata.hasPendingWrites)) return;
    state.videos = snap.docs.map(d => d.data());
    saveJson(storageKeys.videos, state.videos);
    render();
    console.log('[Sync] Videos updated from cloud.');
  }, err => console.warn('[Sync] videos onSnapshot error:', err));

  // ── Templates ──
  _unsubscribeTemplates = _db.collection('config').doc('templates').onSnapshot(snap => {
    if (!snap.exists || snap.metadata.hasPendingWrites) return;
    state.templates = { ...defaultTemplates, ...snap.data() };
    saveJson(storageKeys.templates, state.templates);
    // Update form fields only if none are focused to avoid interrupting typing
    if (!document.activeElement || document.activeElement.tagName !== 'TEXTAREA') {
      fillForms();
    }
    console.log('[Sync] Templates updated from cloud.');
  }, err => console.warn('[Sync] templates onSnapshot error:', err));

  // ── Zoom event settings ──
  _unsubscribeZoom = _db.collection('config').doc('zoom').onSnapshot(snap => {
    if (!snap.exists || snap.metadata.hasPendingWrites) return;
    state.zoomSettings = normalizeZoomSettings(snap.data());
    localStorage.setItem(storageKeys.zoomSettings, JSON.stringify(state.zoomSettings));
    if (document.getElementById('zoomView')?.classList.contains('active')) renderZoomSettings();
    console.log('[Sync] Zoom settings updated from cloud.');
  }, err => console.warn('[Sync] Zoom settings onSnapshot error:', err));

  // ── Layout (custom groups + course order) ──
  _unsubscribeLayout = _db.collection('config').doc('layout').onSnapshot(snap => {
    if (!snap.exists || snap.metadata.hasPendingWrites) return;
    const layout = snap.data();
    if (layout.customGroups) localStorage.setItem('lead_center_custom_groups', JSON.stringify(layout.customGroups));
    if (layout.courseOrder) localStorage.setItem('lead_center_course_order', JSON.stringify(layout.courseOrder));
    render();
    console.log('[Sync] Layout updated from cloud.');
  }, err => console.warn('[Sync] layout onSnapshot error:', err));

  // ── Preview Leads ──
  _unsubscribePreviewLeads = _db.collection('preview_leads').onSnapshot(snap => {
    if (snap.docChanges().every(c => c.doc.metadata.hasPendingWrites)) return;
    if (document.getElementById('previewLeadsView')?.classList.contains('active')) {
      loadPreviewLeads();
    }
    if (document.getElementById('landingLeadsView')?.classList.contains('active')) {
      loadChampPreviewLeads();
    }
    console.log('[Sync] Preview leads updated from cloud.');
  }, err => console.warn('[Sync] preview_leads onSnapshot error:', err));

  console.log('[Firebase] Real-time sync listeners active.');
}

initFromFirebase();




// ──────────────────────────────────────────────────────
// Landing Page Leads Admin — reads from Firebase Firestore
// ──────────────────────────────────────────────────────

window.loadLandingLeads = async function() {
  const tbody = document.getElementById('landingLeadsBody');
  const statsBar = document.getElementById('landingLeadsStats');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--muted)">⏳ 加载中...</td></tr>`;

  try {
    let leads = [];

    if (_db) {
      // Firebase mode: read from Firestore
      const snap = await _db.collection('landing_leads').orderBy('createdAt', 'desc').get();
      leads = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      // Fallback: local storage
      leads = JSON.parse(localStorage.getItem('landing_leads_static') || '[]');
    }

    const total = leads.length;

    if (statsBar) {
      const today = leads.filter(l => {
        const d = new Date(l.createdAt);
        const now = new Date();
        return d.toDateString() === now.toDateString();
      }).length;

      const industries = {};
      leads.forEach(l => { industries[l.industry] = (industries[l.industry] || 0) + 1; });
      const topIndustry = Object.entries(industries).sort((a,b) => b[1]-a[1])[0];

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
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:60px;color:var(--muted)">📋 暂时没有记录<br/><small style="opacity:0.6">当有客户填写Ebook Page表单后，记录将在这里显示。</small></td></tr>`;
      return;
    }

    // Reset select-all checkbox
    const selAll = document.getElementById('landingSelectAll');
    if (selAll) selAll.checked = false;
    updateLandingBulkBar();

    tbody.innerHTML = leads.map((l, i) => {
      const date = new Date(l.createdAt);
      const dateStr = new Intl.DateTimeFormat('zh-MY', {
        year:'numeric',month:'short',day:'2-digit',
        hour:'2-digit',minute:'2-digit'
      }).format(date);
      const wa = l.phone ? `<a href="https://wa.me/${l.phone.replace(/[^\d]/g,'')}" target="_blank" class="mini-button" style="background:#25D366;color:#fff;border-color:#25D366;text-decoration:none;">WA</a>` : '-';
      return `
        <tr data-lead-id="${escapeHtml(l.id || '')}">
          <td><input type="checkbox" class="landing-lead-select" data-id="${escapeHtml(l.id || '')}" onchange="updateLandingBulkBar()"></td>
          <td style="color:var(--muted);font-size:13px;">${total - i}</td>
          <td><strong>${escapeHtml(l.name)}</strong></td>
          <td><span class="muted">${escapeHtml(l.phone || '-')}</span></td>
          <td><span class="badge" style="background:rgba(124,58,237,0.1);color:#7C3AED;border:1px solid rgba(124,58,237,0.2);font-size:12px;">${escapeHtml(l.industry || '')}</span></td>
          <td style="max-width:260px;font-size:13px;color:var(--muted);" title="${escapeHtml(l.challenge || '')}">${escapeHtml((l.challenge || '').length > 80 ? l.challenge.slice(0,80)+'...' : (l.challenge || ''))}</td>
          <td style="font-size:12px;color:var(--muted);">${dateStr}</td>
          <td style="display:flex;gap:6px;align-items:center;">
            ${wa}
            <button class="mini-button" style="background:rgba(239,68,68,0.12);color:#ef4444;border-color:rgba(239,68,68,0.3);" onclick="deleteLandingLead('${escapeHtml(l.id || '')}', this)" title="删除这条记录">🗑</button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('loadLandingLeads error:', err);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#ef4444;">⚠️ 加载失败，请刷新重试</td></tr>`;
    if (statsBar) statsBar.innerHTML = '';
  }
};

window.exportLandingLeadsCSV = async function() {
  try {
    let leads = [];
    if (_db) {
      const snap = await _db.collection('landing_leads').orderBy('createdAt', 'desc').get();
      leads = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      leads = JSON.parse(localStorage.getItem('landing_leads_static') || '[]');
    }
    if (!leads.length) { toast('暂时没有数据可以导出'); return; }

    const headers = ['编号','姓名','电话','工作领域','面对的挑战','提交时间'];
    const rows = leads.map((l, i) => [
      i + 1,
      l.name,
      l.phone,
      l.industry,
      (l.challenge || '').replace(/\n/g, ' '),
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
    toast('❌ 导出失败，请重试');
  }
};

// ── Landing Leads: update bulk action bar ──
function updateLandingBulkBar() {
  const checkboxes = document.querySelectorAll('.landing-lead-select');
  const selected   = document.querySelectorAll('.landing-lead-select:checked');
  const bar        = document.getElementById('landingBulkBar');
  const countEl    = document.getElementById('landingSelectedCount');
  const selAll     = document.getElementById('landingSelectAll');
  if (!bar) return;
  if (selected.length > 0) {
    bar.style.display = 'flex';
    countEl.textContent = `${selected.length} 选中`;
  } else {
    bar.style.display = 'none';
  }
  if (selAll) {
    selAll.checked = checkboxes.length > 0 && selected.length === checkboxes.length;
    selAll.indeterminate = selected.length > 0 && selected.length < checkboxes.length;
  }
}

// ── Landing Leads: toggle select all ──
window.toggleSelectAllLandingLeads = function(masterCb) {
  document.querySelectorAll('.landing-lead-select').forEach(cb => { cb.checked = masterCb.checked; });
  updateLandingBulkBar();
};

// ── Landing Leads: clear selection ──
window.clearLandingSelection = function() {
  document.querySelectorAll('.landing-lead-select').forEach(cb => { cb.checked = false; });
  const selAll = document.getElementById('landingSelectAll');
  if (selAll) { selAll.checked = false; selAll.indeterminate = false; }
  updateLandingBulkBar();
};

// ── Landing Leads: delete single lead ──
window.deleteLandingLead = async function(id, btn) {
  if (!id) return;
  if (!confirm('确定删除这条记录？')) return;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    if (_db) {
      await _db.collection('landing_leads').doc(id).delete();
    } else {
      const leads = JSON.parse(localStorage.getItem('landing_leads_static') || '[]');
      localStorage.setItem('landing_leads_static', JSON.stringify(leads.filter(l => l.id !== id)));
    }
    const row = document.querySelector(`tr[data-lead-id="${id}"]`);
    if (row) row.remove();
    updateLandingBulkBar();
    loadLandingLeads();
    toast('✅ 记录已删除');
  } catch (err) {
    console.error('deleteLandingLead error:', err);
    toast('❌ 删除失败，请重试');
    if (btn) { btn.disabled = false; btn.textContent = '🗑'; }
  }
};

// ── Landing Leads: delete selected leads ──
window.deleteSelectedLandingLeads = async function() {
  const selected = [...document.querySelectorAll('.landing-lead-select:checked')];
  if (!selected.length) return;
  if (!confirm(`确定删除选中的 ${selected.length} 条记录？`)) return;

  const ids = selected.map(cb => cb.dataset.id).filter(Boolean);
  try {
    if (_db) {
      const batch = _db.batch();
      ids.forEach(id => batch.delete(_db.collection('landing_leads').doc(id)));
      await batch.commit();
    } else {
      const leads = JSON.parse(localStorage.getItem('landing_leads_static') || '[]');
      const idSet = new Set(ids);
      localStorage.setItem('landing_leads_static', JSON.stringify(leads.filter(l => !idSet.has(l.id))));
    }
    toast(`✅ 已删除 ${ids.length} 条记录`);
    loadLandingLeads();
  } catch (err) {
    console.error('deleteSelectedLandingLeads error:', err);
    toast('❌ 删除失败，请重试');
  }
};


// ──────────────────────────────────────────────────────
// Preview Leads Admin — reads from Firebase Firestore (preview_leads)
// ──────────────────────────────────────────────────────

const CHAMP_LEARNING_LEAD_SOURCE = 'Champ Learning Landing Page';
const CHAMP_PREVIEW_LEAD_SOURCE = 'Champ Preview Landing Page';

function isChampLearningLead(lead) {
  return lead.source === CHAMP_LEARNING_LEAD_SOURCE;
}

function isChampPreviewLead(lead) {
  return lead.source === CHAMP_PREVIEW_LEAD_SOURCE;
}

window.loadPreviewLeads = async function() {
  const tbody = document.getElementById('previewLeadsBody');
  const statsBar = document.getElementById('previewLeadsStats');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--muted)">⏳ 加载中...</td></tr>`;

  try {
    let leads = [];

    if (_db) {
      // Firebase mode: read from Firestore
      const snap = await _db.collection('preview_leads').orderBy('createdAt', 'desc').get();
      leads = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      // Fallback: local storage
      leads = JSON.parse(localStorage.getItem('preview_leads_static') || '[]');
    }

    leads = leads.filter(isChampLearningLead);

    window._previewLeadsCache = leads;

    const total = leads.length;

    if (statsBar) {
      const today = leads.filter(l => {
        const d = new Date(l.createdAt || l.date);
        const now = new Date();
        return d.toDateString() === now.toDateString();
      }).length;

      const states = {};
      leads.forEach(l => { if (l.state) states[l.state] = (states[l.state] || 0) + 1; });
      const topState = Object.entries(states).sort((a,b) => b[1]-a[1])[0];

      statsBar.innerHTML = `
        <div style="background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:12px 20px;display:flex;flex-direction:column;gap:2px;">
          <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">总报名人数</span>
          <strong style="font-size:22px;color:#6366F1;">${total}</strong>
        </div>
        <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:12px 20px;display:flex;flex-direction:column;gap:2px;">
          <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">今日新增</span>
          <strong style="font-size:22px;color:#10B981;">${today}</strong>
        </div>
        ${topState ? `<div style="background:rgba(245,166,35,0.1);border:1px solid rgba(245,166,35,0.2);border-radius:10px;padding:12px 20px;display:flex;flex-direction:column;gap:2px;">
          <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">最多州属</span>
          <strong style="font-size:16px;color:#F5A623;">${escapeHtml(topState[0])} (${topState[1]})</strong>
        </div>` : ''}
      `;
    }

    filterPreviewLeadsTable();

  } catch (err) {
    console.error('loadPreviewLeads error:', err);
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444;">⚠️ 加载失败，请刷新重试</td></tr>`;
    if (statsBar) statsBar.innerHTML = '';
  }
};

window._previewLeadsCache = [];

window.filterPreviewLeadsTable = function() {
  const query = (document.getElementById('previewSearchInput')?.value || '').trim().toLowerCase();
  const leads = window._previewLeadsCache || [];
  const filtered = !query ? leads : leads.filter(l => 
    (l.name || '').toLowerCase().includes(query) ||
    (l.phone || '').toLowerCase().includes(query) ||
    (l.email || '').toLowerCase().includes(query) ||
    (l.state || '').toLowerCase().includes(query)
  );
  renderPreviewLeadsRows(filtered, leads.length);
};

function renderPreviewLeadsRows(leads, totalCount) {
  const tbody = document.getElementById('previewLeadsBody');
  if (!tbody) return;
  if (!leads.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:60px;color:var(--muted)">📋 暂时没有符合条件的记录<br/><small style="opacity:0.6">当有用户通过 champ-learning 页面报名后，记录将自动同步到这里。</small></td></tr>`;
    return;
  }
  const selAll = document.getElementById('previewSelectAll');
  if (selAll) selAll.checked = false;
  updatePreviewBulkBar();

  tbody.innerHTML = leads.map((l, i) => {
    const date = new Date(l.createdAt || l.date);
    const dateStr = isNaN(date.getTime()) ? (l.date || '-') : new Intl.DateTimeFormat('zh-MY', {
      year:'numeric',month:'short',day:'2-digit',
      hour:'2-digit',minute:'2-digit'
    }).format(date);
    const wa = l.phone ? `<a href="https://wa.me/${l.phone.replace(/[^\d]/g,'')}" target="_blank" class="mini-button" style="background:#25D366;color:#fff;border-color:#25D366;text-decoration:none;">WA</a>` : '-';
    return `
      <tr data-lead-id="${escapeHtml(l.id || '')}">
        <td><input type="checkbox" class="preview-lead-select" data-id="${escapeHtml(l.id || '')}" onchange="updatePreviewBulkBar()"></td>
        <td style="color:var(--muted);font-size:13px;">${totalCount - i}</td>
        <td><strong>${escapeHtml(l.name || '-')}</strong></td>
        <td><span class="muted">${escapeHtml(l.phone || '-')}</span></td>
        <td><span class="muted">${escapeHtml(l.email || '-')}</span></td>
        <td><span class="badge" style="background:rgba(99,102,241,0.1);color:#6366F1;border:1px solid rgba(99,102,241,0.2);font-size:12px;">${escapeHtml(l.state || '-')}</span></td>
        <td style="font-size:12px;color:var(--muted);">${dateStr}</td>
        <td style="display:flex;gap:6px;align-items:center;">
          ${wa}
          <button class="mini-button" style="background:rgba(239,68,68,0.12);color:#ef4444;border-color:rgba(239,68,68,0.3);" onclick="deletePreviewLead('${escapeHtml(l.id || '')}', this)" title="删除这条记录">🗑</button>
        </td>
      </tr>
    `;
  }).join('');
}

window.exportPreviewLeadsCSV = async function() {
  try {
    let leads = [];
    if (_db) {
      const snap = await _db.collection('preview_leads').orderBy('createdAt', 'desc').get();
      leads = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      leads = JSON.parse(localStorage.getItem('preview_leads_static') || '[]');
    }
    leads = leads.filter(isChampLearningLead);
    if (!leads.length) { toast('暂时没有数据可以导出'); return; }

    const headers = ['编号','姓名','电话','Email','州属','报名时间'];
    const rows = leads.map((l, i) => [
      i + 1,
      l.name,
      l.phone,
      l.email,
      l.state,
      l.createdAt ? new Date(l.createdAt).toLocaleString('zh-MY') : (l.date || ''),
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `preview-leads-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`✅ 成功导出 ${leads.length} 条记录`);
  } catch {
    toast('❌ 导出失败，请重试');
  }
};

function updatePreviewBulkBar() {
  const checkboxes = document.querySelectorAll('.preview-lead-select');
  const selected   = document.querySelectorAll('.preview-lead-select:checked');
  const bar        = document.getElementById('previewBulkBar');
  const countEl    = document.getElementById('previewSelectedCount');
  const selAll     = document.getElementById('previewSelectAll');
  if (!bar) return;
  if (selected.length > 0) {
    bar.style.display = 'flex';
    countEl.textContent = `${selected.length} 选中`;
  } else {
    bar.style.display = 'none';
  }
  if (selAll) {
    selAll.checked = checkboxes.length > 0 && selected.length === checkboxes.length;
    selAll.indeterminate = selected.length > 0 && selected.length < checkboxes.length;
  }
}

window.toggleSelectAllPreviewLeads = function(masterCb) {
  document.querySelectorAll('.preview-lead-select').forEach(cb => { cb.checked = masterCb.checked; });
  updatePreviewBulkBar();
};

window.clearPreviewSelection = function() {
  document.querySelectorAll('.preview-lead-select').forEach(cb => { cb.checked = false; });
  const selAll = document.getElementById('previewSelectAll');
  if (selAll) { selAll.checked = false; selAll.indeterminate = false; }
  updatePreviewBulkBar();
};

window.deletePreviewLead = async function(id, btn) {
  if (!id) return;
  if (!confirm('确定删除这条记录？')) return;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    if (_db) {
      await _db.collection('preview_leads').doc(id).delete();
    } else {
      const leads = JSON.parse(localStorage.getItem('preview_leads_static') || '[]');
      localStorage.setItem('preview_leads_static', JSON.stringify(leads.filter(l => l.id !== id)));
    }
    const row = document.querySelector(`tr[data-lead-id="${id}"]`);
    if (row) row.remove();
    updatePreviewBulkBar();
    loadPreviewLeads();
    toast('✅ 记录已删除');
  } catch (err) {
    console.error('deletePreviewLead error:', err);
    toast('❌ 删除失败，请重试');
    if (btn) { btn.disabled = false; btn.textContent = '🗑'; }
  }
};

window.deleteSelectedPreviewLeads = async function() {
  const selected = [...document.querySelectorAll('.preview-lead-select:checked')];
  if (!selected.length) return;
  if (!confirm(`确定删除选中的 ${selected.length} 条记录？`)) return;

  const ids = selected.map(cb => cb.dataset.id).filter(Boolean);
  try {
    if (_db) {
      const batch = _db.batch();
      ids.forEach(id => batch.delete(_db.collection('preview_leads').doc(id)));
      await batch.commit();
    } else {
      const leads = JSON.parse(localStorage.getItem('preview_leads_static') || '[]');
      const idSet = new Set(ids);
      localStorage.setItem('preview_leads_static', JSON.stringify(leads.filter(l => !idSet.has(l.id))));
    }
    toast(`✅ 已删除 ${ids.length} 条记录`);
    loadPreviewLeads();
  } catch (err) {
    console.error('deleteSelectedPreviewLeads error:', err);
    toast('❌ 删除失败，请重试');
  }
};


// ──────────────────────────────────────────────────────
// Landing Leads (Champ Preview) Admin — reads from Firebase Firestore (preview_leads)
// ──────────────────────────────────────────────────────

window.loadChampPreviewLeads = async function() {
  const tbody = document.getElementById('champPreviewLeadsBody');
  const statsBar = document.getElementById('champPreviewLeadsStats');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--muted)">⏳ 加载中...</td></tr>`;

  try {
    let leads = [];

    if (_db) {
      const snap = await _db.collection('preview_leads').orderBy('createdAt', 'desc').get();
      leads = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      leads = JSON.parse(localStorage.getItem('preview_leads_static') || '[]');
    }

    leads = leads.filter(isChampPreviewLead);

    window._champPreviewLeadsCache = leads;

    const total = leads.length;

    if (statsBar) {
      const today = leads.filter(l => {
        const d = new Date(l.createdAt || l.date);
        const now = new Date();
        return d.toDateString() === now.toDateString();
      }).length;

      const states = {};
      leads.forEach(l => { if (l.state) states[l.state] = (states[l.state] || 0) + 1; });
      const topState = Object.entries(states).sort((a,b) => b[1]-a[1])[0];

      statsBar.innerHTML = `
        <div style="background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:12px 20px;display:flex;flex-direction:column;gap:2px;">
          <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">总报名人数</span>
          <strong style="font-size:22px;color:#6366F1;">${total}</strong>
        </div>
        <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:12px 20px;display:flex;flex-direction:column;gap:2px;">
          <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">今日新增</span>
          <strong style="font-size:22px;color:#10B981;">${today}</strong>
        </div>
        ${topState ? `<div style="background:rgba(245,166,35,0.1);border:1px solid rgba(245,166,35,0.2);border-radius:10px;padding:12px 20px;display:flex;flex-direction:column;gap:2px;">
          <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">最多州属</span>
          <strong style="font-size:16px;color:#F5A623;">${escapeHtml(topState[0])} (${topState[1]})</strong>
        </div>` : ''}
      `;
    }

    filterChampPreviewLeadsTable();

  } catch (err) {
    console.error('loadChampPreviewLeads error:', err);
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444;">⚠️ 加载失败，请刷新重试</td></tr>`;
    if (statsBar) statsBar.innerHTML = '';
  }
};

window._champPreviewLeadsCache = [];

window.filterChampPreviewLeadsTable = function() {
  const query = (document.getElementById('champPreviewSearchInput')?.value || '').trim().toLowerCase();
  const leads = window._champPreviewLeadsCache || [];
  const filtered = !query ? leads : leads.filter(l => 
    (l.name || '').toLowerCase().includes(query) ||
    (l.phone || '').toLowerCase().includes(query) ||
    (l.email || '').toLowerCase().includes(query) ||
    (l.state || '').toLowerCase().includes(query)
  );
  renderChampPreviewLeadsRows(filtered, leads.length);
};

function renderChampPreviewLeadsRows(leads, totalCount) {
  const tbody = document.getElementById('champPreviewLeadsBody');
  if (!tbody) return;
  if (!leads.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:60px;color:var(--muted)">📋 暂时没有符合条件的记录<br/><small style="opacity:0.6">当有用户通过 champ-preview 链接报名后，记录将自动同步到这里。</small></td></tr>`;
    return;
  }
  const selAll = document.getElementById('champPreviewSelectAll');
  if (selAll) selAll.checked = false;
  updateChampPreviewBulkBar();

  tbody.innerHTML = leads.map((l, i) => {
    const date = new Date(l.createdAt || l.date);
    const dateStr = isNaN(date.getTime()) ? (l.date || '-') : new Intl.DateTimeFormat('zh-MY', {
      year:'numeric',month:'short',day:'2-digit',
      hour:'2-digit',minute:'2-digit'
    }).format(date);
    const wa = l.phone ? `<a href="https://wa.me/${l.phone.replace(/[^\d]/g,'')}" target="_blank" class="mini-button" style="background:#25D366;color:#fff;border-color:#25D366;text-decoration:none;">WA</a>` : '-';
    return `
      <tr data-lead-id="${escapeHtml(l.id || '')}">
        <td><input type="checkbox" class="champ-preview-lead-select" data-id="${escapeHtml(l.id || '')}" onchange="updateChampPreviewBulkBar()"></td>
        <td style="color:var(--muted);font-size:13px;">${totalCount - i}</td>
        <td><strong>${escapeHtml(l.name || '-')}</strong></td>
        <td><span class="muted">${escapeHtml(l.phone || '-')}</span></td>
        <td><span class="muted">${escapeHtml(l.email || '-')}</span></td>
        <td><span class="badge" style="background:rgba(99,102,241,0.1);color:#6366F1;border:1px solid rgba(99,102,241,0.2);font-size:12px;">${escapeHtml(l.state || '-')}</span></td>
        <td style="font-size:12px;color:var(--muted);">${dateStr}</td>
        <td style="display:flex;gap:6px;align-items:center;">
          ${wa}
          <button class="mini-button" style="background:rgba(239,68,68,0.12);color:#ef4444;border-color:rgba(239,68,68,0.3);" onclick="deleteChampPreviewLead('${escapeHtml(l.id || '')}', this)" title="删除这条记录">🗑</button>
        </td>
      </tr>
    `;
  }).join('');
}

window.exportChampPreviewLeadsCSV = async function() {
  try {
    let leads = [];
    if (_db) {
      const snap = await _db.collection('preview_leads').orderBy('createdAt', 'desc').get();
      leads = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      leads = JSON.parse(localStorage.getItem('preview_leads_static') || '[]');
    }
    leads = leads.filter(isChampPreviewLead);
    if (!leads.length) { toast('暂时没有数据可以导出'); return; }

    const headers = ['编号','姓名','电话','Email','州属','报名时间'];
    const rows = leads.map((l, i) => [
      i + 1,
      l.name,
      l.phone,
      l.email,
      l.state,
      l.createdAt ? new Date(l.createdAt).toLocaleString('zh-MY') : (l.date || ''),
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
    toast('❌ 导出失败，请重试');
  }
};

function updateChampPreviewBulkBar() {
  const checkboxes = document.querySelectorAll('.champ-preview-lead-select');
  const selected   = document.querySelectorAll('.champ-preview-lead-select:checked');
  const bar        = document.getElementById('champPreviewBulkBar');
  const countEl    = document.getElementById('champPreviewSelectedCount');
  const selAll     = document.getElementById('champPreviewSelectAll');
  if (!bar) return;
  if (selected.length > 0) {
    bar.style.display = 'flex';
    countEl.textContent = `${selected.length} 选中`;
  } else {
    bar.style.display = 'none';
  }
  if (selAll) {
    selAll.checked = checkboxes.length > 0 && selected.length === checkboxes.length;
    selAll.indeterminate = selected.length > 0 && selected.length < checkboxes.length;
  }
}

window.toggleSelectAllChampPreviewLeads = function(masterCb) {
  document.querySelectorAll('.champ-preview-lead-select').forEach(cb => { cb.checked = masterCb.checked; });
  updateChampPreviewBulkBar();
};

window.clearChampPreviewSelection = function() {
  document.querySelectorAll('.champ-preview-lead-select').forEach(cb => { cb.checked = false; });
  const selAll = document.getElementById('champPreviewSelectAll');
  if (selAll) { selAll.checked = false; selAll.indeterminate = false; }
  updateChampPreviewBulkBar();
};

window.deleteChampPreviewLead = async function(id, btn) {
  if (!id) return;
  if (!confirm('确定删除这条记录？')) return;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    if (_db) {
      await _db.collection('preview_leads').doc(id).delete();
    } else {
      const leads = JSON.parse(localStorage.getItem('preview_leads_static') || '[]');
      localStorage.setItem('preview_leads_static', JSON.stringify(leads.filter(l => l.id !== id)));
    }
    const row = document.querySelector(`tr[data-lead-id="${id}"]`);
    if (row) row.remove();
    updateChampPreviewBulkBar();
    loadChampPreviewLeads();
    toast('✅ 记录已删除');
  } catch (err) {
    console.error('deleteChampPreviewLead error:', err);
    toast('❌ 删除失败，请重试');
    if (btn) { btn.disabled = false; btn.textContent = '🗑'; }
  }
};

window.deleteSelectedChampPreviewLeads = async function() {
  const selected = [...document.querySelectorAll('.champ-preview-lead-select:checked')];
  if (!selected.length) return;
  if (!confirm(`确定删除选中的 ${selected.length} 条记录？`)) return;

  const ids = selected.map(cb => cb.dataset.id).filter(Boolean);
  try {
    if (_db) {
      const batch = _db.batch();
      ids.forEach(id => batch.delete(_db.collection('preview_leads').doc(id)));
      await batch.commit();
    } else {
      const leads = JSON.parse(localStorage.getItem('preview_leads_static') || '[]');
      const idSet = new Set(ids);
      localStorage.setItem('preview_leads_static', JSON.stringify(leads.filter(l => !idSet.has(l.id))));
    }
    toast(`✅ 已删除 ${ids.length} 条记录`);
    loadChampPreviewLeads();
  } catch (err) {
    console.error('deleteSelectedChampPreviewLeads error:', err);
    toast('❌ 删除失败，请重试');
  }
};
