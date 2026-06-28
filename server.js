import "dotenv/config";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Landing Leads Storage ──
const LANDING_LEADS_FILE = path.join(__dirname, "landing-leads.json");

function readLandingLeads() {
  try {
    if (!fs.existsSync(LANDING_LEADS_FILE)) return [];
    return JSON.parse(fs.readFileSync(LANDING_LEADS_FILE, "utf8"));
  } catch { return []; }
}

function saveLandingLead(lead) {
  const leads = readLandingLeads();
  leads.unshift(lead); // newest first
  fs.writeFileSync(LANDING_LEADS_FILE, JSON.stringify(leads, null, 2), "utf8");
}

const config = {
  port: Number(process.env.PORT || 4175),
  host: process.env.HOST || "127.0.0.1",
  graphVersion: process.env.META_GRAPH_VERSION || "v21.0",
  verifyToken: process.env.META_VERIFY_TOKEN || "",
  appSecret: process.env.META_APP_SECRET || "",
  pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || "",
  pageAccessTokens: parsePageAccessTokens(process.env.META_PAGE_ACCESS_TOKENS || ""),
  driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || "",
  driveCsvName: process.env.GOOGLE_DRIVE_CSV_NAME || "facebook-leads.csv",
  serviceAccountFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "",
  serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
};

const csvHeaders = [
  "leadgen_id",
  "created_time",
  "full_name",
  "phone_number",
  "email",
  "job_title",
  "page_id",
  "form_id",
  "ad_id",
  "adgroup_id",
  "campaign_id",
  "raw_fields_json",
];

let appendQueue = Promise.resolve();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // ── Health check ──
    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    // ── Serve landing page ──
    if (req.method === "GET" && pathname === "/landing") {
      return serveFile(res, path.join(__dirname, "landing.html"), "text/html");
    }

    // ── Serve main app ──
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      return serveFile(res, path.join(__dirname, "index.html"), "text/html");
    }

    // ── Serve static assets (css, js, png, etc.) ──
    if (req.method === "GET" && /\.(css|js|png|jpg|jpeg|gif|ico|svg|json|woff2?)$/.test(pathname)) {
      const filePath = path.join(__dirname, pathname);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(pathname).slice(1);
        const mimeMap = {
          css: "text/css", js: "application/javascript",
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          gif: "image/gif", ico: "image/x-icon", svg: "image/svg+xml",
          json: "application/json", woff: "font/woff", woff2: "font/woff2",
        };
        const mime = mimeMap[ext] || "application/octet-stream";
        return serveFile(res, filePath, mime);
      }
    }

    // ── Download ebook ──
    if (req.method === "GET" && pathname === "/download-ebook") {
      const ebookName = "世界级营销100招( 流量密码2.0） .pdf";
      const ebookPath = path.join(__dirname, ebookName);
      if (!fs.existsSync(ebookPath)) {
        return sendJson(res, 404, { error: "Ebook not found" });
      }
      const stat = fs.statSync(ebookPath);
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(ebookName)}`,
        "Content-Length": stat.size,
        "Cache-Control": "no-store",
      });
      return fs.createReadStream(ebookPath).pipe(res);
    }

    // ── POST: Submit landing lead ──
    if (req.method === "POST" && pathname === "/api/landing-leads") {
      const body = await readBody(req);
      let data;
      try { data = JSON.parse(body); } catch { return sendJson(res, 400, { error: "Invalid JSON" }); }

      const { name, phone, industry, challenge } = data;
      if (!name || !phone || !industry || !challenge) {
        return sendJson(res, 400, { error: "Missing required fields" });
      }

      const lead = {
        id: Date.now().toString(),
        name: String(name).trim(),
        phone: String(phone).trim(),
        industry: String(industry).trim(),
        challenge: String(challenge).trim(),
        createdAt: new Date().toISOString(),
      };

      saveLandingLead(lead);
      console.log(`[Landing Lead] ${lead.name} (${lead.phone}) — ${lead.industry}`);
      return sendJson(res, 200, { ok: true, message: "Lead saved" });
    }

    // ── GET: List landing leads (admin) ──
    if (req.method === "GET" && pathname === "/api/landing-leads") {
      const leads = readLandingLeads();
      return sendJson(res, 200, { leads, total: leads.length });
    }

    // ── Webhook routes ──
    if (req.method === "GET" && pathname.startsWith("/webhook")) {
      return verifyWebhook(req, res);
    }

    if (req.method === "POST" && pathname.startsWith("/webhook")) {
      return receiveWebhook(req, res);
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Lead webhook server listening on http://${config.host}:${config.port}`);
  logConfigWarnings();
});

