import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { artifactCliEvidence, artifactMcpResult } from "./artifact-e2e.mjs";
import { webSourceMapsSchema } from "../../dist/domain/webBundleAnalysis.js";

const ANNOTATION_BYTES = 2 * 1024 * 1024;
const SCRIPT_COUNT = 5;

/** Verify real Chrome scriptParsed metadata is bounded before public capture retention. */
export async function verifyBrowserCaptureMetadataBudget(endpoint) {
  const marker = "rea-capture-metadata-budget";
  let page = "";
  let pageReady = false;
  let fixtureOrigin = "";
  const server = createServer(
    { maxHeaderSize: 3 * 1024 * 1024 },
    (request, response) => {
      if (request.url?.startsWith("/maps/") === true) {
        response.writeHead(200, {
          "content-type": "application/source-map+json",
        });
        response.end(
          JSON.stringify({
            version: 3,
            names: [],
            sources: [`${fixtureOrigin}/source.ts`],
            sourcesContent: ["export const retainedSource = true;"],
            mappings: "AAAA",
          }),
        );
        return;
      }
      if (request.url === "/capture-metadata-ready") {
        pageReady = true;
        response.writeHead(204).end();
        return;
      }
      if (request.url !== "/capture-metadata-budget") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(page);
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let targetId;
  try {
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Browser metadata fixture did not bind a TCP port");
    fixtureOrigin = `http://127.0.0.1:${String(address.port)}`;
    // Each independent capture opens a new Debugger session. Keep each script
    // reachable so V8 cannot collect it before the later sessions attach.
    const annotations = Array.from(
      { length: SCRIPT_COUNT },
      (_, index) =>
        `<script>globalThis["${marker}${index}"]=()=>true;\n//# sourceMappingURL=${fixtureOrigin}/maps/${String(index)}-${"x".repeat(ANNOTATION_BYTES)}.map\n</script>`,
    ).join("");
    page = `<!doctype html><meta charset="utf-8">${annotations}<script>fetch("/capture-metadata-ready")</script>`;
    const fixtureUrl = `${fixtureOrigin}/capture-metadata-budget`;
    const created = await fetch(
      `${endpoint}/json/new?${encodeURIComponent(fixtureUrl)}`,
      { method: "PUT" },
    );
    if (!created.ok)
      throw new Error(`Chrome target creation failed: HTTP ${created.status}`);
    const target = await created.json();
    if (typeof target.id !== "string" || target.id.length === 0)
      throw new Error("Chrome target creation returned no target ID");
    targetId = target.id;

    const deadline = Date.now() + 15_000;
    let served = false;
    while (!served && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      served = pageReady;
    }
    if (!served) throw new Error("Chrome did not request the metadata fixture");

    const evidence = await artifactCliEvidence("inspect-web-page", endpoint, [
      targetId,
      "--allowed-origins",
      fixtureOrigin,
      "--observation-ms",
      "0",
    ]);
    const cliFacts = assertMetadataBudget(evidence.normalized_result);
    const bundle = await artifactCliEvidence("analyze-web-bundle", endpoint, [
      targetId,
      "--allowed-origins",
      fixtureOrigin,
      "--observation-ms",
      "0",
      "--fetch-source-maps",
    ]);
    assertBundleMetadataOmissions(
      bundle.normalized_result,
      cliFacts.omittedMaps,
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../rea.mjs", import.meta.url)), "mcp"],
      env: { PATH: process.env.PATH ?? "", REA_LOG_LEVEL: "silent" },
      stderr: "pipe",
    });
    const client = new Client({ name: "browser-metadata-e2e", version: "1" });
    try {
      await client.connect(transport);
      assertMetadataBudget(
        await artifactMcpResult(client, "inspect_web_page", {
          cdp_endpoint: endpoint,
          allowed_origins: [fixtureOrigin],
          target_id: targetId,
          observation_ms: 0,
        }),
      );
      assertBundleMetadataOmissions(
        await artifactMcpResult(client, "analyze_web_bundle", {
          cdp_endpoint: endpoint,
          allowed_origins: [fixtureOrigin],
          target_id: targetId,
          observation_ms: 0,
          fetch_source_maps: true,
        }),
        cliFacts.omittedMaps,
      );
    } finally {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    }
    return { ...cliFacts, public_cli: true, public_stdio_mcp: true };
  } finally {
    try {
      if (targetId !== undefined) {
        const closed = await fetch(
          `${endpoint}/json/close/${encodeURIComponent(targetId)}`,
        );
        if (!closed.ok)
          throw new Error(
            `Chrome fixture target cleanup failed: HTTP ${closed.status}`,
          );
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    }
  }
}

function assertMetadataBudget(result) {
  const scripts = result.scripts.items.filter(
    (script) =>
      script.url.includes("capture-metadata-budget") &&
      script.length >= ANNOTATION_BYTES,
  );
  const retainedMaps = scripts.filter(
    (script) => script.source_map_url !== null,
  ).length;
  const omittedMaps = SCRIPT_COUNT - retainedMaps;
  const exclusion = result.completeness.excluded.find(
    (item) =>
      item.section === "source_maps" &&
      item.reason === "resource_budget_exhausted",
  );
  if (
    scripts.length !== SCRIPT_COUNT ||
    retainedMaps <= 0 ||
    retainedMaps >= SCRIPT_COUNT ||
    exclusion?.count !== omittedMaps ||
    !result.completeness.truncated_sections.includes("source_maps")
  )
    throw new Error(
      `Real Chrome source-map metadata admission was not reported accurately: scripts=${String(scripts.length)}, retained_maps=${String(retainedMaps)}, excluded=${String(exclusion?.count)}`,
    );
  return {
    scripts: scripts.length,
    retainedMaps,
    omittedMaps,
    declaredBytes: ANNOTATION_BYTES * SCRIPT_COUNT,
  };
}

function assertBundleMetadataOmissions(result, omittedMaps) {
  // The source-map owner carries capture omissions as structured exclusions.
  // Their presence makes aggregate coverage partial even when retained maps
  // decoded completely; item validity remains independent of that coverage.
  const maps = webSourceMapsSchema.parse(result.observations.source_maps);
  const exclusion = maps.excluded?.find(
    ({ section, reason }) =>
      section === "source_maps" && reason === "resource_budget_exhausted",
  );
  const retained = maps.items.filter(({ status }) => status === "included");
  const unknown = result.unknowns.find(
    ({ dimension, reason }) =>
      dimension === "source_maps" &&
      typeof maps.limitation === "string" &&
      reason === maps.limitation,
  );
  if (
    maps.status !== "partial" ||
    retained.length === 0 ||
    retained.some(
      (map) =>
        map.artifact === null ||
        map.mappings.length === 0 ||
        !map.original_sources.some(
          ({ artifact }) =>
            artifact?.text === "export const retainedSource = true;",
        ),
    ) ||
    exclusion?.count !== omittedMaps ||
    result.completeness.status !== "partial" ||
    unknown === undefined
  )
    throw new Error(
      `Bundle analysis lost capture omissions or valid retained maps: ${JSON.stringify(
        {
          source_maps_status: maps.status,
          requested: maps.requested,
          processed: maps.processed,
          retained_maps: retained.length,
          excluded: maps.excluded,
          expected_omitted_maps: omittedMaps,
          completeness: result.completeness.status,
          source_map_unknowns: result.unknowns.filter(
            ({ dimension }) => dimension === "source_maps",
          ),
        },
      )}`,
    );
}
