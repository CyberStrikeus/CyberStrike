import type { Client } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import {
  createAnalysisExecution,
  type AnalysisClient,
  type ProviderIdentity,
} from "../application/AnalysisProvider.js";
import { InvestigationRecords } from "../application/investigation/InvestigationRecords.js";
import { BinarySession } from "../application/binary/BinarySession.js";
import { AnalysisProviderRegistry } from "../application/binary/AnalysisProviderRegistry.js";
import { SessionProviderRouter } from "../application/binary/SessionProviderRouter.js";
import { toolContract } from "../contracts/toolContracts.js";
import { createEvidence } from "../domain/evidence.js";
import { jsonObjectSchema, type JsonValue } from "../domain/jsonValue.js";
import { createArtifactBinarySession } from "../composition/binary.js";
import { build } from "plist";
import { createApplicationMcpHarness } from "../../tests/fixtures/applicationMcpHarness.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";

const identity: ProviderIdentity = {
  id: "bundle-resource-mcp-fixture",
  name: "Bundle resource MCP fixture",
  version: "1",
};

it("routes bundle resource MCP calls with null executable identity and retained Evidence", async () => {
  const parent = await createTestTempDirectory("rea-bundle-resource-mcp-");
  const bundle = join(parent, "Fixture.app");
  await mkdir(bundle);
  const plistPath = join(bundle, "Info.plist");
  await writeFile(plistPath, '<?xml version="1.0"?><plist><dict/></plist>');

  const resourceClient: AnalysisClient = {
    execute: async (operation) => {
      if (operation === "health")
        return { ok: true, value: createAnalysisExecution(null, identity) };
      return {
        ok: true,
        value: createAnalysisExecution(
          {
            format: "xml",
            value: {},
            bundle: {
              identifier: null,
              executable: null,
              name: null,
              version: null,
              short_version: null,
            },
            source_path: plistPath,
            resource_root: {
              caller_path: bundle,
              canonical_path: bundle,
              info_plist_path: plistPath,
              layout: "root",
              executable_sha256: null,
            },
            provenance: [],
            limitations: [],
          },
          identity,
          { subject: null },
        ),
      };
    },
    close: async () => ({ ok: true, value: null }),
  };
  const session = new BinarySession(
    SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
    new InvestigationRecords(),
    { createClient: () => ({ client: resourceClient, capabilities: [] }) },
  );
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "bundle-resource-test", version: "1" },
  });

  await expectResourceSchemaBranches(client);

  const unbound = await client.callTool({
    name: "inspect_plist",
    arguments: { path: plistPath },
  });
  expect(unbound.isError).toBe(true);
  const unboundError = unbound.content.find((item) => item.type === "text");
  if (unboundError?.type !== "text") throw new Error("Expected error text");
  expect(JSON.parse(unboundError.text)).toMatchObject({
    error: { code: "target_unavailable", category: "unavailable" },
  });
  const unopened = await client.callTool({
    name: "binary_session",
    arguments: {},
  });
  expect(
    toolContract("binary_session").outputSchema.parse(
      unopened.structuredContent,
    ),
  ).toMatchObject({
    result: {
      open: false,
      tool_availability: {
        groups: expect.arrayContaining([
          expect.objectContaining({
            names: expect.arrayContaining(["inspect_plist"]),
            available: false,
            reason: "target_required",
          }),
        ]),
      },
    },
  });

  const opened = await client.callTool({
    name: "open_bundle_resources",
    arguments: { path: bundle },
  });
  expect(opened.isError).not.toBe(true);
  expect(
    toolContract("open_bundle_resources").outputSchema.parse(
      opened.structuredContent,
    ),
  ).toMatchObject({
    result: {
      canonical_path: bundle,
      executable_sha256: null,
    },
  });

  const status = await client.callTool({
    name: "binary_session",
    arguments: {},
  });
  expect(status.isError).not.toBe(true);
  expect(
    toolContract("binary_session").outputSchema.parse(status.structuredContent),
  ).toMatchObject({
    result: {
      open: true,
      session_kind: "bundle_resources",
      resource_root: { canonical_path: bundle, executable_sha256: null },
    },
  });

  const inspected = await client.callTool({
    name: "inspect_plist",
    arguments: { path: plistPath },
  });
  expect(inspected.isError).not.toBe(true);
  const evidence = toolContract("inspect_plist").outputSchema.parse(
    inspected.structuredContent,
  );
  expect(evidence).toMatchObject({
    subject: null,
    normalized_result: {
      source_path: plistPath,
      resource_root: { executable_sha256: null },
    },
  });
  const evidenceId = z
    .object({ evidence_id: z.string() })
    .parse(evidence).evidence_id;
  expect(session.evidenceById(evidenceId)).toMatchObject({
    subject: null,
    operation: "inspect_plist",
    normalized_result: {
      resource_root: { canonical_path: bundle, executable_sha256: null },
    },
  });
});

