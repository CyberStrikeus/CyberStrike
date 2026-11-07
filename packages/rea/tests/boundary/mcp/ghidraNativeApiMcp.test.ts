import { describe, expect, it } from "vitest";
import { connectGhidraMcp, sessionEvidence } from "./ghidraMcpHarness.js";
import {
  fixtureDosOverlapLoadImage,
  compareDosClientFixture,
} from "../../../src/ghidra/GhidraLoadImage.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { jsonValueSchema } from "../../../src/domain/jsonValue.js";
import { nativeLoadImageSchema } from "../../../src/domain/native/nativeLoadImage.js";
import { nativeApiInspectionResultSchema } from "../../../src/domain/native/nativeApiBoundary.js";
import { functionDossierSchema } from "../../../src/domain/native/functionDossier.js";
import { ok } from "../../../src/domain/result.js";
import { ghidraFunctionDossier } from "../../../src/domain/ghidraValues.fixture.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";

it("retains complete load-image facts and pages selected relocations through the advertised SDK contracts", async () => {
  const fixture = fixtureDosOverlapLoadImage();
  const directory = await createTestTempDirectory("rea-mcp-load-summary-");
  const targetPath = join(directory, "inert.exe");
  await writeFile(targetPath, fixture.bytes);
  const harness = await connectGhidraMcp(
    "ghidra-load-summary",
    async () => ok(jsonValueSchema.parse(fixture.observation)),
    {
      targetPath,
      sessionTarget: {
        name: "inert.exe",
        language_id: fixture.observation.language_id,
        compiler_spec_id: fixture.observation.compiler_spec_id,
        image_base: fixture.observation.image_base,
        default_address_space: fixture.observation.default_address_space,
        sha256: fixture.sha256,
      },
      attestDosTargetSnapshot: async (observations) =>
        compareDosClientFixture(fixture.bytes, fixture.sha256, observations),
    },
  );
  try {
    const catalog = await harness.mcp.listTools();
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const call = async (
      name: "inspect_native_load_image" | "inspect_analysis_view",
      input: Record<string, unknown>,
    ) => {
      const definition = catalog.tools.find((tool) => tool.name === name);
      if (!definition?.outputSchema) throw new Error("Missing named schema");
      const inputSchema: Record<string, unknown> = definition.inputSchema;
      const outputSchema: Record<string, unknown> = definition.outputSchema;
      expect(ajv.validateSchema(inputSchema)).toBe(true);
      expect(ajv.validateSchema(outputSchema)).toBe(true);
      const reply = await harness.mcp.callTool(
        { name, arguments: input },
        { toolDefinition: definition },
      );
      expect(reply.isError).not.toBe(true);
      expect(
        ajv.validate(outputSchema, reply.structuredContent),
        JSON.stringify(ajv.errors),
      ).toBe(true);
      return sessionEvidence(harness.session, reply.structuredContent);
    };
    const complete = await call("inspect_native_load_image", {});
    const summary = await call("inspect_native_load_image", {
      detail: "summary",
    });
    expect(summary.normalized_result).toMatchObject({
      parent_evidence_id: complete.evidence_id,
      source_provider: complete.provider,
      source_analysis_profile_digest: complete.analysis_profile?.digest,
      source_parameters: complete.parameters,
      summary: {
        verification: { status: "verified", format: "dos-mz" },
        counts: { relocations: 2 },
      },
    });
    const calls = harness.calls.length;
    const page = await call("inspect_analysis_view", {
      source: { kind: "retained-evidence", evidence_id: complete.evidence_id },
      view: {
        kind: "native-load-image",
        collection: "relocations",
        offset: 1,
        limit: 1,
        fields: ["address", "memory_bytes_hex"],
      },
    });
    const parsed = analysisViewResultSchema.parse(page.normalized_result);
    if (parsed.kind !== "native-load-image")
      throw new Error("Expected load-image page");
    expect(parsed.verification_status).toBe("verified");
    expect(parsed.items.rows).toEqual([
      {
        source_index: 1,
        record: {
          address: fixture.observation.relocations[1]!.address,
          memory_bytes_hex:
            fixture.observation.relocations[1]!.memory_bytes_hex,
        },
      },
    ]);
    expect(harness.calls).toHaveLength(calls);
    expect(harness.session.evidenceById(complete.evidence_id)).toEqual(
      complete,
    );
    expect(complete.parameters).toEqual({});
  } finally {
    await harness.close();
  }
});

