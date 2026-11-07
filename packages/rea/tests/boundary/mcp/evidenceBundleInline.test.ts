import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ok as resultOk } from "../../../src/domain/result.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";

import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { observed } from "../../fixtures/analysisExecution.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { ANALYSIS_SNAPSHOT_TARGET } from "../../../src/domain/analysisSnapshot.fixture.js";

import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "../../../src/domain/process/processCaptureExample.js";
import { PROCESS_PROVIDER } from "../../../src/domain/process/processEvidenceProvider.js";
import { createServer } from "../../../src/server/createServer.js";
import { JSON_BYTE_ORDER_MARK_MESSAGE } from "../../../src/application/Utf8JsonInput.js";

it("exports and imports GameCube DOL Evidence without losing its subject identity", async () => {
  const root = await createTestTempDirectory("rea-dol-bundle-mcp-");
  const path = join(root, "bundle.json");
  const record = createEvidence(
    {
      path: join(root, "game.dol"),
      sha256: "d".repeat(64),
      format: "gamecube-dol",
      architecture: "powerpc",
    },
    { id: "fixture", name: "Fixture", version: "1" },
    {
      operation: "inspect_artifact",
      parameters: {},
      result: { observed: true },
    },
  );
  const session = createTestBinarySession(() => {
    throw new Error("bundle round trip must not run a provider");
  });
  expect(session.recordEvidence(record).ok).toBe(true);
  const source = await connectEvidenceMcp("dol-source", session);
  const importedSession = createTestBinarySession(() => {
    throw new Error("bundle import must not run a provider");
  });
  const target = await connectEvidenceMcp("dol-target", importedSession);
  try {
    const inline = await source.client.callTool({
      name: "get_evidence_bundle",
      arguments: {},
    });
    expect(inline.isError).not.toBe(true);
    expect(inline.structuredContent).toMatchObject({
      result: {
        artifacts: [{ format: "gamecube-dol", architecture: "powerpc" }],
      },
    });
    const exported = await source.client.callTool({
      name: "export_evidence_bundle",
      arguments: { path },
    });
    expect(exported.isError).not.toBe(true);
    const imported = await target.client.callTool({
      name: "import_evidence_bundle",
      arguments: { path },
    });
    expect(imported.isError).not.toBe(true);
    const restored = await target.client.callTool({
      name: "get_evidence_bundle",
      arguments: {},
    });
    expect(restored.structuredContent).toEqual(inline.structuredContent);
  } finally {
    await Promise.allSettled([
      source.client.close(),
      source.server.close(),
      session.close(),
      target.client.close(),
      target.server.close(),
      importedSession.close(),
    ]);
  }
});

it("preserves BOM recovery through public bundle import", async () => {
  const root = await createTestTempDirectory("rea-bundle-bom-mcp-");
  const path = join(root, "bundle.json");
  await writeFile(path, "\uFEFF{}");
  const session = createTestBinarySession(() => {
    throw new Error("bundle import must not start a provider");
  });
  const { client, server } = await connectEvidenceMcp("bundle-bom", session);
  try {
    const response = await client.callTool({
      name: "import_evidence_bundle",
      arguments: { path },
    });
    expect(parseMcpToolError(response)).toMatchObject({
      error: {
        code: "evidence_integrity_mismatch",
        message: JSON_BYTE_ORDER_MARK_MESSAGE,
        remediation: { action: JSON_BYTE_ORDER_MARK_MESSAGE },
      },
    });
  } finally {
    await Promise.allSettled([client.close(), server.close(), session.close()]);
  }
});

it("returns the complete session Evidence bundle in the tool result", async () => {
  const evidence = createEvidence(
    undefined,
    { id: "fixture", name: "Fixture", version: "1" },
    { operation: "observe", parameters: {}, result: { value: "seen" } },
  );
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  expect(session.recordEvidence(evidence).ok).toBe(true);
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "inline-evidence-bundle", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({
      name: "get_evidence_bundle",
      arguments: {},
    });
    expect(result.structuredContent).toMatchObject({
      result: {
        records: [
          {
            evidence_id: evidence.evidence_id,
            normalized_result: { value: "seen" },
          },
        ],
      },
    });
  } finally {
    await Promise.allSettled([client.close(), server.close(), session.close()]);
  }
});