it("exposes the production resource session through the MCP SDK for a keyless bundle", async () => {
  const parent = await createTestTempDirectory(
    "rea-bundle-resource-production-mcp-",
  );
  const bundle = join(parent, "Fixture.app");
  const resourceDirectory = join(bundle, "Resources");
  await mkdir(resourceDirectory, { recursive: true });
  await writeFile(join(bundle, "Info.plist"), "<plist><dict/></plist>");
  await writeFile(
    join(resourceDirectory, "Archive.plist"),
    build({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: ["$null", "resource-only-value"],
      $top: { root: { UID: 1 } },
    }),
  );

  const session = await createArtifactBinarySession({}, process.platform);
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "production-bundle-resource-test", version: "1" },
  });

  const opened = await client.callTool({
    name: "open_bundle_resources",
    arguments: { path: bundle },
  });
  expect(opened.isError).not.toBe(true);
  expect(
    toolContract("open_bundle_resources").outputSchema.parse(
      opened.structuredContent,
    ),
  ).toMatchObject({
    result: { canonical_path: bundle, executable_sha256: null },
  });

  const decoded = await client.callTool({
    name: "decode_interface_builder",
    arguments: {},
  });
  expect(decoded.isError).not.toBe(true);
  const decodedEvidence = toolContract(
    "decode_interface_builder",
  ).outputSchema.parse(decoded.structuredContent);
  expect(decodedEvidence).toMatchObject({
    subject: null,
    normalized_result: {
      target_sha256: null,
      resource_root: { canonical_path: bundle, executable_sha256: null },
    },
  });
  const decodedEvidenceId = z
    .object({ evidence_id: z.string() })
    .parse(decodedEvidence).evidence_id;
  for (const view of [
    { kind: "summary" },
    {
      kind: "interface-builder",
      collection: "documents",
      offset: 0,
      limit: 64,
    },
  ] as const) {
    const projected = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: { kind: "retained-evidence", evidence_id: decodedEvidenceId },
        view,
      },
    });
    expect(projected.isError).not.toBe(true);
    expect(
      toolContract("inspect_analysis_view").outputSchema.parse(
        projected.structuredContent,
      ),
    ).toMatchObject({
      normalized_result: {
        artifact: { path: bundle, sha256: null },
        resource_root: {
          caller_path: bundle,
          canonical_path: bundle,
          executable_sha256: null,
        },
      },
    });
  }

  const inspected = await client.callTool({
    name: "inspect_keyed_archive",
    arguments: { path: "Resources/Archive.plist" },
  });
  expect(inspected.isError).not.toBe(true);
  const evidence = toolContract("inspect_keyed_archive").outputSchema.parse(
    inspected.structuredContent,
  );
  expect(evidence).toMatchObject({
    subject: null,
    normalized_result: {
      archive_path: "Resources/Archive.plist",
      target_sha256: null,
      resource_root: { canonical_path: bundle, executable_sha256: null },
      objects: expect.arrayContaining([
        expect.objectContaining({ value: "resource-only-value" }),
      ]),
    },
  });
  const evidenceId = z
    .object({ evidence_id: z.string() })
    .parse(evidence).evidence_id;
  expect(session.evidenceById(evidenceId)).toMatchObject({
    subject: null,
    operation: "inspect_keyed_archive",
    normalized_result: {
      resource_root: { canonical_path: bundle, executable_sha256: null },
    },
  });
});

