import "dotenv/config";
import fs from "node:fs";

const required = [
  ["META_VERIFY_TOKEN", "Meta webhook verification token"],
  ["META_APP_SECRET", "Meta App Secret"],
  ["GOOGLE_DRIVE_FOLDER_ID", "Google Drive folder id"],
];

let ok = true;

for (const [key, label] of required) {
  if (!process.env[key]) {
    console.log(`Missing ${key}: ${label}`);
    ok = false;
  }
}

if (!process.env.META_PAGE_ACCESS_TOKEN && !process.env.META_PAGE_ACCESS_TOKENS) {
  console.log("Missing META_PAGE_ACCESS_TOKEN or META_PAGE_ACCESS_TOKENS: one or more long-lived Facebook Page Access Tokens");
  ok = false;
}

if (process.env.META_PAGE_ACCESS_TOKENS) {
  try {
    const parsed = JSON.parse(process.env.META_PAGE_ACCESS_TOKENS);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
      throw new Error("Expected a JSON object");
    }
  } catch {
    console.log('Invalid META_PAGE_ACCESS_TOKENS: use JSON like {"page_id":"page-token"}');
    ok = false;
  }
}

if (!process.env.GOOGLE_SERVICE_ACCOUNT_FILE && !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.log("Missing GOOGLE_SERVICE_ACCOUNT_FILE or GOOGLE_SERVICE_ACCOUNT_JSON: Google service account credentials");
  ok = false;
}

if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE && !fs.existsSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE)) {
  console.log(`Missing file ${process.env.GOOGLE_SERVICE_ACCOUNT_FILE}: put the Google service account JSON here`);
  ok = false;
}

if (!ok) {
  console.log("\nConfig is not ready yet. Fill .env, then run npm run check:config again.");
  process.exit(1);
}

console.log("Config looks ready. You can run npm start.");