it("rejects bundle field stripping at MCP import without changing retained evidence", async () => {
  const root = await createTestTempDirectory("rea-evidence-bundle-mcp-");
  const sourceSession = createBundleSourceSession();
  const targetSession = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  const source = await connectEvidenceMcp("bundle-source", sourceSession);
  const target = await connectEvidenceMcp("bundle-target", targetSession);
  const { client: sourceClient } = source;
  const { client: targetClient } = target;
  const bundlePath = join(root, "exported.json");
  const targetExportPath = join(root, "round-trip.json");

  try {
    const { sourceJson, records, evidenceIndex } = await exportFixtureBundle(
      sourceClient,
      bundlePath,
    );
    const initial = structured(
      await targetClient.callTool({
        name: "get_evidence_bundle",
        arguments: {},
      }),
    ).result;
    for (const [label, path] of unsupportedBundleFields(evidenceIndex)) {
      const candidate = structuredClone(sourceJson);
      setPath(candidate, path, "unsupported-metadata");
      const malformedPath = join(root, `${label.replaceAll(" ", "-")}.json`);
      await writeFile(malformedPath, JSON.stringify(candidate));
      const rejected = await targetClient.callTool({
        name: "import_evidence_bundle",
        arguments: { path: malformedPath },
      });
      expect(parseMcpToolError(rejected), label).toMatchObject({
        error: { code: "evidence_integrity_mismatch" },
      });
      expect(
        structured(
          await targetClient.callTool({
            name: "get_evidence_bundle",
            arguments: {},
          }),
        ).result,
        label,
      ).toEqual(initial);
    }

    const imported = await targetClient.callTool({
      name: "import_evidence_bundle",
      arguments: { path: bundlePath },
    });
    if (imported.isError === true)
      throw new Error(JSON.stringify(parseMcpToolError(imported)));
    await targetClient.callTool({
      name: "export_evidence_bundle",
      arguments: { path: targetExportPath },
    });
    expect(JSON.parse(await readFile(targetExportPath, "utf8"))).toEqual(
      sourceJson,
    );
    const observedRecord = records[evidenceIndex]!;
    expect(observedRecord.parameters).toEqual({ caller: { note: "preserve" } });
    expect(observedRecord.normalized_result).toEqual({
      producer: { extension: "preserve" },
    });
    expect(object(observedRecord.analysis_profile).parameters).toEqual({
      loader: { mode: "full" },
    });
  } finally {
    await Promise.allSettled([
      sourceClient.close(),
      source.server.close(),
      sourceSession.close(),
      targetClient.close(),
      target.server.close(),
      targetSession.close(),
    ]);
  }
});

const createBundleSourceSession = () => {
  const provider = { id: "fixture", name: "Fixture", version: "1" };
  const evidence = createEvidence(ANALYSIS_SNAPSHOT_TARGET, provider, {
    operation: "observe",
    parameters: { caller: { note: "preserve" } },
    result: { producer: { extension: "preserve" } },
    analysisProfile: createAnalysisProfile(provider, {
      loader: { mode: "full" },
    }),
    environment: {
      id: "fixture-linux",
      platform: "linux",
      architecture: "x86_64",
      isolation: "process",
    },
    locations: [{ kind: "address", address: "0x1000" }],
  });
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  expect(session.recordEvidence(evidence).ok).toBe(true);
  for (const extra of [
    createEvidence(ANALYSIS_SNAPSHOT_TARGET, provider, {
      operation: "controlled_replay",
      parameters: {},
      result: { completed: true },
      authority: "controlled-replay",
    }),
    createEvidence(undefined, PROCESS_PROVIDER, {
      predicateType: "rea.process-capture",
      operation: "capture_process_scenario",
      parameters: {},
      result: EMPTY_PROCESS_CAPTURE_EXAMPLE,
      confidence: "observed",
      authority: "controlled-replay",
    }),
  ])
    expect(session.recordEvidence(extra).ok).toBe(true);
  return session;
};

