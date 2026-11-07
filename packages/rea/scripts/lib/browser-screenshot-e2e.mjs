import {
  requireMcpOutput,
  requireMcpToolError,
} from "./mcp-verifier-results.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../../dist/domain/evidence.js";
import { webScreenshotSchema } from "../../dist/domain/webScreenshot.js";
import { comparePngScreenshots } from "../../dist/browser/PngVisualDiff.js";

/** Verify a real, large PNG through production CLI and stdio MCP boundaries. */
export async function verifyLargeScreenshotE2e(endpoint, origin) {
  const browser = await chromium.connectOverCDP(endpoint);
  const context = await browser.newContext({
    viewport: { width: 2048, height: 1536 },
    deviceScaleFactor: 1,
  });
  const entrypoint = fileURLToPath(new URL("../rea.mjs", import.meta.url));
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    REA_LOG_LEVEL: "silent",
    HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
  };
  let client;
  let transport;
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/screenshot-noise`);
    await page.waitForFunction(() => document.body.dataset.ready === "true");
    const targets = await (await fetch(`${endpoint}/json/list`)).json();
    const target = targets.find((value) => value.url === page.url());
    assert.ok(
      target,
      "Owned screenshot page is absent from actual CDP discovery",
    );
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        entrypoint,
        "capture-web-screenshot",
        endpoint,
        target.id,
        "--allowed-origins",
        origin,
        "--json",
      ],
      { env, timeout: 60000, maxBuffer: 72 * 1024 * 1024 },
    );
    const cliEvidence = parseEvidence(JSON.parse(stdout));
    assert.equal(cliEvidence.operation, "capture_web_screenshot");
    const screenshot = webScreenshotSchema.parse(cliEvidence.normalized_result);
    assert.ok(
      screenshot.artifact.bytes > 8 * 1024 * 1024,
      "Real PNG did not cross the former screenshot byte ceiling",
    );
    const bytes = Buffer.from(screenshot.artifact.data_base64, "base64");
    assert.equal(bytes.byteLength, screenshot.artifact.bytes);
    assert.deepEqual(
      bytes.subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    assert.equal(bytes.readUInt32BE(16), 2048);
    assert.equal(bytes.readUInt32BE(20), 1536);
    await verifyDefaultScreenshotDelivery({
      entrypoint,
      environment: env,
      endpoint,
      targetId: target.id,
      screenshot,
    });
    const maxBufferSize = 64 * 1024 * 1024;
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      env: { ...env, REA_MCP_MAX_RESPONSE_BYTES: String(maxBufferSize) },
      stderr: "pipe",
      // The SDK defaults to a 10 MiB receive buffer; inline PNG output is larger.
      maxBufferSize,
    });
    client = new Client({ name: "browser-screenshot-real-e2e", version: "1" });
    await client.connect(transport);
    const captured = await client.callTool(
      {
        name: "capture_web_screenshot",
        arguments: {
          cdp_endpoint: endpoint,
          target_id: target.id,
        },
      },
      { timeout: 60000 },
    );
    assert.notEqual(captured.isError, true, JSON.stringify(captured));
    assert.notEqual(captured.structuredContent, undefined);
    const mcpEvidence = parseEvidence(
      requireMcpOutput(captured, "capture_web_screenshot"),
    );
    const mcpScreenshot = mcpEvidence.normalized_result;
    assert.deepEqual(mcpScreenshot.artifact, screenshot.artifact);
    const compared = comparePngScreenshots({
      before: screenshot.artifact,
      after: mcpScreenshot.artifact,
      channel_threshold: 0,
    });
    assert.equal(compared.status, "identical");
    assert.equal(compared.changed_pixels, 0);
    return {
      mocked: false,
      cli: true,
      stdio_mcp: true,
      default_buffer_recovery: true,
      complete_export: true,
      matched_large_buffer: true,
      png_bytes: bytes.byteLength,
    };
  } finally {
    try {
      if (client !== undefined) await client.close();
    } finally {
      try {
        if (transport !== undefined) await transport.close();
      } finally {
        await context.close();
        await browser.close();
      }
    }
  }
}

const verifyDefaultScreenshotDelivery = async ({
  entrypoint,
  environment,
  endpoint,
  targetId,
  screenshot,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), "rea-screenshot-delivery-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    env: environment,
    stderr: "pipe",
  });
  const client = new Client({
    name: "browser-screenshot-default-e2e",
    version: "1",
  });
  try {
    await client.connect(transport);
    const constrained = await client.callTool(
      {
        name: "capture_web_screenshot",
        arguments: { cdp_endpoint: endpoint, target_id: targetId },
      },
      { timeout: 60000 },
    );
    assert.equal(constrained.isError, true);
    assert.equal(
      requireMcpToolError(constrained)?.details?.resource,
      "transport",
    );
    const reference =
      requireMcpToolError(constrained)?.details?.reported_limits
        ?.evidence_reference;
    assert.equal(reference?.kind, "retained-evidence");
    await client.ping();
    const exported = await client.callTool({
      name: "export_evidence_bundle",
      arguments: { path: join(workspace, "screenshot-evidence.json") },
    });
    assert.notEqual(exported.isError, true, JSON.stringify(exported));
    const bundle = JSON.parse(
      await readFile(join(workspace, "screenshot-evidence.json"), "utf8"),
    );
    const record = bundle.records.find(
      (record) => record.evidence_id === reference.evidence_id,
    );
    assert.ok(
      record,
      "Full screenshot Evidence must remain exportable after the delivery constraint",
    );
    const retained = webScreenshotSchema.parse(
      parseEvidence(record).normalized_result,
    );
    assert.deepEqual(retained.artifact, screenshot.artifact);
    await client.ping();
  } finally {
    try {
      await client.close();
    } finally {
      try {
        await transport.close();
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    }
  }
};
