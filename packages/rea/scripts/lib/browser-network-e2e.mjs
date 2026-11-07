import { requireMcpOutput } from "./mcp-verifier-results.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { browserScenarioSchema } from "../../dist/domain/browserScenario.js";
import { browserScenarioCaptureSchema } from "../../dist/domain/browserScenarioCapture.js";
import { parseEvidence } from "../../dist/domain/evidence.js";
import {
  startBrowserNetworkSite,
  networkFixtureSecret,
} from "../fixtures/browser-network-site.mjs";
import { assertBrowserNetworkEvidence } from "./browser-network-assertions.mjs";
import { scenarioProfiles } from "./browser-scenario-verifier.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";

/** Exercise selected network content through real CLI and stdio MCP, one browser at a time. */
export async function verifyBrowserNetworkEvidence(
  executable,
  entrypoint = fileURLToPath(new URL("../rea.mjs", import.meta.url)),
  attachment,
) {
  let site;
  let profilesBefore;
  let transport;
  let client;
  return withVerifierCleanup(async () => {
    site = await startBrowserNetworkSite();
    profilesBefore = await scenarioProfiles();
    const scenario = browserScenarioSchema.parse({
      browser: { mode: "launch", executable_path: executable },
      start_url: { url: site.origin },
      actions: [
        {
          step_id: "run",
          action: "click",
          locator: { kind: "css", selector: "#start" },
          timeout_ms: 10_000,
        },
        {
          step_id: "ready",
          action: "wait_for",
          locator: { kind: "css", selector: "#done" },
          state: "visible",
          timeout_ms: 10_000,
        },
      ],
      secrets: [
        {
          secret_id: "network_secret",
          environment_variable: "REA_NETWORK_FIXTURE_SECRET",
        },
      ],
      capture: {
        at_end: ["url"],
        network: {
          request_body: true,
          response_body: true,
          header_values: true,
        },
      },
    });
    const env = {
      ...process.env,
      REA_LOG_LEVEL: "silent",
      REA_NETWORK_FIXTURE_SECRET: networkFixtureSecret,
      HOPPER_LAUNCHER_PATH: "/rea-unconfigured-provider/hopper",
    };
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        entrypoint,
        "capture-browser-scenario",
        JSON.stringify(scenario),
        "--json",
      ],
      { env, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const cli = browserScenarioCaptureSchema.parse(
      parseEvidence(JSON.parse(stdout)).normalized_result,
    );
    const cliProof = assertBrowserNetworkEvidence(cli, site.origin);
    // The oracle must reject a deliberately incorrect same-URL association.
    const swapped = structuredClone(cli);
    const responses = swapped.events.items.filter(
      (event) =>
        event.kind === "network-content" &&
        event.phase === "response" &&
        event.body.state === "captured" &&
        Buffer.from(event.body.content, "base64")
          .toString()
          .includes('"marker":'),
    );
    assert.equal(responses.length, 2);
    [responses[0].transaction_id, responses[1].transaction_id] = [
      responses[1].transaction_id,
      responses[0].transaction_id,
    ];
    assert.throws(
      () => assertBrowserNetworkEvidence(swapped, site.origin),
      /associated with a different same-URL request/,
    );
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      env,
      stderr: "pipe",
    });
    client = new Client({ name: "network-real-e2e", version: "1" });
    let mcpProof;
    await client.connect(transport);
    const result = await client.callTool(
      { name: "capture_browser_scenario", arguments: scenario },
      { timeout: 60_000 },
    );
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.notEqual(result.structuredContent, undefined);
    const evidence = parseEvidence(
      requireMcpOutput(result, "capture_browser_scenario"),
    );
    mcpProof = assertBrowserNetworkEvidence(
      evidence.normalized_result,
      site.origin,
    );
    if (attachment !== undefined) {
      const connectedScenario = browserScenarioSchema.parse({
        ...scenario,
        browser: { mode: "connect", ...attachment },
      });
      const connected = await client.callTool(
        { name: "capture_browser_scenario", arguments: connectedScenario },
        { timeout: 60_000 },
      );
      assert.notEqual(connected.isError, true, JSON.stringify(connected));
      assert.notEqual(connected.structuredContent, undefined);
      const connectedEvidence = parseEvidence(
        requireMcpOutput(connected, "capture_browser_scenario"),
      );
      assert.deepEqual(
        assertBrowserNetworkEvidence(
          connectedEvidence.normalized_result,
          site.origin,
          "disconnected-external",
        ),
        cliProof,
      );
      assert.ok(
        (await fetch(`${attachment.cdp_endpoint}/json/version`)).ok,
        "Network capture closed the external browser",
      );
    }
    assert.deepEqual(mcpProof, cliProof);
    for (const path of [
      "/redirect",
      "/landing",
      "/binary",
      "/compressed",
      "/stream",
      "/empty",
      "/form",
    ])
      assert.equal(
        site.counts.get(path),
        attachment === undefined ? 2 : 3,
        `Unexpected implicit refetch of ${path}`,
      );
    assert.equal(site.counts.get("/same"), attachment === undefined ? 4 : 6);
    const profilesAfter = await scenarioProfiles();
    assert.ok(
      [...profilesAfter].every((profile) => profilesBefore.has(profile)),
      "A scenario profile survived cleanup",
    );
    return {
      ...cliProof,
      cli: true,
      mcp: true,
      association_fault_rejected: true,
      implicit_refetches: 0,
      profile_cleanup: true,
      connected_network_verified: attachment !== undefined,
    };
  }, [() => client?.close(), () => transport?.close(), () => site?.close()]);
}
