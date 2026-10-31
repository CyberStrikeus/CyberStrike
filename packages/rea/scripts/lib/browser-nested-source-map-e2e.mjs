import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { TraceMap, eachMapping } from "@jridgewell/trace-mapping";
import { CdpBrowserProvider } from "../../dist/browser/CdpBrowserProvider.js";
import { listBrowserTargetsInputSchema } from "../../dist/domain/browserObservation.js";
import { CdpConnection } from "../../dist/browser/CdpConnection.js";
import { parseEvidence } from "../../dist/domain/evidence.js";
import { traceSourceMap } from "../../dist/javascript/sourceMaps/TraceSourceMap.js";
import { startBrowserSourceMapSite } from "../fixtures/browser-source-map-site.mjs";
import { startRuntimeFixtureBrowser } from "./browser-runtime-fixture-lifecycle.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";

const cases = [
  { name: "same-line nested column control", prefixes: ["\n\n       ", "   "] },
  { name: "zero outer column control", prefixes: ["\n\n", "\n   "] },
  { name: "nested line resets outer column", prefixes: ["\n\n       ", "\n"] },
  {
    name: "nested line retains its own column",
    prefixes: ["\n\n       ", "\n   "],
  },
];

/** Verify compiler-produced nested maps through an actual owned Chrome and public CLI. */
export async function verifyBrowserNestedSourceMaps(
  executable,
  entrypoint = fileURLToPath(new URL("../rea.mjs", import.meta.url)),
) {
  const results = [];
  for (const scenario of cases) {
    try {
      const proof = await verifyCase(executable, entrypoint, scenario);
      results.push({ name: scenario.name, status: "pass", ...proof });
    } catch (cause) {
      results.push({
        name: scenario.name,
        status: "fail",
        phase: cause.qualificationPhase ?? "native-producer-admission",
        proof: cause.qualificationReceipt ?? null,
        error: String(cause),
      });
    }
  }
  // Preserve every affected owner and control even when BEFORE fails.
  process.stdout.write(
    `${JSON.stringify({ nested_source_map_cases: results })}\n`,
  );
  assert.equal(results.filter(({ status }) => status === "fail").length, 0);
  return { cases: results, actual_chrome: true, public_cli: true };
}

