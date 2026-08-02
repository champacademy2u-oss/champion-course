// Smoke test for server.js landing-leads API key guard.
// Spawns the real server on a throwaway port, then verifies:
//   1. With no LANDING_LEADS_API_KEY set -> endpoint is open (200).
//   2. With LANDING_LEADS_API_KEY set -> endpoint requires the key (401 vs 200).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "..", "server.js");
const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;

function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SERVER], {
      env: { ...process.env, PORT: String(PORT), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const onData = (d) => {
      out += d.toString();
      if (out.includes("listening")) resolve(child);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`server exited early code=${code}: ${out}`)));
    setTimeout(() => reject(new Error("server did not start in time")), 5000);
  });
}

function stop(child) {
  try { child.kill("SIGTERM"); } catch {}
}

test("landing-leads endpoint is open when no API key is configured", async () => {
  const child = await startServer({});
  try {
    const res = await fetch(`${BASE}/api/landing-leads`);
    assert.equal(res.status, 200, "expected 200 when API key unset");
    const body = await res.json();
    assert.ok("leads" in body && "total" in body, "expected {leads,total} shape");
  } finally {
    stop(child);
  }
});

test("landing-leads endpoint requires API key when configured", async () => {
  const child = await startServer({ LANDING_LEADS_API_KEY: "secret-123" });
  try {
    // No key -> 401
    const noKey = await fetch(`${BASE}/api/landing-leads`);
    assert.equal(noKey.status, 401, "expected 401 without key");

    // Wrong key -> 401
    const wrongKey = await fetch(`${BASE}/api/landing-leads?key=nope`);
    assert.equal(wrongKey.status, 401, "expected 401 with wrong key");

    // Correct key via query -> 200
    const okQuery = await fetch(`${BASE}/api/landing-leads?key=secret-123`);
    assert.equal(okQuery.status, 200, "expected 200 with correct key (query)");

    // Correct key via bearer header -> 200
    const okBearer = await fetch(`${BASE}/api/landing-leads`, {
      headers: { authorization: "Bearer secret-123" },
    });
    assert.equal(okBearer.status, 200, "expected 200 with correct key (bearer)");
  } finally {
    stop(child);
  }
});