function logConfigWarnings() {
  const missing = [];
  if (!config.verifyToken) missing.push("META_VERIFY_TOKEN");
  if (!config.appSecret) missing.push("META_APP_SECRET");
  if (!config.pageAccessToken && config.pageAccessTokens.size === 0) {
    missing.push("META_PAGE_ACCESS_TOKEN or META_PAGE_ACCESS_TOKENS");
  }
  if (!config.driveFolderId) missing.push("GOOGLE_DRIVE_FOLDER_ID");
  if (!config.serviceAccountFile && !config.serviceAccountJson) {
    missing.push("GOOGLE_SERVICE_ACCOUNT_FILE or GOOGLE_SERVICE_ACCOUNT_JSON");
  }

  if (missing.length) {
    console.warn(`Missing config: ${missing.join(", ")}`);
    console.warn("Run npm run check:config for setup details.");
  }
}

function verifyWebhook(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === config.verifyToken) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(challenge || "");
    return;
  }

  sendJson(res, 403, { error: "Webhook verification failed" });
}

async function receiveWebhook(req, res) {
  const rawBody = await readRawBody(req);
  if (!isValidMetaSignature(req, rawBody)) {
    sendJson(res, 403, { error: "Invalid Meta signature" });
    return;
  }

  const payload = JSON.parse(rawBody.toString("utf8"));
  const leadEvents = extractLeadEvents(payload);

  appendQueue = appendQueue
    .then(async () => {
      for (const event of leadEvents) {
        const lead = await fetchLead(event);
        await appendLeadToDriveCsv(toCsvRecord(event, lead));
      }
    })
    .catch((error) => {
      console.error("Lead append failed:", error);
    });

  sendJson(res, 200, { received: true, leadsQueued: leadEvents.length });
}

function isValidMetaSignature(req, rawBody) {
  if (!config.appSecret) return false;
  const signature = req.headers["x-hub-signature-256"];
  if (!signature || !String(signature).startsWith("sha256=")) return false;

  const expected = "sha256=" + crypto.createHmac("sha256", config.appSecret).update(rawBody).digest("hex");
  const actualBuffer = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function extractLeadEvents(payload) {
  const events = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "leadgen" || !change.value?.leadgen_id) continue;
      events.push({
        leadgen_id: String(change.value.leadgen_id),
        page_id: String(change.value.page_id || entry.id || ""),
        form_id: String(change.value.form_id || ""),
        ad_id: String(change.value.ad_id || ""),
        adgroup_id: String(change.value.adgroup_id || ""),
        created_time: change.value.created_time ? new Date(change.value.created_time * 1000).toISOString() : "",
      });
    }
  }
  return events;
}

