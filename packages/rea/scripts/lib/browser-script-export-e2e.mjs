import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { parseEvidence } from "../../dist/domain/evidence.js";
import { startBrowserScriptSite } from "../fixtures/browser-script-site.mjs";
import {
  assertWebScriptExport,
  assertExportedScriptAnalysis,
} from "./browser-script-export-assertions.mjs";
import { mcpTextValue } from "./mcp-verifier-results.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";

/** Verify capture → export → existing analysis through real CLI and stdio MCP. */
export async function verifyBrowserScriptExport(
  executable,
  entrypoint = fileURLToPath(new URL("../rea.mjs", import.meta.url)),
  attachment,
) {
  let site;
  let root;
  let transport;
  let client;
  return withVerifierCleanup(async () => {
    site = await startBrowserScriptSite();
    root = await mkdtemp(join(tmpdir(), "rea-browser-script-export-"));
    const env = {
      ...process.env,
      REA_LOG_LEVEL: "silent",
      HOPPER_LAUNCHER_PATH: "/rea-unconfigured-provider/hopper",
    };
    const cli = exportCli(entrypoint, env);
    const scenario = scriptCaptureScenario(executable, site.origin);
    const save = (name, capture) => saveCapture(root, name, capture);
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      env,
      stderr: "pipe",
    });
    client = new Client({ name: "web-script-real-e2e", version: "1" });
    const cliCapture = await cli(
      "capture-browser-scenario",
      JSON.stringify(scenario),
    );
    const cliInput = await save("cli", cliCapture);
    const counts = new Map(site.counts);
    const cliExport = await cli(
      "export-web-scripts",
      cliInput.capture_path,
      cliInput.output_directory,
    );
    const cliResult = await assertWebScriptExport(
      cliExport,
      cliCapture,
      site.assets,
    );
    await cli(
      "analyze-javascript-application",
      cliResult.analysis_input.input_path,
    ).then((value) => assertExportedScriptAnalysis(value, 4, true));
    assert.deepEqual(
      site.counts,
      counts,
      "Export/analysis refetched a captured asset",
    );
    await client.connect(transport);
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, mcpTextValue(result));
      return parseEvidence(JSON.parse(mcpTextValue(result)));
    };
    const mcpCapture = await call("capture_browser_scenario", scenario);
    const mcpInput = await save("mcp", mcpCapture);
    const mcpCounts = new Map(site.counts);
    const mcpResult = await assertWebScriptExport(
      await call("export_web_scripts", mcpInput),
      mcpCapture,
      site.assets,
    );
    assertExportedScriptAnalysis(
      await call("analyze_javascript_application", mcpResult.analysis_input),
      4,
      true,
    );
    assert.deepEqual(
      site.counts,
      mcpCounts,
      "MCP export/analysis refetched a captured asset",
    );
    const passive = attachment
      ? await verifyPassiveExport(attachment, { cli, call, save })
      : false;
    return {
      cli: true,
      stdio_mcp: true,
      active_scripts: 4,
      passive,
      exact_bytes: true,
      manifest_readback: true,
      relative_import_resolved: true,
      query_variants_isolated: true,
      implicit_refetches: 0,
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

const verifyPassiveExport = async (attachment, { cli, call, save }) => {
  const input = {
    ...attachment,
    observation_ms: 100,
    include_script_sources: true,
  };
  const page = await call("inspect_web_page", input);
  const pageInput = await save("passive", page);
  const exported = await assertWebScriptExport(
    await call("export_web_scripts", pageInput),
    page,
  );
  assertExportedScriptAnalysis(
    await call("analyze_javascript_application", exported.analysis_input),
    exported.scripts.length,
    false,
  );
  const pageCli = await cli(
    "inspect-web-page",
    attachment.cdp_endpoint,
    attachment.target_id,
    "--include-script-sources",
    "--observation-ms",
    "100",
  );
  const pageCliInput = await save("passive-cli", pageCli);
  const pageCliResult = await assertWebScriptExport(
    await cli(
      "export-web-scripts",
      pageCliInput.capture_path,
      pageCliInput.output_directory,
    ),
    pageCli,
  );
  assertExportedScriptAnalysis(
    await cli(
      "analyze-javascript-application",
      pageCliResult.analysis_input.input_path,
    ),
    pageCliResult.scripts.length,
    false,
  );
  return true;
};

const exportCli =
  (entrypoint, env) =>
  async (...args) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [entrypoint, ...args, "--json"],
      { env, timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
    );
    return parseEvidence(JSON.parse(stdout));
  };

const saveCapture = async (root, name, capture) => {
  const capturePath = join(root, `${name}.json`);
  await writeFile(capturePath, JSON.stringify(capture));
  return {
    capture_path: capturePath,
    output_directory: join(root, `${name}-export`),
  };
};

const scriptCaptureScenario = (executable, origin) => ({
  browser: { mode: "launch", executable_path: executable },
  start_url: { url: origin },
  actions: [
    {
      step_id: "ready",
      action: "wait_for",
      locator: { kind: "css", selector: '[data-ready="true"]' },
      state: "visible",
      timeout_ms: 10000,
    },
  ],
  capture: { network: { response_body: true } },
});
