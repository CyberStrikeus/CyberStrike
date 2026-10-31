import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../../dist/domain/evidence.js";
import { webSourceLocationResultSchema } from "../../dist/domain/webSourceLocation.js";
import { startBrowserSourceMapSite } from "../fixtures/browser-source-map-site.mjs";
import { mcpTextValue } from "./mcp-verifier-results.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";

/** Verify real Chrome capture → export → original compiler point through packaged CLI/MCP. */
export async function verifyBrowserSourceMap(
  executable,
  entrypoint = fileURLToPath(new URL("../rea.mjs", import.meta.url)),
) {
  let site;
  let root;
  let transport;
  let client;
  return withVerifierCleanup(async () => {
    site = await startBrowserSourceMapSite();
    root = await mkdtemp(join(tmpdir(), "rea-browser-source-map-"));
    const env = {
      ...process.env,
      REA_LOG_LEVEL: "silent",
      HOPPER_LAUNCHER_PATH: "/rea-unconfigured-provider/hopper",
    };
    const cli = async (...args) => {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [entrypoint, ...args, "--json"],
        { env, timeout: 45000, maxBuffer: 16 * 1024 * 1024 },
      );
      return parseEvidence(JSON.parse(stdout));
    };
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      env,
      stderr: "pipe",
    });
    client = new Client({ name: "source-map-real-e2e", version: "1" });
    const capture = await cli(
      "capture-browser-scenario",
      JSON.stringify({
        browser: { mode: "launch", executable_path: executable },
        start_url: { url: site.origin },
        actions: [
          {
            step_id: "ready",
            action: "wait_for",
            locator: {
              kind: "css",
              selector: '[data-ready="source-map proof"]',
            },
            state: "visible",
            timeout_ms: 10000,
          },
        ],
        capture: { network: { response_body: true } },
      }),
    );
    const capturePath = join(root, "capture.json");
    await writeFile(capturePath, JSON.stringify(capture));
    const exported = await cli(
      "export-web-scripts",
      capturePath,
      join(root, "export"),
    );
    const manifest = exported.normalized_result;
    const manifestBytes = await readFile(manifest.manifest.path);
    const identity = {
      sha256: sha(manifestBytes),
      bytes: manifestBytes.length,
    };
    const scriptIndex = manifest.scripts.findIndex(
      (script) => script.url === `${site.origin}/app.js?build=7`,
    );
    assert.ok(
      scriptIndex >= 0,
      "Actual browser capture omitted compiled source",
    );
    const mapPath = join(root, "app.js.map");
    await writeFile(mapPath, site.map);
    const before = site.mapRequests();
    await client.connect(transport);
    let expected;
    for (const context of [
      site.origin,
      site.origin.replace("://", "://selected-user:selected-value@"),
    ]) {
      const input = {
        manifest_path: manifest.manifest.path,
        script_index: scriptIndex,
        source_map: {
          path: mapPath,
          url: `${context}/maps/app.js.map?v=7#context`,
        },
        generated_position: site.position,
      };
      expected = await assertPublicPair(cli, client, {
        site,
        input,
        capture,
        identity,
      });
    }
    assert.equal(
      site.mapRequests(),
      before,
      "Point tracing fetched the selected map URL",
    );
    return {
      compiler: site.compiler,
      generated_sha256: sha(site.generated),
      source_map_sha256: sha(site.map),
      original_sha256: sha(site.original),
      public_cli: true,
      public_stdio_mcp: true,
      actual_chrome_capture: true,
      source_map_refetch: false,
      original_point: site.originalPosition,
      codec: expected.engine,
      runtime: expected.runtime,
      selected_inert_userinfo_context_preserved: true,
      public_point_cases: 4,
    };
  }, [
    () => client?.close(),
    () => transport?.close(),
    () => site?.close(),
    () =>
      root === undefined
        ? undefined
        : rm(root, { recursive: true, force: true }),
  ]);
}
function assertPoint(evidence, { site, input, capture, identity }) {
  const result = webSourceLocationResultSchema.parse(
    evidence.normalized_result,
  );
  assert.equal(result.manifest.sha256, identity.sha256);
  assert.equal(result.manifest.bytes, identity.bytes);
  assert.equal(result.source.bytes, Buffer.byteLength(site.generated));
  assert.equal(result.source.sha256, sha(site.generated));
  assert.equal(result.source_map.sha256, sha(site.map));
  assert.equal(result.source_map.url, input.source_map.url);
  assert.equal(result.manifest.source_evidence_id, capture.evidence_id);
  assert.equal(result.execution, "unknown");
  assert.equal(result.source_authenticity, "unknown");
  assert.equal(result.matches.length, 1);
  const match = result.matches[0];
  assert.equal(match.state, "mapped");
  assert.deepEqual(match.original_position, {
    ...site.originalPosition,
    offset: site.originalOffset,
    content_position: "verified-in-embedded-text",
  });
  assert.equal(
    match.resolved_url,
    new URL("../src/fixture.ts?v=7#original", input.source_map.url).href,
  );
  assert.equal(match.content.state, "embedded");
  assert.equal(match.content.text, site.original);
  assert.equal(match.content.utf8_sha256, sha(site.original));
  assert.ok(result.runtime.v8_heap_limit_bytes <= 256 * 1024 * 1024);
  assert.deepEqual(evidence.raw_result, { source_map_text: site.map });
  return result;
}
const sha = (text) => createHash("sha256").update(text).digest("hex");

async function assertPublicPair(cli, client, oracle) {
  const { input } = oracle;
  const evidence = await cli(
    "trace-web-source-location",
    input.manifest_path,
    String(input.script_index),
    input.source_map.path,
    input.source_map.url,
    String(input.generated_position.line),
    String(input.generated_position.column),
  );
  const expected = assertPoint(evidence, oracle);
  const response = await client.callTool({
    name: "trace_web_source_location",
    arguments: input,
  });
  assert.notEqual(response.isError, true, mcpTextValue(response));
  const mcpEvidence = parseEvidence(JSON.parse(mcpTextValue(response)));
  assert.deepEqual(assertPoint(mcpEvidence, oracle), expected);
  assert.equal(evidence.parameters.source_map.url, input.source_map.url);
  return expected;
}
