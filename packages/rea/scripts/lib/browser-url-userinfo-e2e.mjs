import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { CdpConnection } from "../../dist/browser/CdpConnection.js";
import { parseEvidence } from "../../dist/domain/evidence.js";
import { artifactCliEvidence } from "./artifact-e2e.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";

/** Verify real V8 source labels, which retain spelling that navigation normalizes. */
export async function verifyBrowserUrlUserInfo(endpoint, origin) {
  const rawUrl = `${origin.replace("://", "://user:pass@")}\\path@tail/../keep.js?x=1#frag`;
  const expectedUrl = `${origin}\\path@tail/../keep.js?x=1#frag`;
  const sources = [rawUrl, expectedUrl].map(
    (url, index) =>
      `globalThis.reaUserinfoUrlProbe${index} = () => 4731;\n//# sourceURL=${url}`,
  );
  const response = await fetch(`${endpoint}/json/new?about:blank`, {
    method: "PUT",
  });
  assert.equal(
    response.ok,
    true,
    "Browser refused the owned URL fixture target",
  );
  const target = await response.json();
  assert.equal(typeof target.id, "string");
  let connection;
  let transport;
  let client;
  return withVerifierCleanup(async () => {
    connection = await CdpConnection.connect(
      target.webSocketDebuggerUrl,
      "inspect_web_page",
    );
    await loadFixturePage(connection, `${origin}/app?userinfo-probe`);
    const producerUrls = [];
    connection.onEvent((event) => {
      if (event.method === "Debugger.scriptParsed")
        producerUrls.push(event.params.url);
    });
    await connection.send("Debugger.enable");
    const browserUrl = await connection.send("Runtime.evaluate", {
      expression: `new URL(${JSON.stringify(rawUrl)}).href`,
      returnByValue: true,
    });
    assert.equal(browserUrl.exceptionDetails, undefined);
    assert.equal(browserUrl.result.value, new URL(rawUrl).href);
    assert.notEqual(browserUrl.result.value, rawUrl);
    assert.equal(new URL(browserUrl.result.value).pathname, "/keep.js");
    for (const source of sources) {
      const evaluated = await connection.send("Runtime.evaluate", {
        expression: source,
        returnByValue: true,
      });
      assert.equal(evaluated.exceptionDetails, undefined);
    }
    assert.ok(
      [rawUrl, expectedUrl].every((url) => producerUrls.includes(url)),
      "Real V8 did not retain the exact sourceURL spelling on the CDP wire",
    );
    const assertScripts = (evidence) => {
      const result = parseEvidence(evidence).normalized_result;
      return sources.map((source) => {
        const script = result.scripts.items.find(
          (item) =>
            item.source.included && item.source.artifact.text === source,
        );
        assert.ok(
          script,
          "Public capture omitted the retained V8 fixture script",
        );
        assert.equal(script.url, expectedUrl);
        assert.equal(new URL(script.url).origin, origin);
        assert.equal(
          script.source.artifact.sha256,
          createHash("sha256").update(source).digest("hex"),
        );
        return script.url;
      });
    };
    const cliUrl = assertScripts(
      await artifactCliEvidence("inspect-web-page", endpoint, [
        target.id,
        "--allowed-origins",
        origin,
        "--include-script-sources",
        "--observation-ms",
        "0",
      ]),
    );
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../rea.mjs", import.meta.url)), "mcp"],
      env: { ...process.env, REA_LOG_LEVEL: "silent" },
      stderr: "pipe",
    });
    client = new Client({ name: "browser-url-userinfo-e2e", version: "1" });
    await client.connect(transport);
    const mcp = await client.callTool({
      name: "inspect_web_page",
      arguments: {
        cdp_endpoint: endpoint,
        allowed_origins: [origin],
        target_id: target.id,
        include_script_sources: true,
        observation_ms: 0,
      },
    });
    assert.notEqual(mcp.isError, true, JSON.stringify(mcp));
    assert.deepEqual(assertScripts(mcp.structuredContent), cliUrl);
    return {
      cli: true,
      stdio_mcp: true,
      raw_v8_source_url: true,
      credential_free_control: true,
      original_source_digest: true,
      browser_url_parser_normalizes_backslash_and_dot_segments: true,
    };
  }, [
    async () => client?.close(),
    async () => transport?.close(),
    async () => connection?.close(),
    async () => {
      const closed = await fetch(`${endpoint}/json/close/${target.id}`);
      assert.equal(
        closed.ok,
        true,
        "Browser retained the owned URL fixture target",
      );
    },
  ]);
}

async function loadFixturePage(connection, url) {
  const loaded = new Set();
  let loaderId;
  let resolveLoaded;
  let timer;
  const load = new Promise((resolve) => {
    resolveLoaded = resolve;
  });
  const unsubscribe = connection.onEvent((event) => {
    if (event.method !== "Page.lifecycleEvent" || event.params.name !== "load")
      return;
    loaded.add(event.params.loaderId);
    if (event.params.loaderId === loaderId) resolveLoaded();
  });
  try {
    await connection.send("Page.enable");
    await connection.send("Page.setLifecycleEventsEnabled", { enabled: true });
    const navigation = await connection.send("Page.navigate", { url });
    assert.equal(navigation.errorText, undefined);
    assert.equal(typeof navigation.loaderId, "string");
    loaderId = navigation.loaderId;
    if (!loaded.has(loaderId))
      await Promise.race([
        load,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Owned URL fixture did not finish loading")),
            10_000,
          );
        }),
      ]);
    assert.equal(
      (await connection.send("Page.getFrameTree")).frameTree.frame.url,
      url,
    );
  } finally {
    clearTimeout(timer);
    unsubscribe();
    await connection.send("Page.setLifecycleEventsEnabled", { enabled: false });
  }
}
