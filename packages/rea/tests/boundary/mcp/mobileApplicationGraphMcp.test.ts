import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";
import { expect, it } from "vitest";

import { createDirectAnalysis } from "../../../src/composition/directAnalysis.js";
import { androidApplicationProjectionResultSchema } from "../../../src/domain/android/androidApplication.js";
import { artifactInventoryResultSchema } from "../../../src/domain/artifactGraph.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { fragmentInventoryEvidence } from "../../fixtures/artifactEvidence.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";

const { runProviderAnalysis } = createDirectAnalysis({});

async function connect() {
  const session = createTestBinarySession(() => {
    throw new Error("mobile graph projection must not launch a provider");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "mobile-application-graph-test", version: "1" },
  });
  return client;
}

const writeApk = async (directory: string): Promise<string> => {
  const path = join(directory, "Fixture.apk");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "AndroidManifest.xml",
    new Uint8ArrayReader(Uint8Array.from([3, 0, 8, 0])),
  );
  await writer.add(
    "classes.dex",
    new Uint8ArrayReader(
      Uint8Array.from([0x64, 0x65, 0x78, 0x0a, 0x30, 0x33, 0x35, 0]),
    ),
  );
  await writeFile(path, await writer.close());
  return path;
};

const writeIpa = async (directory: string): Promise<string> => {
  const path = join(directory, "Fixture.ipa");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "Payload/Fixture.app/Info.plist",
    new TextReader("<plist></plist>"),
  );
  await writer.add(
    "Payload/Fixture.app/Fixture",
    new Uint8ArrayReader(
      Uint8Array.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1]),
    ),
  );
  await writeFile(path, await writer.close());
  return path;
};

it("advertises and executes Android and Apple inventory projections", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const names = new Set(tools.map(({ name }) => name));
  expect(names.has("project_android_application_graph")).toBe(true);
  expect(names.has("project_apple_application_graph")).toBe(true);

  const root = await createTestTempDirectory("rea-mobile-graph-mcp-");
  const apkInventory = parseEvidence(
    await runProviderAnalysis(
      await writeApk(root),
      "inventory_artifact",
      {},
    ).then(projectCliAnalysisResult),
  );
  const apkSources = fragmentInventoryEvidence(apkInventory, 2).toReversed();
  const android = await client.callTool({
    name: "project_android_application_graph",
    arguments: { inventory_evidence: apkSources },
  });
  if (android.isError === true)
    throw new Error(JSON.stringify(android, null, 2));
  expect(android.structuredContent).toMatchObject({
    operation: "project_android_application_graph",
    provider: { id: "rea-android-application" },
  });
  const androidEvidence = parseEvidence(android.structuredContent);
  const retainedAndroid = await client.callTool({
    name: "project_android_application_graph",
    arguments: {
      inventory_evidence: apkSources.map(({ evidence_id }) => ({
        kind: "retained-evidence",
        evidence_id,
      })),
    },
  });
  expect(retainedAndroid.isError, JSON.stringify(retainedAndroid)).not.toBe(
    true,
  );
  expect(parseEvidence(retainedAndroid.structuredContent)).toEqual(
    androidEvidence,
  );
  const androidBundle = await client.callTool({
    name: "get_evidence_bundle",
    arguments: {},
  });
  expect(androidBundle.structuredContent).toMatchObject({
    result: {
      records: expect.arrayContaining([...apkSources, androidEvidence]),
    },
  });

  const tamperedSource = {
    ...apkSources[0]!,
    evidence_id: apkSources[1]!.evidence_id,
  };
  const rejected = await client.callTool({
    name: "project_android_application_graph",
    arguments: { inventory_evidence: [tamperedSource] },
  });
  expect(parseMcpToolError(rejected)).toMatchObject({
    error: { code: "evidence_integrity_mismatch" },
  });
  const bundleAfterRejectedSource = await client.callTool({
    name: "get_evidence_bundle",
    arguments: {},
  });
  expect(bundleAfterRejectedSource.structuredContent).toMatchObject({
    result: {
      records: expect.arrayContaining([...apkSources, androidEvidence]),
    },
  });
  expect(bundleAfterRejectedSource.structuredContent).toEqual(
    androidBundle.structuredContent,
  );

  const ipaInventory = parseEvidence(
    await runProviderAnalysis(
      await writeIpa(root),
      "inventory_artifact",
      {},
    ).then(projectCliAnalysisResult),
  );
  const apple = await client.callTool({
    name: "project_apple_application_graph",
    arguments: { inventory_evidence: [ipaInventory] },
  });
  if (apple.isError === true) throw new Error(JSON.stringify(apple, null, 2));
  expect(apple.structuredContent).toMatchObject({
    operation: "project_apple_application_graph",
    provider: { id: "rea-apple-application" },
  });
  const retainedApple = await client.callTool({
    name: "project_apple_application_graph",
    arguments: {
      inventory_evidence: [
        { kind: "retained-evidence", evidence_id: ipaInventory.evidence_id },
      ],
    },
  });
  expect(retainedApple.isError, JSON.stringify(retainedApple)).not.toBe(true);
  expect(parseEvidence(retainedApple.structuredContent)).toEqual(
    parseEvidence(apple.structuredContent),
  );
});

