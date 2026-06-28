import "dotenv/config";

const graphVersion = process.env.META_GRAPH_VERSION || "v21.0";
const pageTokens = parsePageAccessTokens(process.env.META_PAGE_ACCESS_TOKENS || "");

if (pageTokens.size === 0 && process.env.META_PAGE_ID && process.env.META_PAGE_ACCESS_TOKEN) {
  pageTokens.set(process.env.META_PAGE_ID, process.env.META_PAGE_ACCESS_TOKEN);
}

if (pageTokens.size === 0) {
  console.error("No pages configured. Set META_PAGE_ACCESS_TOKENS or META_PAGE_ID + META_PAGE_ACCESS_TOKEN in .env.");
  process.exit(1);
}

let failed = false;

for (const [pageId, accessToken] of pageTokens) {
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${pageId}/subscribed_apps`);
  url.searchParams.set("subscribed_fields", "leadgen");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url, { method: "POST" });
  const body = await response.json();

  if (!response.ok || body.success !== true) {
    failed = true;
    console.error(`Failed to subscribe page ${pageId}: ${JSON.stringify(body)}`);
    continue;
  }

  console.log(`Subscribed page ${pageId} to leadgen webhook.`);
}

if (failed) process.exit(1);

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