it.each([
  { state: "final", failed: [] },
  { state: "intermediate", failed: ["relocation_records"] },
  { state: "missing-record", failed: ["relocation_records"] },
  { state: "duplicate-record", failed: ["relocation_records"] },
  { state: "reversed-records", failed: [] },
  { state: "bad-source", failed: ["modified_file_sha256"] },
  { state: "bad-mapping", failed: ["mapping[1].memory_sha256"] },
])(
  "retains final overlapping MZ relocation Evidence through MCP ($state)",
  async ({ state, failed }) => {
    const fixture = fixtureDosOverlapLoadImage();
    const first = fixture.observation.relocations[0];
    const source = fixture.observation.source_files[0];
    const mapping = fixture.observation.mappings[1];
    if (first === undefined || source === undefined || mapping === undefined)
      throw new Error("Missing authored overlap facts");
    if (state === "intermediate") first.memory_bytes_hex = "0410";
    if (state === "missing-record") fixture.observation.relocations.pop();
    if (state === "duplicate-record")
      fixture.observation.relocations.push(structuredClone(first));
    if (state === "reversed-records") fixture.observation.relocations.reverse();
    if (state === "bad-source") source.modified_sha256 = "f".repeat(64);
    if (state === "bad-mapping") mapping.sha256 = "f".repeat(64);
    const directory = await createTestTempDirectory("rea-mcp-mz-overlap-");
    const targetPath = join(directory, "inert.exe");
    await writeFile(targetPath, fixture.bytes);
    const harness = await connectGhidraMcp(
      "ghidra-mz-relocation-windows",
      async () => ok(jsonValueSchema.parse(fixture.observation)),
      {
        targetPath,
        sessionTarget: {
          name: "inert.exe",
          language_id: fixture.observation.language_id,
          compiler_spec_id: fixture.observation.compiler_spec_id,
          image_base: fixture.observation.image_base,
          default_address_space: fixture.observation.default_address_space,
          sha256: fixture.sha256,
        },
        attestDosTargetSnapshot: async (observations) =>
          compareDosClientFixture(fixture.bytes, fixture.sha256, observations),
      },
    );
    try {
      const reply = await harness.mcp.callTool({
        name: "inspect_native_load_image",
        arguments: {},
      });
      expect(reply.isError).not.toBe(true);
      const evidence = sessionEvidence(
        harness.session,
        reply.structuredContent,
      );
      const result = nativeLoadImageSchema.parse(evidence.normalized_result);
      if (result.status === "unsupported")
        throw new Error("Expected MZ comparison");
      expect(result.status).toBe(failed.length > 0 ? "mismatch" : "verified");
      expect(
        result.checks
          .filter((check) => !check.matched)
          .map((check) => check.name),
      ).toEqual(failed);
      expect(result.observations.relocations).toEqual(
        fixture.observation.relocations,
      );
    } finally {
      await harness.close();
    }
  },
);

describe("Ghidra MCP native API evidence", () => {
  it("retains transient failure Evidence without freezing the composed API inspection", async () => {
    let failed = true;
    const harness = await connectGhidraMcp(
      "ghidra-native-api-recovery",
      async (operation) => {
        if (operation !== "analyze_function")
          throw new Error(`Unexpected operation: ${operation}`);
        const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
        if (failed)
          dossier.native_api = {
            available: false,
            reason: "Injected backend failure",
            residual_unknowns: ["Retry after recovery."],
          };
        return ok(
          jsonValueSchema.parse({
            value: dossier,
            limitations: [],
            ...(failed ? { cache_policy: "live" } : {}),
          }),
        );
      },
    );
    try {
      const inspect = async () => {
        const reply = await harness.mcp.callTool({
          name: "inspect_native_api",
          arguments: { procedure: "fixture_main" },
        });
        expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
        return sessionEvidence(harness.session, reply.structuredContent);
      };
      const degraded = await inspect();
      expect(degraded.normalized_result).toMatchObject({
        boundary: { available: false },
      });
      const snapshot = harness.session.exportAnalysisSnapshot();
      if (!snapshot.ok) throw snapshot.error;
      expect(snapshot.value.entries).toEqual([]);
      expect(snapshot.value.workflow_entries).toEqual([]);
      expect(harness.session.evidenceById(degraded.evidence_id)).toEqual(
        degraded,
      );
      failed = false;
      expect((await inspect()).normalized_result).toMatchObject({
        boundary: { available: true },
      });
      await inspect();
      expect(harness.calls).toEqual(["analyze_function", "analyze_function"]);
    } finally {
      await harness.close();
    }
  }, 30_000);

  it("returns complete native API boundaries without output-cap unknowns", async () => {
    const harness = await connectGhidraMcp("ghidra-native-api");
    const { mcp, session } = harness;
    try {
      const inspection = sessionEvidence(
        session,
        (
          await mcp.callTool({
            name: "inspect_native_api",
            arguments: { procedure: "fixture_main" },
          })
        ).structuredContent,
      );
      expect(inspection.normalized_result).toMatchObject({
        procedure: { address: "0x401000", name: "fixture_main" },
        boundary: {
          available: true,
          return_type: { data_type: "int", confidence: "medium" },
          jump_tables: [
            {
              dispatch_address: "0x401010",
              data_sources: [{ address: "0x403000" }],
              mappings: [{ case_value: 0, target_address: "0x401020" }],
              default_targets: [
                { target_address: "0x401030", confidence: "high" },
              ],
            },
          ],
        },
        unsupported_branches: [],
        residual_unknowns: [],
      });
      expect(
        (
          await mcp.callTool({
            name: "list_unknowns",
            arguments: {},
          })
        ).structuredContent,
      ).toMatchObject({ result: { items: [] } });
    } finally {
      await harness.close();
    }
  }, 30_000);
});