const expectResourceSchemaBranches = async (client: Client): Promise<void> => {
  const schemaCases: Array<{
    readonly name:
      | "decode_interface_builder"
      | "inspect_asset_catalog"
      | "inspect_keyed_archive";
    readonly validResult: JsonValue;
  }> = [
    {
      name: "decode_interface_builder",
      validResult: jsonObjectSchema.parse({
        target_sha256: "a".repeat(64),
        documents: [],
        graph: {
          target_sha256: "a".repeat(64),
          provider: { id: "fixture", version: null, tool_version: "1" },
          nodes: [],
          edges: [],
          coverage: [],
          truncated: false,
        },
        limitations: [],
      }),
    },
    {
      name: "inspect_asset_catalog",
      validResult: jsonObjectSchema.parse({
        target_sha256: "a".repeat(64),
        catalogs: [],
        inventory_coverage: { scope: "container-entries", status: "unknown" },
        catalog_coverage: {
          status: "unknown",
          reason: "catalog_coverage_not_reported",
        },
        resource_key_coverage: {
          status: "unknown",
          reason: "resource_key_coverage_not_reported",
        },
        total_records: 0,
        offset: 0,
        limit: 1,
        records: [],
        resource_key_matches: [],
        next_offset: null,
        truncated: false,
        limitations: [],
      }),
    },
    {
      name: "inspect_keyed_archive",
      validResult: jsonObjectSchema.parse({
        target_sha256: "a".repeat(64),
        archive_path: "Resources/data.archive",
        archive_sha256: "b".repeat(64),
        archive_format: "binary-plist",
        roots: {},
        objects: [],
        references: [],
        total_objects: 0,
        total_references: 0,
        offset: 0,
        next_offset: null,
        truncated: false,
        limitations: [],
      }),
    },
  ] as const;
  const advertisedTools = new Map(
    (await client.listTools()).tools.map((tool) => [tool.name, tool]),
  );
  const resourceRoot = {
    caller_path: "/tmp/Fixture.app",
    canonical_path: "/tmp/Fixture.app",
    info_plist_path: "/tmp/Fixture.app/Info.plist",
    layout: "root",
    executable_sha256: null,
  } as const;
  for (const { name, validResult } of schemaCases) {
    const contract = toolContract(name);
    const validEvidence = createEvidence(undefined, identity, {
      operation: name,
      parameters: {},
      result: validResult,
    });
    expect(contract.outputSchema.safeParse(validEvidence).success, name).toBe(
      true,
    );
    const malformedResult = structuredClone(validResult) as Record<
      string,
      JsonValue
    >;
    malformedResult.target_sha256 = null;
    if (name === "decode_interface_builder") {
      malformedResult.graph = {
        ...(malformedResult.graph as Record<string, JsonValue>),
        target_sha256: null,
      };
    }
    const malformedEvidence = createEvidence(undefined, identity, {
      operation: name,
      parameters: {},
      result: malformedResult,
    });
    expect(
      contract.outputSchema.safeParse(malformedEvidence).success,
      `${name} canonical rejects missing resource_root`,
    ).toBe(false);
    const advertised = advertisedTools.get(name)?.outputSchema;
    expect(advertised, `${name} is advertised`).toBeDefined();
    if (advertised === undefined) continue;
    const validateAdvertised = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(advertised as AnySchema);
    const resourceResult = structuredClone(validResult) as Record<
      string,
      JsonValue
    >;
    resourceResult.target_sha256 = null;
    resourceResult.resource_root = resourceRoot;
    if (name === "decode_interface_builder") {
      resourceResult.graph = {
        ...(resourceResult.graph as Record<string, JsonValue>),
        target_sha256: null,
      };
    }
    const resourceEvidence = createEvidence(undefined, identity, {
      operation: name,
      parameters: {},
      result: resourceResult,
    });
    expect(
      contract.outputSchema.safeParse(resourceEvidence).success,
      name,
    ).toBe(true);
    expect(
      validateAdvertised(resourceEvidence),
      `${name} advertised root branch`,
    ).toBe(true);
    expect(
      validateAdvertised(malformedEvidence),
      `${name} advertised schema rejects missing resource_root`,
    ).toBe(false);
  }
};