const exportFixtureBundle = async (
  client: Client,
  path: string,
): Promise<{
  readonly sourceJson: unknown;
  readonly records: Record<string, unknown>[];
  readonly evidenceIndex: number;
}> => {
  const unknown = await client.callTool({
    name: "record_unknown",
    arguments: {
      question: "Does this remain unknown?",
      severity: "medium",
      domain: "bundle-format",
      required_authority: null,
      required_confidence: "derived",
      required_environment: null,
      recommended_probes: [{ operation: "observe", rationale: "Inspect it." }],
      relationships: [],
    },
  });
  expect(unknown.isError).not.toBe(true);
  const exported = await client.callTool({
    name: "export_evidence_bundle",
    arguments: { path },
  });
  expect(exported.isError).not.toBe(true);
  const sourceJson = JSON.parse(await readFile(path, "utf8")) as unknown;
  const records = array(object(sourceJson).records).map(object);
  const evidenceIndex = records.findIndex(
    (record) => record.operation === "observe",
  );
  expect(evidenceIndex).toBeGreaterThanOrEqual(0);
  return { sourceJson, records, evidenceIndex };
};

const unsupportedBundleFields = (
  evidenceIndex: number,
): readonly [string, readonly (string | number)[]][] => [
  ["bundle envelope", ["schema_version"]],
  ["record provider", ["records", evidenceIndex, "provider", "future_field"]],
  ["provider manifest", ["providers", 0, "future_field"]],
  ["record subject", ["records", evidenceIndex, "subject", "future_field"]],
  [
    "subject digest",
    ["records", evidenceIndex, "subject", "digest", "future_field"],
  ],
  ["artifact manifest", ["artifacts", 0, "future_field"]],
  [
    "record environment",
    ["records", evidenceIndex, "environment", "future_field"],
  ],
  ["environment manifest", ["environments", 0, "future_field"]],
  [
    "source location",
    ["records", evidenceIndex, "locations", 0, "future_field"],
  ],
  ["scenario manifest", ["scenarios", 0, "future_field"]],
  ["capture manifest", ["captures", 0, "future_field"]],
  [
    "analysis profile",
    ["records", evidenceIndex, "analysis_profile", "future_field"],
  ],
  [
    "profile provider",
    ["records", evidenceIndex, "analysis_profile", "provider", "future_field"],
  ],
  ["unknown revision", ["unknowns", 0, "future_field"]],
  ["unknown probe", ["unknowns", 0, "recommended_probes", 0, "future_field"]],
];

const connectEvidenceMcp = async (
  name: string,
  session: ReturnType<typeof createTestBinarySession>,
) => {
  const server = createServer({ kind: "session", session });
  const client = new Client({ name, version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
};

const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected object in exported Evidence bundle");
  return value as Record<string, unknown>;
};

const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value))
    throw new Error("Expected array in Evidence bundle");
  return value;
};

const setPath = (
  root: unknown,
  path: readonly (string | number)[],
  value: unknown,
): void => {
  const [last, ...parents] = [...path].reverse();
  if (last === undefined) throw new Error("Expected a nonempty bundle path");
  const target = parents
    .reverse()
    .reduce<unknown>(
      (current, segment) =>
        typeof segment === "number"
          ? array(current)[segment]
          : object(current)[segment],
      root,
    );
  object(target)[String(last)] = value;
};

const structured = (result: Awaited<ReturnType<Client["callTool"]>>) => {
  if (result.isError === true) throw parseMcpToolError(result);
  if (
    typeof result.structuredContent !== "object" ||
    result.structuredContent === null
  )
    throw new Error("Missing structured MCP result");
  return result.structuredContent as Record<string, unknown>;
};
