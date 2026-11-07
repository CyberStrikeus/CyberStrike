import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../../dist/domain/evidence.js";
import { webModuleTraceResultSchema } from "../../dist/domain/webModuleTrace.js";
import { NativeModuleResolver } from "../../dist/browser/modules/NativeModuleResolver.js";
import { startBrowserModuleSite } from "../fixtures/browser-module-site.mjs";
import { mcpTextValue } from "./mcp-verifier-results.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";

/** Check native URL resolution against an independently loaded module graph through CLI/MCP. */
export async function verifyBrowserModules(
  executable,
  entrypoint = fileURLToPath(new URL("../rea.mjs", import.meta.url)),
) {
  let site;
  let root;
  let transport;
  let client;
  return withVerifierCleanup(async () => {
    site = await startBrowserModuleSite();
    root = await mkdtemp(join(tmpdir(), "rea-browser-modules-"));
    const env = {
      ...process.env,
      REA_LOG_LEVEL: "silent",
      REA_BROWSER_EXECUTABLE: executable,
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
    client = new Client({ name: "module-real-e2e", version: "1" });
    const oracle = await loadingOracle(executable, site);
    const scenario = {
      browser: { mode: "launch", executable_path: executable },
      start_url: { url: site.origin },
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
    };
    const capture = await cli(
      "capture-browser-scenario",
      JSON.stringify(scenario),
    );
    const capturePath = join(root, "capture.json");
    await writeFile(capturePath, JSON.stringify(capture));
    const exported = await cli(
      "export-web-scripts",
      capturePath,
      join(root, "export"),
    );
    const manifest = exported.normalized_result;
    const scriptIndex = manifest.scripts.findIndex(
      (script) => script.url === `${site.origin}/scoped/main.js?build=2`,
    );
    assert.ok(
      scriptIndex >= 0,
      "Real capture did not retain main module response",
    );
    const mapPath = join(root, "import-map.json");
    await writeFile(mapPath, JSON.stringify(site.importMap));
    const input = {
      manifest_path: manifest.manifest.path,
      script_index: scriptIndex,
      importer_url: `${site.origin}/scoped/main.js?build=2#entry`,
      import_map: { path: mapPath, base_url: `${site.origin}/maps/` },
    };
    const before = [...site.requests];
    const cliEvidence = await cli(
      "trace-web-module-imports",
      input.manifest_path,
      String(scriptIndex),
      "--importer-url",
      input.importer_url,
      "--import-map-path",
      mapPath,
      "--import-map-base-url",
      input.import_map.base_url,
    );
    const cliResult = assertTrace(cliEvidence, oracle, site, scriptIndex);
    await client.connect(transport);
    const response = await client.callTool({
      name: "trace_web_module_imports",
      arguments: input,
    });
    assert.notEqual(response.isError, true, mcpTextValue(response));
    const mcpEvidence = parseEvidence(JSON.parse(mcpTextValue(response)));
    const mcpResult = assertTrace(mcpEvidence, oracle, site, scriptIndex);
    assert.deepEqual(mcpResult, cliResult, "CLI and MCP module traces differ");
    assert.equal(
      cliEvidence.subject.digest.sha256,
      createHash("sha256").update(site.main).digest("hex"),
    );
    const mapBytes = await readFile(mapPath);
    assert.equal(
      cliResult.import_map.sha256,
      createHash("sha256").update(mapBytes).digest("hex"),
    );
    assert.deepEqual(
      site.requests,
      before,
      "Tracing refetched or executed a captured website dependency",
    );
    for (const surface of ["cli", "stdio_mcp"]) {
      const withoutMap =
        surface === "cli"
          ? await cli(
              "trace-web-module-imports",
              input.manifest_path,
              String(scriptIndex),
            )
          : parseEvidence(
              JSON.parse(
                mcpTextValue(
                  await client.callTool({
                    name: "trace_web_module_imports",
                    arguments: {
                      manifest_path: input.manifest_path,
                      script_index: scriptIndex,
                    },
                  }),
                ),
              ),
            );
      const result = webModuleTraceResultSchema.parse(
        withoutMap.normalized_result,
      );
      assert.equal(result.import_map, null);
      assert.equal(result.imports[0].resolution.state, "rejected");
      assert.equal(
        result.imports[2].resolution.url,
        `${site.origin}/query.js?v=1#one`,
      );
    }
    assert.deepEqual(
      site.requests,
      before,
      "Map-free tracing refetched an asset",
    );
    const warnings = await new NativeModuleResolver(env).resolve({
      importerUrl: input.importer_url,
      specifiers: ["alias"],
      importMap: {
        baseUrl: input.import_map.base_url,
        value: { imports: { alias: "./global.js", ignored: 42 } },
      },
    });
    assert.equal(warnings.ok, true, warnings.ok ? "" : warnings.error.message);
    assert.ok(
      warnings.value.diagnostics.length > 0,
      "Native import-map warnings were discarded",
    );
    assert.equal(
      warnings.value.resolutions[0].url,
      `${site.origin}/maps/global.js`,
    );
    const controller = new AbortController();
    let owned;
    const interrupted = await new NativeModuleResolver(env, async (options) => {
      owned = await chromium.launch(options);
      controller.abort();
      return owned;
    }).resolve(
      {
        importerUrl: input.importer_url,
        importMap: null,
        specifiers: ["./dep.js"],
      },
      { signal: controller.signal },
    );
    assert.equal(
      interrupted.ok,
      false,
      "Cancellation returned successful native resolution",
    );
    assert.equal(interrupted.error._tag, "AnalysisCancelledError");
    assert.equal(
      owned.isConnected(),
      false,
      "Cancelled native resolver left its owned browser connected",
    );
    const syntheticImporter = "http://app.invalid/main.js?build=1#entry";
    const syntheticMapBase = "https://maps.invalid/maps/map.json?x=1&y=2#base";
    for (const useMap of [false, true])
      for (const surface of ["cli", "stdio_mcp"]) {
        let evidence;
        if (surface === "cli")
          evidence = await cli(
            "trace-web-module-imports",
            input.manifest_path,
            String(scriptIndex),
            "--importer-url",
            syntheticImporter,
            ...(useMap
              ? [
                  "--import-map-path",
                  mapPath,
                  "--import-map-base-url",
                  syntheticMapBase,
                ]
              : []),
          );
        else {
          const response = await client.callTool({
            name: "trace_web_module_imports",
            arguments: {
              manifest_path: input.manifest_path,
              script_index: scriptIndex,
              importer_url: syntheticImporter,
              ...(useMap
                ? { import_map: { path: mapPath, base_url: syntheticMapBase } }
                : {}),
            },
          });
          assert.notEqual(response.isError, true, mcpTextValue(response));
          evidence = parseEvidence(JSON.parse(mcpTextValue(response)));
        }
        const result = webModuleTraceResultSchema.parse(
          evidence.normalized_result,
        );
        if (useMap)
          assert.deepEqual(result.imports[0].resolution, {
            state: "resolved",
            url: "https://maps.invalid/maps/global.js",
          });
        else assert.equal(result.imports[0].resolution.state, "rejected");
        assert.equal(
          result.imports[2].resolution.url,
          "http://app.invalid/query.js?v=1#one",
        );
        assert.equal(
          evidence.raw_result.native_report.importer_url,
          syntheticImporter,
        );
        assert.equal(
          result.source.script.url,
          `${site.origin}/scoped/main.js?build=2`,
        );
      }
    const escapedBase = await new NativeModuleResolver(env).resolve({
      importerUrl: syntheticImporter,
      importMap: {
        baseUrl: "https://maps.invalid/maps/a&amp;b/map.json?x=1&y=2#base",
        value: { imports: { alias: "./alias.js" } },
      },
      specifiers: ["alias"],
    });
    assert.equal(
      escapedBase.ok,
      true,
      escapedBase.ok ? "" : escapedBase.error.message,
    );
    assert.deepEqual(escapedBase.value.resolutions[0], {
      state: "resolved",
      url: "https://maps.invalid/maps/a&amp;b/alias.js",
    });
    assert.deepEqual(
      site.requests,
      before,
      "Synthetic-context tracing refetched or executed a website asset",
    );
    return {
      independent_http_importer_and_https_map_base: true,
      cancellation_cleanup: true,
      native_warnings_retained: true,
      cli: true,
      stdio_mcp: true,
      public_trace_cases: 8,
      literal_imports: 11,
      computed_unknowns: 1,
      native_loading_oracle: true,
      independent_module_instances: 3,
      import_map_scopes: true,
      null_and_backtracking_errors: true,
      query_fragment_identity: true,
      source_identity_verified: true,
      map_identity_verified: true,
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

const assertTrace = (evidence, oracle, site, scriptIndex) => {
  const result = webModuleTraceResultSchema.parse(evidence.normalized_result);
  assert.equal(result.source.script_index, scriptIndex);
  assert.equal(result.parser.state, "parsed");
  assert.equal(result.imports.length, 12);
  assert.deepEqual(
    result.imports.slice(0, 11).map((item) => item.resolution),
    oracle.resolutions,
  );
  assert.deepEqual(result.imports[11].resolution, {
    state: "unknown",
    reason: "computed-specifier",
  });
  assert.ok(result.imports.every((item) => item.execution === "unknown"));
  assert.equal(
    result.imports[6].captured_candidates.length,
    0,
    "An unloaded lazy URL became a captured source",
  );
  for (const index of [2, 3]) {
    assert.ok(result.imports[index].captured_candidates.length > 0);
    assert.ok(
      result.imports[index].captured_candidates.every(
        (candidate) => candidate.match === "response-url-without-fragment",
      ),
    );
  }
  assert.equal(result.imports[4].resolution.url, `${site.origin}/query.js?v=2`);
  assert.equal(
    result.importer.url,
    `${site.origin}/scoped/main.js?build=2#entry`,
  );
  assert.equal(result.engine.id, "chromium-native-module-resolver");
  return result;
};

const loadingOracle = async (executable, site) => {
  const browser = await chromium.launch({
    executablePath: executable,
    headless: true,
    timeout: 15000,
    args: [
      "--disable-dev-shm-usage",
      ...(process.env.REA_BROWSER_NO_SANDBOX === "true"
        ? ["--no-sandbox"]
        : []),
    ],
  });
  return withVerifierCleanup(async () => {
    const page = await browser.newPage();
    await page.goto(site.origin);
    await page.waitForFunction(
      () => globalThis.__moduleProof !== undefined,
      undefined,
      { timeout: 10000 },
    );
    const proof = await page.evaluate(() => globalThis.__moduleProof);
    assert.equal(proof.alias, "scoped");
    assert.equal(proof.pkg, "pkg");
    assert.equal(proof.same_module, true);
    assert.equal(proof.different_fragments, true);
    assert.equal(new Set(proof.instances).size, 3);
    assert.deepEqual(proof.urls, [
      `${site.origin}/query.js?v=1#one`,
      `${site.origin}/query.js?v=1#two`,
      `${site.origin}/query.js?v=2`,
    ]);
    assert.ok(
      !site.requests.some(
        (url) =>
          url.includes("lazy") ||
          url.includes("escape") ||
          url.includes("blocked"),
      ),
    );
    return proof;
  }, [() => browser.close()]);
};
