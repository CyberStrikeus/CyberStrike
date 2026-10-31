import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { expect } from "vitest";
import { z } from "zod";

import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import type {
  ProviderAvailability,
  AnalysisProvider,
} from "../../../src/application/AnalysisProvider.js";
import type { AndroidAnalysisPort } from "../../../src/application/android/AndroidAnalysisPort.js";
import type { AdbDeviceAnalysisPort } from "../../../src/application/adb/AdbDeviceAnalysisPort.js";
import type { ApktoolResourceAnalysisPort } from "../../../src/application/apktool/ApktoolResourceAnalysisPort.js";
import {
  createEvidenceBundle,
  evidenceBundleSchema,
} from "../../../src/domain/evidenceBundle.js";
import { ok } from "../../../src/domain/result.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";

const SNAPSHOT_PROFILE = createAnalysisProfile(
  { id: "fixture", name: "Fixture analysis provider", version: "1" },
  { fixture: true },
);

const HOST_TOOLS_NOT_CONFIGURED: ProviderAvailability = {
  status: "unavailable",
  code: "not_configured",
  reason: "The target-free MCP fixture does not probe host tools.",
  diagnostics: { source: "test_fixture" },
};

const unusedHostToolExecution = async (): Promise<never> => {
  throw new Error("Host-tool execution is outside the target-free fixture");
};

// These fixed ports keep this fake-session harness independent of whichever
// Android tools happen to be installed on the test host. The dedicated public
// availability test below continues to exercise status projection separately.
const androidAnalysis: AndroidAnalysisPort = {
  inspectAvailability: async () => HOST_TOOLS_NOT_CONFIGURED,
  close: async () => {},
  execute: unusedHostToolExecution,
};

const adbDeviceAnalysis: AdbDeviceAnalysisPort = {
  inspectAvailability: async () => HOST_TOOLS_NOT_CONFIGURED,
  close: async () => {},
  execute: unusedHostToolExecution,
};

const apktoolAnalysis: ApktoolResourceAnalysisPort = {
  inspectAvailability: async () => HOST_TOOLS_NOT_CONFIGURED,
  close: async () => {},
  execute: unusedHostToolExecution,
};

export interface SessionMcpHarness {
  readonly mcp: Client;
  readonly first: string;
  readonly second: string;
  readonly closed: string[];
}

export const createSessionMcpHarness = async (
  root: string,
  provider: (closed: string[]) => AnalysisProvider,
  resources: Array<{ close(): Promise<unknown> }>,
  maximumInputElements?: number,
  outputSchemaProfile?: "off",
): Promise<SessionMcpHarness> => {
  const first = join(root, "first.hop");
  const second = join(root, "second.hop");
  await Promise.all([writeFile(first, "one"), writeFile(second, "two")]);
  const closed: string[] = [];
  const session = createTestBinarySession(provider(closed), {
    resolveAnalysisProfile: () =>
      Promise.resolve(ok({ profile: SNAPSHOT_PROFILE })),
  });
  const server = createServer(
    { kind: "session", session },
    {
      androidAnalysis,
      adbDeviceAnalysis,
      apktoolAnalysis,
      logger: silentLogger,
      ...(maximumInputElements === undefined &&
      outputSchemaProfile === undefined
        ? {}
        : {
            environment: {
              ...process.env,
              ...(maximumInputElements === undefined
                ? {}
                : { REA_MCP_MAX_INPUT_ELEMENTS: String(maximumInputElements) }),
              ...(outputSchemaProfile === undefined
                ? {}
                : { REA_MCP_OUTPUT_SCHEMA_PROFILE: outputSchemaProfile }),
            },
          }),
    },
  );
  const mcp = new Client({ name: "session-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(mcp, server);
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return {
    mcp,
    first,
    second,
    closed,
  };
};

export const snapshotAndRecordUnknown = async (
  harness: SessionMcpHarness,
  root: string,
): Promise<{
  recordedUnknown: { unknown_id: string; revision: number };
}> => {
  const { mcp } = harness;
  const snapshotted = await mcp.callTool({
    name: "get_evidence_bundle",
    arguments: {},
  });
  expect(structured(snapshotted).result).toMatchObject({
    records: expect.any(Array),
    unknowns: expect.any(Array),
  });
  const evidencePath = join(root, "evidence.json");
  structured(
    await mcp.callTool({
      name: "export_evidence_bundle",
      arguments: { path: evidencePath },
    }),
  );
  const bundle = evidenceBundleSchema.parse(
    JSON.parse(await readFile(evidencePath, "utf8")),
  );
  expect(bundle.records).toHaveLength(1);
  expect(
    structured(
      await mcp.callTool({
        name: "import_evidence_bundle",
        arguments: { path: evidencePath },
      }),
    ).result,
  ).toEqual({ imported: 0, unknowns_added: 0, total: 1 });
  const externalEvidencePath = join(root, "external-evidence.json");
  await writeFile(
    externalEvidencePath,
    JSON.stringify(
      createEvidenceBundle([
        createEvidence(
          undefined,
          { id: "fixture", name: "Fixture", version: "1" },
          { operation: "external_observation", parameters: {}, result: true },
        ),
      ]),
    ),
  );
  expect(
    structured(
      await mcp.callTool({
        name: "import_evidence_bundle",
        arguments: { path: externalEvidencePath },
      }),
    ).result,
  ).toEqual({ imported: 1, unknowns_added: 0, total: 2 });
  const recordedUnknown = z
    .object({
      result: z.object({ unknown_id: z.string(), revision: z.number() }),
    })
    .parse(
      structured(
        await mcp.callTool({
          name: "record_unknown",
          arguments: {
            question: "Does the alternate branch execute?",
            severity: "medium",
            domain: "control-flow",
            required_authority: "controlled-replay",
            required_confidence: "observed",
            required_environment: null,
            recommended_probes: [],
            relationships: [],
          },
        }),
      ),
    ).result;
  expect(recordedUnknown.revision).toBe(1);
  const listedUnknowns = await mcp.callTool({
    name: "list_unknowns",
    arguments: {},
  });
  expect(listedUnknowns.isError).not.toBe(true);
  expect(
    z
      .object({ result: z.object({ items: z.array(z.unknown()) }) })
      .parse(structured(listedUnknowns)).result.items,
  ).toHaveLength(1);
  return { recordedUnknown };
};

const structured = (result: CallToolResult): Record<string, unknown> => {
  if (result.isError === true) return parseMcpToolError(result);
  if (
    typeof result.structuredContent !== "object" ||
    result.structuredContent === null
  )
    throw new Error("missing structured result");
  return z.record(z.string(), z.unknown()).parse(result.structuredContent);
};
