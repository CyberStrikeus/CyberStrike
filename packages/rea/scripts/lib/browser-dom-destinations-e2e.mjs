import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { parseEvidence } from "../../dist/domain/evidence.js";
import { assertFormDestinations } from "./browser-verifier-assertions.mjs";
import { mcpTextValue } from "./mcp-verifier-results.mjs";

/** Verify the real fixture's form destinations through CLI and stdio MCP. */
export async function verifyBrowserDomDestinations(
  attachment,
  entrypoint = fileURLToPath(new URL("../rea.mjs", import.meta.url)),
  documentUrl,
) {
  const env = { ...process.env, REA_LOG_LEVEL: "silent" };
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      entrypoint,
      "inspect-web-page",
      attachment.cdp_endpoint,
      attachment.target_id,
      "--observation-ms",
      "100",
      "--json",
    ],
    { env, timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
  );
  assertFormDestinations(
    parseEvidence(JSON.parse(stdout)).normalized_result,
    documentUrl,
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "browser-dom-destinations", version: "1" });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "inspect_web_page",
      arguments: { ...attachment, observation_ms: 100 },
    });
    assert.notEqual(result.isError, true, mcpTextValue(result));
    assertFormDestinations(
      parseEvidence(JSON.parse(mcpTextValue(result))).normalized_result,
      documentUrl,
    );
    return { cli: true, stdio_mcp: true, current_document_destinations: 4 };
  } finally {
    await client.close();
    await transport.close();
  }
}