it("projects a single inventory page as partial and links only that source", async () => {
  const client = await connect();
  const root = await createTestTempDirectory("rea-mobile-partial-page-mcp-");
  const inventory = parseEvidence(
    await runProviderAnalysis(
      await writeApk(root),
      "inventory_artifact",
      {},
    ).then(projectCliAnalysisResult),
  );
  const facts = artifactInventoryResultSchema.parse(
    inventory.normalized_result,
  );
  const subject = inventory.subject;
  if (subject === null) throw new Error("Expected an inventory subject");
  const page = createEvidence(
    {
      path: subject.local_path,
      sha256: subject.digest.sha256,
      format: subject.format,
    },
    inventory.provider,
    {
      operation: "inventory_artifact",
      parameters: inventory.parameters,
      result: { ...facts, nodes: [] },
      confidence: "derived",
      authority: inventory.authority,
    },
  );

  const reply = await client.callTool({
    name: "project_android_application_graph",
    arguments: { inventory_evidence: [page] },
  });
  if (reply.isError === true) throw new Error(JSON.stringify(reply, null, 2));
  const projection = parseEvidence(reply.structuredContent);
  const result = androidApplicationProjectionResultSchema.parse(
    projection.normalized_result,
  );
  expect(result).toMatchObject({
    source_evidence_ids: [page.evidence_id],
    coverage: { status: "partial", inventory_complete: false },
  });
  expect(result.limitations).toContain(
    "Source inventory coverage is partial; absence is unknown.",
  );
  expect(result.components.dex).toEqual([]);
  expect(result.unavailable_components).toEqual([]);
  const dex = facts.occurrences.find(
    ({ logical_path }) => logical_path === "classes.dex",
  );
  if (dex?.artifact_id === null || dex === undefined)
    throw new Error("Expected a known DEX artifact reference");
  const dexArtifactId = dex.artifact_id;
  const unresolved = result.limitations.find((limitation) =>
    limitation.includes(dexArtifactId),
  );
  expect(unresolved).toContain('"classes.dex"');
  expect(unresolved).toContain(dex.artifact_format);
  expect(unresolved).toContain("unknown");
  expect(projection.evidence_links).toEqual([page.evidence_id]);
  const retained = await client.callTool({
    name: "project_android_application_graph",
    arguments: {
      inventory_evidence: [
        { kind: "retained-evidence", evidence_id: page.evidence_id },
      ],
    },
  });
  expect(retained.isError, JSON.stringify(retained)).not.toBe(true);
  expect(parseEvidence(retained.structuredContent)).toEqual(projection);
  const bundle = await client.callTool({
    name: "get_evidence_bundle",
    arguments: {},
  });
  expect(bundle.structuredContent).toMatchObject({
    result: { records: expect.arrayContaining([page, projection]) },
  });
  const completed = await client.callTool({
    name: "project_android_application_graph",
    arguments: { inventory_evidence: [page, inventory] },
  });
  if (completed.isError === true) throw new Error(JSON.stringify(completed));
  const resolved = androidApplicationProjectionResultSchema.parse(
    parseEvidence(completed.structuredContent).normalized_result,
  );
  expect(resolved.coverage.inventory_complete).toBe(true);
  expect(resolved.components.dex).toContainEqual(
    expect.objectContaining({
      path: "classes.dex",
      artifact_id: dex.artifact_id,
    }),
  );
  expect(
    resolved.limitations.some((limitation) =>
      limitation.includes(dexArtifactId),
    ),
  ).toBe(false);
});

