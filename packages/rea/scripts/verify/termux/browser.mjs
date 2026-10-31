#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";

const execute = promisify(execFile);
assert.equal(process.platform, "android", "Run this verifier inside Termux");
assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, undefined);
// Import no browser provider here: the public dispatcher must establish its
// Android cache fallback before Playwright initializes in each subprocess.
const { stdout: doctorOutput } = await execute(
  process.execPath,
  ["scripts/rea.mjs", "mcp", "doctor", "--format", "json"],
  { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
);
assert.equal(JSON.parse(doctorOutput).healthy, true, doctorOutput);
const executable = `${process.env.PREFIX}/bin/chromium`;
const { stdout: chromiumVersion } = await execute(executable, ["--version"], {
  timeout: 30_000,
});
const marker = "rea-termux-browser-smoke";
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><body><h1>${marker}</h1></body></html>`);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
try {
  const url = `http://127.0.0.1:${server.address().port}/smoke`;
  const scenario = {
    browser: { mode: "launch", executable_path: executable },
    start_url: { url },
    actions: [
      {
        step_id: "ready",
        action: "wait_for",
        locator: { kind: "css", selector: "h1" },
        state: "visible",
      },
    ],
    capture: { at_end: ["url", "dom"] },
  };
  const { stdout } = await execute(
    process.execPath,
    [
      "scripts/rea.mjs",
      "capture-browser-scenario",
      JSON.stringify(scenario),
      "--json",
    ],
    { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const evidence = JSON.parse(stdout);
  assert.equal(evidence.error, undefined, stdout);
  const capture = evidence.normalized_result;
  assert.ok(
    capture.steps.every((step) => step.status === "completed"),
    stdout,
  );
  const artifacts = capture.steps.at(-1).artifacts;
  assert.equal(artifacts.url.state, "captured", stdout);
  assert.equal(artifacts.url.value.url, url);
  assert.equal(artifacts.dom.state, "captured", stdout);
  assert.ok(artifacts.dom.value.text.includes(`<h1>${marker}</h1>`), stdout);
  assert.equal(capture.browser.cleanup, "terminated-owned-process");
  console.log(
    JSON.stringify({
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      chromium: chromiumVersion.trim(),
      mcp_doctor: "healthy",
      url_capture: "passed",
      dom_capture: "passed",
      cleanup: capture.browser.cleanup,
    }),
  );
} finally {
  await new Promise((resolve, reject) =>
    server.close((cause) => (cause ? reject(cause) : resolve())),
  );
}