async function verifyCase(executable, entrypoint, scenario) {
  const site = await startBrowserSourceMapSite({
    prefixes: scenario.prefixes,
    sourceMapAnnotation: true,
    sourcefile: "../src/nested-fixture.ts",
  });
  let fixture;
  let connection;
  let phase = "native-map-admission";
  let browserVersion;
  let expected;
  let observed;
  return withVerifierCleanup(async () => {
    try {
      const mapUrl = `${site.origin}/maps/app.js.map`;
      // This independent existing decoder already composes valid nested offsets.
      // It is a before-product admission control, not the expected browser oracle.
      const point = traceSourceMap(site.map, mapUrl, site.position);
      assert.equal(point.matches.length, 1);
      assert.equal(
        point.matches[0].original_position.line,
        site.originalPosition.line,
      );
      assert.equal(
        point.matches[0].original_position.column,
        site.originalPosition.column,
      );
      expected = compilerMappingsAtPhysicalPositions(site, mapUrl);
      assert.ok(
        expected.length > 0,
        "Native compiler leaf must carry point mappings",
      );

      phase = "owned-browser-startup";
      fixture = await startRuntimeFixtureBrowser(executable, site.origin);
      const endpoint = `http://127.0.0.1:${fixture.port}`;
      const provider = new CdpBrowserProvider();
      const targets = await provider.listTargets(
        listBrowserTargetsInputSchema.parse({
          cdp_endpoint: endpoint,
          allowed_origins: [site.origin],
        }),
      );
      if (!targets.ok) throw targets.error;
      const target = targets.value.targets[0];
      assert.ok(target, "Owned fixture target missing");
      const pages = await (await fetch(`${endpoint}/json/list`)).json();
      const page = pages.find(({ id }) => id === target.target_id);
      assert.ok(page, "Owned CDP fixture page missing");
      connection = await CdpConnection.connect(
        page.webSocketDebuggerUrl,
        "inspect_web_page",
      );
      await ready(connection);
      browserVersion = await connection.send("Browser.getVersion");
      phase = "public-cli";
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          entrypoint,
          "analyze-web-bundle",
          endpoint,
          target.target_id,
          "--allowed-origins",
          site.origin,
          "--fetch-source-maps",
          "--observation-ms",
          "0",
          "--json",
        ],
        {
          env: { ...process.env, REA_LOG_LEVEL: "silent" },
          timeout: 45_000,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      const evidence = parseEvidence(JSON.parse(stdout));
      assert.equal(evidence.operation, "analyze_web_bundle");
      const maps = evidence.normalized_result.observations.source_maps;
      const item = maps.items.find(
        ({ artifact }) => artifact?.text === site.map,
      );
      assert.ok(
        item,
        "Public browser analysis omitted the exact compiler-derived map",
      );
      phase = "public-map-assertions";
      observed = item?.mappings;
      assert.equal(item.status, "included");
      assert.equal(item.mappings.length, expected.length);
      for (const [index, coordinates] of expected.entries()) {
        const mapping = item.mappings[index];
        for (const [key, value] of Object.entries(coordinates))
          assert.deepEqual(mapping[key], value);
        // This compiler fixture has one source declaration in one wrapped leaf.
        assert.equal(mapping.source_index, 0);
        assert.equal(mapping.declaration_index, 0);
      }
      assert.equal(item.original_sources.length, 1);
      assert.equal(item.artifact.sha256, sha(site.map));
      assert.equal(item.artifact.bytes, Buffer.byteLength(site.map));
      assert.equal(
        item.original_sources[0].artifact.sha256,
        sha(site.original),
      );
      assert.ok(
        site.mapRequests() > 0,
        "Actual browser workflow did not fetch the declared map",
      );
      return {
        compiler: site.compiler,
        browser: browserVersion.product,
        generated_sha256: sha(site.generated),
        source_map_sha256: sha(site.map),
        original_sha256: sha(site.original),
        mappings: expected.length,
        native_decoder_control: true,
      };
    } catch (cause) {
      const failure = new Error(
        `Nested source-map ${phase}: ${String(cause)}`,
        {
          cause,
        },
      );
      failure.qualificationPhase = phase;
      failure.qualificationReceipt = {
        compiler: site.compiler,
        browser: browserVersion?.product ?? null,
        generated_sha256: sha(site.generated),
        leaf_map_sha256: sha(site.leafMap),
        source_map_sha256: sha(site.map),
        original_sha256: sha(site.original),
        expected_first_mapping: expected?.[0] ?? null,
        observed_first_mapping: observed?.[0] ?? null,
      };
      throw failure;
    }
  }, [() => connection?.close(), () => fixture?.close(), () => site.close()]);
}

function compilerMappingsAtPhysicalPositions(site, mapUrl) {
  const expected = [];
  const prefixLength = site.generated.indexOf(site.leafCode);
  assert.ok(prefixLength >= 0);
  eachMapping(new TraceMap(site.leafMap, mapUrl), (mapping) => {
    if (
      mapping.source === null ||
      mapping.originalLine === null ||
      mapping.originalColumn === null
    )
      return;
    const leafLines = site.leafCode.split("\n");
    const before = leafLines.slice(0, mapping.generatedLine - 1).join("\n");
    const leafOffset =
      before.length +
      (mapping.generatedLine > 1 ? 1 : 0) +
      mapping.generatedColumn;
    const physical = site.generated
      .slice(0, prefixLength + leafOffset)
      .split("\n");
    expected.push({
      generated_line: physical.length,
      generated_column: physical.at(-1).length,
      source: mapping.source,
      original_line: mapping.originalLine,
      original_column: mapping.originalColumn,
      name: mapping.name ?? null,
    });
  });
  return expected;
}

async function ready(connection) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await connection.send("Runtime.evaluate", {
      expression: 'document.body.dataset.ready === "source-map proof"',
      returnByValue: true,
    });
    if (result.result.value === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Owned compiler fixture did not execute in actual Chrome");
}
const sha = (text) => createHash("sha256").update(text).digest("hex");