it("rejects a valid non-inventory carrier as caller-selected input", async () => {
  const client = await connect();
  const wrongCarrier = createEvidence(
    undefined,
    { id: "fixture", name: "Fixture", version: "1" },
    { operation: "analyze_binary", parameters: {}, result: {} },
  );

  const rejected = await client.callTool({
    name: "project_android_application_graph",
    arguments: { inventory_evidence: [wrongCarrier] },
  });
  expect(parseMcpToolError(rejected)).toMatchObject({
    error: {
      code: "invalid_request",
      category: "invalid_input",
      details: {
        issues: [
          {
            path: ["inventory_evidence", 0, "operation"],
          },
        ],
      },
    },
  });
  const bundle = await client.callTool({
    name: "get_evidence_bundle",
    arguments: {},
  });
  expect(bundle.structuredContent).toMatchObject({ result: { records: [] } });
});

it("rejects authentic pages from different roots without retaining either", async () => {
  const client = await connect();
  const root = await createTestTempDirectory("rea-mobile-mixed-pages-mcp-");
  const apk = parseEvidence(
    await runProviderAnalysis(
      await writeApk(root),
      "inventory_artifact",
      {},
    ).then(projectCliAnalysisResult),
  );
  const ipa = parseEvidence(
    await runProviderAnalysis(
      await writeIpa(root),
      "inventory_artifact",
      {},
    ).then(projectCliAnalysisResult),
  );

  const rejected = await client.callTool({
    name: "project_android_application_graph",
    arguments: {
      inventory_evidence: [
        fragmentInventoryEvidence(apk, 2)[0],
        fragmentInventoryEvidence(ipa, 2)[0],
      ],
    },
  });
  expect(parseMcpToolError(rejected)).toMatchObject({
    error: {
      code: "invalid_request",
      category: "invalid_input",
      details: {
        issues: [{ path: ["inventory_evidence"] }],
      },
    },
  });
  const bundle = await client.callTool({
    name: "get_evidence_bundle",
    arguments: {},
  });
  expect(bundle.structuredContent).toMatchObject({ result: { records: [] } });
});

it.each([
  {
    family: "Harmony",
    name: "Locked.hap",
    manifest: "module.json",
    unread: "ets/modules.abc",
    operation: "project_harmony_application_graph",
  },
  {
    family: "Android",
    name: "Locked.apk",
    manifest: "AndroidManifest.xml",
    unread: "classes.dex",
    operation: "project_android_application_graph",
  },
  {
    family: "Apple",
    name: "Locked.ipa",
    manifest: "Payload/Locked.app/Info.plist",
    unread: "Payload/Locked.app/libentry.dylib",
    operation: "project_apple_application_graph",
  },
])(
  "retains $family unavailable components and their source Evidence through MCP",
  async ({ name, manifest, unread, operation }) => {
    const client = await connect();
    const root = await createTestTempDirectory("rea-harmony-graph-mcp-");
    const path = join(root, name);
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add(manifest, new TextReader("{}"));
    await writer.add(unread, new TextReader("opaque bytecode"), {
      password: "fixture-only",
    });
    await writeFile(path, await writer.close());
    const inventory = parseEvidence(
      await runProviderAnalysis(path, "inventory_artifact", {}).then(
        projectCliAnalysisResult,
      ),
    );
    const reply = await client.callTool({
      name: operation,
      arguments: { inventory_evidence: [inventory] },
    });
    if (reply.isError === true) throw new Error(JSON.stringify(reply));
    const evidence = parseEvidence(reply.structuredContent);
    expect(evidence.normalized_result).toMatchObject({
      unavailable_components: [
        expect.objectContaining({
          path: unread,
          artifact_id: null,
          sha256: null,
          encrypted: true,
        }),
      ],
      coverage: { status: "partial", inventory_complete: true },
    });
    const retained = await client.callTool({
      name: operation,
      arguments: {
        inventory_evidence: [
          { kind: "retained-evidence", evidence_id: inventory.evidence_id },
        ],
      },
    });
    expect(retained.isError, JSON.stringify(retained)).not.toBe(true);
    expect(parseEvidence(retained.structuredContent)).toEqual(evidence);
    const bundle = await client.callTool({
      name: "get_evidence_bundle",
      arguments: {},
    });
    expect(bundle.structuredContent).toMatchObject({
      result: { records: expect.arrayContaining([inventory, evidence]) },
    });
  },
);