async function fetchLead(event) {
  const accessToken = getPageAccessToken(event.page_id);
  if (!accessToken) {
    throw new Error(`No Page Access Token configured for page_id ${event.page_id || "(unknown)"}`);
  }

  const fields = "created_time,id,ad_id,form_id,campaign_id,field_data";
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${event.leadgen_id}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Meta Graph API error: ${JSON.stringify(body)}`);
  }
  return body;
}

function getPageAccessToken(pageId) {
  if (pageId && config.pageAccessTokens.has(String(pageId))) {
    return config.pageAccessTokens.get(String(pageId));
  }
  return config.pageAccessToken;
}

function parsePageAccessTokens(value) {
  const tokens = new Map();
  if (!value.trim()) return tokens;

  try {
    const parsed = JSON.parse(value);
    for (const [pageId, token] of Object.entries(parsed)) {
      if (pageId && token) tokens.set(String(pageId), String(token));
    }
    return tokens;
  } catch {
    for (const pair of value.split(",")) {
      const [pageId, token] = pair.split(":");
      if (pageId?.trim() && token?.trim()) {
        tokens.set(pageId.trim(), token.trim());
      }
    }
    return tokens;
  }
}

function toCsvRecord(event, lead) {
  const fields = Object.fromEntries(
    (lead.field_data || []).map((field) => [field.name, Array.isArray(field.values) ? field.values.join("; ") : ""])
  );

  return {
    leadgen_id: lead.id || event.leadgen_id,
    created_time: lead.created_time || event.created_time,
    full_name: fields.full_name || fields.name || "",
    phone_number: fields.phone_number || fields.phone || "",
    email: fields.email || "",
    job_title: fields.job_title || fields.job || "",
    page_id: event.page_id,
    form_id: lead.form_id || event.form_id,
    ad_id: lead.ad_id || event.ad_id,
    adgroup_id: event.adgroup_id,
    campaign_id: lead.campaign_id || "",
    raw_fields_json: JSON.stringify(fields),
  };
}

async function appendLeadToDriveCsv(record) {
  const drive = await getDriveClient();
  const file = await findDriveCsv(drive);
  const row = csvHeaders.map((header) => csvCell(record[header] || "")).join(",");

  if (!file) {
    const content = `${csvHeaders.join(",")}\n${row}\n`;
    await createDriveCsv(drive, content);
    console.log(`Created ${config.driveCsvName} with lead ${record.leadgen_id}`);
    return;
  }

  const existing = await downloadDriveFile(drive, file.id);
  if (csvContainsLead(existing, record.leadgen_id)) {
    console.log(`Skipped duplicate lead ${record.leadgen_id}`);
    return;
  }

  const separator = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
  await updateDriveCsv(drive, file.id, `${existing}${separator}${row}\n`);
  console.log(`Appended lead ${record.leadgen_id} to ${config.driveCsvName}`);
}

async function getDriveClient() {
  if (!config.driveFolderId) throw new Error("GOOGLE_DRIVE_FOLDER_ID is required");

  const authOptions = {
    scopes: ["https://www.googleapis.com/auth/drive"],
  };

  if (config.serviceAccountJson) {
    authOptions.credentials = JSON.parse(config.serviceAccountJson);
  } else if (config.serviceAccountFile) {
    authOptions.keyFile = config.serviceAccountFile;
  } else {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_FILE or GOOGLE_SERVICE_ACCOUNT_JSON is required");
  }

  const auth = new google.auth.GoogleAuth(authOptions);
  return google.drive({ version: "v3", auth });
}

async function findDriveCsv(drive) {
  const escapedName = config.driveCsvName.replaceAll("'", "\\'");
  const response = await drive.files.list({
    q: `'${config.driveFolderId}' in parents and name = '${escapedName}' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
  });
  return response.data.files?.[0] || null;
}

async function createDriveCsv(drive, content) {
  await drive.files.create({
    requestBody: {
      name: config.driveCsvName,
      parents: [config.driveFolderId],
      mimeType: "text/csv",
    },
    media: {
      mimeType: "text/csv",
      body: Readable.from([content]),
    },
    fields: "id",
  });
}

async function updateDriveCsv(drive, fileId, content) {
  await drive.files.update({
    fileId,
    media: {
      mimeType: "text/csv",
      body: Readable.from([content]),
    },
  });
}

async function downloadDriveFile(drive, fileId) {
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(response.data).toString("utf8");
}

function csvContainsLead(csv, leadgenId) {
  const escaped = csvCell(leadgenId);
  return csv.split(/\r?\n/).slice(1).some((line) => line.split(",", 1)[0] === escaped);
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readBody(req) {
  return readRawBody(req).then((buf) => buf.toString("utf8"));
}

function serveFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