it("retains unavailable Ghidra native API observations across provenance and exact replay", async () => {
  const residual = "The controlled provider omitted native API boundary facts.";
  // This wire fixture is controlled and never launches Ghidra.
  const harness = await connectGhidraMcp(
    "ghidra-native-api-unavailable-identity",
    async (operation, input) => {
      if (operation !== "analyze_function")
        throw new Error(`Unexpected controlled Ghidra operation: ${operation}`);
      const procedure = String(input.procedure);
      const base = functionDossierSchema.parse(ghidraFunctionDossier());
      const address = procedure === "0x401000" ? procedure : "0x401100";
      return ok(
        jsonValueSchema.parse({
          value: functionDossierSchema.parse({
            ...base,
            procedure: {
              ...base.procedure,
              address,
              name: address === "0x401000" ? "fixture_main" : "fixture_other",
              body: {
                ...base.procedure.body,
                ranges: [
                  {
                    start: address,
                    end: address === "0x401000" ? "0x401005" : "0x401105",
                  },
                ],
              },
            },
            native_api: {
              available: false,
              reason: residual,
              residual_unknowns: [residual],
            },
          }),
          limitations: [],
        }),
      );
    },
  );
  const { mcp, session } = harness;
  try {
    const inspect = async (procedure: string) => {
      const reply = await mcp.callTool({
        name: "inspect_native_api",
        arguments: { procedure },
      });
      expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
      const evidence = sessionEvidence(session, reply.structuredContent);
      const result = nativeApiInspectionResultSchema.parse(
        evidence.normalized_result,
      );
      expect(result).toMatchObject({
        procedure: {
          address: procedure,
        },
        boundary: {
          available: false,
          reason: residual,
          residual_unknowns: [residual],
        },
        residual_unknowns: [residual],
      });
      return evidence;
    };

    const first = await inspect("0x401000");
    const replay = await inspect("0x401000");
    expect(replay.normalized_result).toEqual(first.normalized_result);
    expect(replay.evidence_id).not.toBe(first.evidence_id);
    expect(replay.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Loaded from a local REA analysis snapshot"),
      ]),
    );
    const warmBundle = session.exportEvidenceBundle();
    const warmReplay = await inspect("0x401000");
    expect(warmReplay.evidence_id).toBe(replay.evidence_id);
    expect(session.exportEvidenceBundle()).toEqual(warmBundle);

    const second = await inspect("0x401100");
    expect(second.evidence_id).not.toBe(first.evidence_id);
    expect(session.evidenceById(first.evidence_id)).toEqual(first);
    expect(session.evidenceById(replay.evidence_id)).toEqual(replay);

    const listed = await mcp.callTool({
      name: "list_unknowns",
      arguments: { domain: "native-api" },
    });
    expect(listed.isError, JSON.stringify(listed.content)).not.toBe(true);
    const unknownPage = toolContract("list_unknowns").outputSchema.parse(
      listed.structuredContent,
    ).result;
    expect(unknownPage.total).toBe(3);
    expect(unknownPage.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          question: expect.stringContaining(first.evidence_id),
          supporting_evidence_ids: [first.evidence_id],
        }),
        expect.objectContaining({
          question: expect.stringContaining(replay.evidence_id),
          supporting_evidence_ids: [replay.evidence_id],
        }),
        expect.objectContaining({
          question: expect.stringContaining(second.evidence_id),
          supporting_evidence_ids: [second.evidence_id],
        }),
      ]),
    );
    expect(
      unknownPage.items.every(({ question }) => question.includes(residual)),
    ).toBe(true);
  } finally {
    await harness.close();
  }
}, 30_000);
