import { createHash } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { INSPECT_MODEL_ARTIFACT_CONTRACT } from "../../src/contracts/model/modelToolContracts.js";
import {
  modelArtifactSchema,
  type ModelArtifact,
} from "../../src/domain/model/modelArtifact.js";
import {
  modelArtifactSummaryViewResultSchema,
  analysisViewResultSchema,
} from "../../src/domain/analysisView/analysisView.js";
import { createEvidence, parseEvidence } from "../../src/domain/evidence.js";
import { readEvidenceBundle } from "../../src/application/EvidenceBundleFiles.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import {
  ggufFixture,
  ggufKLayouts,
  ggufShiftedTypeLayouts,
  safetensorsFixture,
} from "../fixtures/model/model.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  cliTest,
  createSharedMcpSession,
  runFileCli,
} from "../support/cli/cliFixture.js";

// Model queries are target-free; share immutable registration and schema setup.
// Portable export keeps its separate post-CLI connection below.
const modelMcp = createSharedMcpSession(async (registerCleanup) => {
  const { call } = await connectLocalToolsMcp({}, registerCleanup);
  return call;
});
afterAll(() => modelMcp.close());

cliTest(
  "preserves lowercase hyphenated GGUF architecture metadata from the published writer",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-model-hyphen-architecture-",
    );
    const base = ggufFixture();
    for (const architecture of ["gpt-oss", "wavtokenizer-dec"] as const) {
      const path = join(root, `${architecture}.gguf`);
      const bytes = ggufFixture({
        tensors: [],
        metadata: [
          {
            key: "general.architecture",
            type: 8,
            value: base.text(architecture),
          },
          {
            key: `${architecture}.context_length`,
            type: 4,
            value: base.u32(4096),
          },
        ],
      }).bytes;
      await writeFile(path, bytes);
      const response = await cli.run({
        arguments: [
          "inspect-model-artifact",
          path,
          "--detail",
          "complete",
          "--json",
        ],
      });
      expect(response.exitCode, response.stderr).toBe(0);
      const report = modelArtifactSchema.parse(
        INSPECT_MODEL_ARTIFACT_CONTRACT.outputSchema.parse(response.json)
          .normalized_result,
      );
      expect(report.metadata.map(({ key, value }) => ({ key, value }))).toEqual(
        [
          { key: "general.architecture", value: architecture },
          { key: `${architecture}.context_length`, value: 4096 },
        ],
      );
      expect(report.artifact.sha256).toBeNull();
    }
  },
);

cliTest(
  "preserves unresolved Q8_1 layout through CLI, MCP summaries and retained tensor/type pages",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-model-q8-layout-");
    const call = await modelMcp.session.call();
    for (const blockBytes of [36, 40]) {
      const path = join(root, `blocks-${String(blockBytes)}.gguf`);
      const base = ggufFixture();
      // Released layouts share GGUF v3/type 9/quantization version 2.
      // Trailing alignment space is not a storage-layout declaration.
      const fixture = ggufFixture({
        metadata: [
          { key: "general.quantization_version", type: 4, value: base.u32(2) },
        ],
        tensors: [
          { name: "control", type: 0, shape: [4n], offset: 0n, bytes: 16 },
          {
            name: "weight",
            type: 9,
            shape: [320n],
            offset: 32n,
            bytes: 10 * blockBytes,
          },
        ],
      });
      const bytes = Buffer.concat([fixture.bytes, Buffer.alloc(16)]);
      await writeFile(path, bytes);
      const cliResult = await runFileCli(cli, {
        arguments: [
          "inspect-model-artifact",
          path,
          "--detail",
          "complete",
          "--hash",
          "full",
          "--json",
        ],
      });
      expect(cliResult.exitCode, cliResult.stderr).toBe(0);
      const report = modelArtifactSchema.parse(
        parseEvidence(cliResult.json).normalized_result,
      );
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      expect(report.artifact).toMatchObject({ path, sha256 });
      expect(report.tensors[0]).toMatchObject({
        byte_length: 16,
        storage_validation: "consistent",
      });
      const weight = {
        index: 1,
        name: "weight",
        type: "Q8_1",
        type_id: 9,
        shape: ["320"],
        file_offset: fixture.dataOffset + 32,
        byte_length: null,
        byte_length_state: "unknown",
        storage_validation: "unknown",
      };
      expect(report.tensors[1]).toMatchObject(weight);
      expect(report.totals).toMatchObject({
        parameter_count: "324",
        tensor_bytes: null,
        by_type: [
          { type: "F32", bytes: 16 },
          { type: "Q8_1", bytes: null },
        ],
      });
      const coverage = { storage_sizes: "partial", tensor_ranges: "partial" };
      expect(report.coverage).toMatchObject(coverage);
      const limitation = expect.stringContaining(
        "Q8_1 has released 40-byte and 36-byte layouts",
      );
      expect(report.limitations).toContainEqual(limitation);

      const response = await call("inspect_model_artifact", {
        path,
        hash: "full",
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const summary = modelArtifactSummaryViewResultSchema.parse(
        parseEvidence(response.structuredContent).normalized_result,
      );
      expect(summary.summary).toMatchObject({
        artifact: { path, sha256 },
        totals: { parameter_count: "324", tensor_bytes: null },
        coverage,
      });
      expect(summary.summary.limitations).toContainEqual(limitation);
      expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
      await unlink(path);

      const source = {
        kind: "retained-evidence",
        evidence_id: summary.parent_evidence_id,
      };
      const tensorResponse = await call("inspect_analysis_view", {
        source,
        view: {
          kind: "model-artifact",
          collection: "tensors",
          types: ["Q8_1"],
          storage_validation: ["unknown"],
          fields: Object.keys(weight).filter((field) => field !== "index"),
        },
      });
      expect(tensorResponse.isError, JSON.stringify(tensorResponse)).not.toBe(
        true,
      );
      const tensorView = analysisViewResultSchema.parse(
        parseEvidence(tensorResponse.structuredContent).normalized_result,
      );
      if (tensorView.kind !== "model-artifact")
        throw new Error("Incorrect tensor view");
      expect(tensorView.items).toEqual([weight]);
      expect(tensorView.source).toMatchObject({ path, sha256 });
      expect(tensorView.source_coverage).toMatchObject(coverage);
      expect(tensorView.limitations).toContainEqual(limitation);

      const typeResponse = await call("inspect_analysis_view", {
        source,
        view: {
          kind: "model-artifact",
          collection: "types",
          types: ["Q8_1"],
          fields: ["type", "parameter_count", "bytes"],
        },
      });
      expect(typeResponse.isError, JSON.stringify(typeResponse)).not.toBe(true);
      const typeView = analysisViewResultSchema.parse(
        parseEvidence(typeResponse.structuredContent).normalized_result,
      );
      if (typeView.kind !== "model-artifact")
        throw new Error("Incorrect type view");
      expect(typeView.items).toEqual([
        { index: 1, type: "Q8_1", parameter_count: "320", bytes: null },
      ]);
      expect(typeView.source_coverage).toMatchObject(coverage);
    }
  },
);

const assertRetainedLayoutViews = async (
  call: Awaited<ReturnType<typeof connectLocalToolsMcp>>["call"],
  parentEvidenceId: string,
  report: ModelArtifact,
  sha256: string,
): Promise<void> => {
  const { path } = report.artifact;
  const { header, tensor_ranges, storage_sizes } = report.coverage;
  const coverage = { header, tensor_ranges, storage_sizes };
  const source = {
    kind: "retained-evidence",
    evidence_id: parentEvidenceId,
  };
  const types = ["Q2_K", "AMBIGUOUS_16", "AMBIGUOUS_24", "AMBIGUOUS_25"];
  const tensorResponse = await call("inspect_analysis_view", {
    source,
    view: {
      kind: "model-artifact",
      collection: "tensors",
      types,
      storage_validation: ["unknown"],
      fields: [
        "type",
        "type_id",
        "shape",
        "file_offset",
        "byte_length",
        "storage_validation",
      ],
    },
  });
  expect(tensorResponse.isError, JSON.stringify(tensorResponse)).not.toBe(true);
  const tensorView = analysisViewResultSchema.parse(
    parseEvidence(tensorResponse.structuredContent).normalized_result,
  );
  if (tensorView.kind !== "model-artifact")
    throw new Error("Incorrect tensor view");
  expect(tensorView.items).toEqual(
    report.tensors
      .filter((tensor) => types.includes(tensor.type))
      .map(
        ({
          index,
          type,
          type_id,
          shape,
          file_offset,
          byte_length,
          storage_validation,
        }) => ({
          index,
          type,
          type_id,
          shape,
          file_offset,
          byte_length,
          storage_validation,
        }),
      ),
  );
  expect(tensorView.source).toMatchObject({ path, sha256 });
  expect(tensorView.source_coverage).toMatchObject(coverage);
  const typeResponse = await call("inspect_analysis_view", {
    source,
    view: {
      kind: "model-artifact",
      collection: "types",
      types,
      fields: ["type", "bytes"],
    },
  });
  expect(typeResponse.isError, JSON.stringify(typeResponse)).not.toBe(true);
  const typeView = analysisViewResultSchema.parse(
    parseEvidence(typeResponse.structuredContent).normalized_result,
  );
  if (typeView.kind !== "model-artifact")
    throw new Error("Incorrect type view");
  expect(typeView.items).toEqual(
    report.totals.by_type.flatMap((row, index) =>
      types.includes(row.type) ? [{ index, type: row.type, bytes: null }] : [],
    ),
  );
  expect(typeView.source_coverage).toMatchObject(coverage);
};

cliTest(
  "preserves released K and shifted integer/IQ uncertainty through CLI and retained MCP views",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-model-historical-layouts-");
    const call = await modelMcp.session.call();
    for (const layout of ["legacy", "modern"] as const) {
      const path = join(root, `${layout}.gguf`);
      const base = ggufFixture();
      // Authored bodies follow released source sizes; historical producers are
      // not executed. Both files carry the same version and global file type.
      const declarations = [
        { name: "control", type: 0, shape: [4n], bytes: 16, label: "F32" },
        {
          name: "stable-integer",
          type: 26,
          shape: [3n],
          bytes: 12,
          label: "I32",
        },
        ...ggufKLayouts.flatMap(({ id, name, bytes64, bytes256 }) =>
          (layout === "legacy" ? [64, 256] : [256]).map((elements) => ({
            name: `${name}-${String(elements)}`,
            type: id,
            shape: [BigInt(elements)],
            bytes: layout === "legacy" ? (elements / 64) * bytes64 : bytes256,
            label: name,
          })),
        ),
        ...ggufShiftedTypeLayouts.map(
          ({ id, integerBytes, modernBytes256 }) => ({
            name: `shifted-${String(id)}`,
            type: id,
            shape: [256n],
            bytes: layout === "legacy" ? 256 * integerBytes : modernBytes256,
            label: `AMBIGUOUS_${String(id)}`,
          }),
        ),
      ];
      let nextOffset = 0n;
      const tensors = declarations.map((declaration) => {
        const tensor = { ...declaration, offset: nextOffset };
        nextOffset += BigInt(Math.ceil(declaration.bytes / 32) * 32);
        return tensor;
      });
      const fixture = ggufFixture({
        metadata: [
          { key: "general.quantization_version", type: 4, value: base.u32(2) },
          { key: "general.file_type", type: 4, value: base.u32(15) },
        ],
        tensors,
      });
      await writeFile(path, fixture.bytes);
      const response = await runFileCli(cli, {
        arguments: [
          "inspect-model-artifact",
          path,
          "--detail",
          "complete",
          "--json",
        ],
      });
      expect(response.exitCode, response.stderr).toBe(0);
      const report = modelArtifactSchema.parse(
        parseEvidence(response.json).normalized_result,
      );
      expect(report.tensors.slice(0, 2)).toMatchObject([
        { type: "F32", byte_length: 16, storage_validation: "consistent" },
        {
          type: "I32",
          type_id: 26,
          byte_length: 12,
          storage_validation: "consistent",
        },
      ]);
      const unresolved = tensors.slice(2).map((tensor, index) => ({
        index: index + 2,
        type: tensor.label,
        type_id: tensor.type,
        shape: tensor.shape.map(String),
        file_offset: fixture.dataOffset + Number(tensor.offset),
        byte_length: null,
        storage_validation: "unknown",
      }));
      expect(report.tensors.slice(2)).toMatchObject(unresolved);
      const coverage = {
        header: "complete",
        tensor_ranges: "partial",
        storage_sizes: "partial",
      };
      expect(report.coverage).toMatchObject(coverage);
      expect(report.totals.tensor_bytes).toBeNull();
      for (const { id, modernName } of ggufShiftedTypeLayouts) {
        expect(report.limitations).toContainEqual(
          expect.stringMatching(
            new RegExp(`type ID ${String(id)} has released .*${modernName}`),
          ),
        );
      }

      const mcpResponse = await call("inspect_model_artifact", {
        path,
        hash: "full",
      });
      expect(mcpResponse.isError, JSON.stringify(mcpResponse)).not.toBe(true);
      const summary = modelArtifactSummaryViewResultSchema.parse(
        parseEvidence(mcpResponse.structuredContent).normalized_result,
      );
      const sha256 = createHash("sha256").update(fixture.bytes).digest("hex");
      expect(summary.summary).toMatchObject({
        artifact: { path, sha256 },
        totals: { tensor_bytes: null },
        coverage,
      });
      for (const limitation of report.limitations.filter(
        (reason) =>
          reason.includes("have released") || reason.includes("has released"),
      ))
        expect(summary.summary.limitations).toContain(limitation);
      expect(Buffer.compare(await readFile(path), fixture.bytes)).toBe(0);
      await unlink(path);
      await assertRetainedLayoutViews(
        call,
        summary.parent_evidence_id,
        report,
        sha256,
      );
    }
  },
);

cliTest(
  "preserves exact large safetensors dimensions while bounding actual offsets",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-model-shape-precision-");
    const path = join(root, "empty.safetensors");
    const fixture = safetensorsFixture(
      '{"a":{"dtype":"F32","shape":[0,9007199254740992],"data_offsets":[0,0]},"b":{"dtype":"F32","shape":[18446744073709551615,0],"data_offsets":[0,0]}}',
      Buffer.alloc(0),
    );
    await writeFile(path, fixture.bytes);
    const result = await cli.run({
      arguments: [
        "inspect-model-artifact",
        path,
        "--detail",
        "complete",
        "--hash",
        "full",
        "--json",
      ],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const report = modelArtifactSchema.parse(
      INSPECT_MODEL_ARTIFACT_CONTRACT.outputSchema.parse(result.json)
        .normalized_result,
    );
    expect(
      report.tensors.map(
        ({ shape, parameter_count, byte_length, storage_validation }) => ({
          shape,
          parameter_count,
          byte_length,
          storage_validation,
        }),
      ),
    ).toEqual([
      {
        shape: ["0", "9007199254740992"],
        parameter_count: "0",
        byte_length: 0,
        storage_validation: "consistent",
      },
      {
        shape: ["18446744073709551615", "0"],
        parameter_count: "0",
        byte_length: 0,
        storage_validation: "consistent",
      },
    ]);
    expect(report.totals).toMatchObject({
      parameter_count: "0",
      tensor_bytes: 0,
    });
    expect(report.artifact.sha256).toBe(
      createHash("sha256").update(fixture.bytes).digest("hex"),
    );
    const call = await modelMcp.session.call();
    const response = await call("inspect_model_artifact", {
      path,
      detail: "complete",
      hash: "full",
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(parseEvidence(response.structuredContent).normalized_result).toEqual(
      report,
    );

    await writeFile(
      path,
      safetensorsFixture(
        '{"x":{"dtype":"F32","shape":[0],"data_offsets":[9007199254740992,9007199254740992]}}',
        Buffer.alloc(0),
      ).bytes,
    );
    const offsetFailure = parseMcpToolError(
      await call("inspect_model_artifact", { path }),
    );
    expect(offsetFailure.error).toMatchObject({
      code: "resource_constraint",
      details: {
        reported_limits: { maximum_exact_offset: Number.MAX_SAFE_INTEGER },
      },
    });
  },
);

it.each(["named", "default", "inventory-only", "absent"] as const)(
  "reports actual chat-template presence in summaries and page context (%s)",
  async (kind) => {
    const root = await createTestTempDirectory("rea-model-templates-");
    const path = join(root, "model.gguf");
    const { text, u32, u64 } = ggufFixture();
    const names = {
      key: "tokenizer.chat_templates",
      type: 9,
      value: Buffer.concat([u32(8), u64(1n), text("tool_use")]),
    };
    const template = {
      key:
        kind === "default"
          ? "tokenizer.chat_template"
          : "tokenizer.chat_template.tool_use",
      type: 8,
      value: text("{{ messages }}"),
    };
    const metadata =
      kind === "named"
        ? [names, template]
        : kind === "default"
          ? [template]
          : kind === "inventory-only"
            ? [names]
            : [];
    await writeFile(path, ggufFixture({ metadata }).bytes);
    const call = await modelMcp.session.call();
    const response = await call("inspect_model_artifact", { path });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const summary = modelArtifactSummaryViewResultSchema.parse(
      parseEvidence(response.structuredContent).normalized_result,
    );
    const present = kind === "named" || kind === "default";
    expect(summary.summary.chat_template_present).toBe(present);
    const pageResponse = await call("inspect_analysis_view", {
      source: {
        kind: "retained-evidence",
        evidence_id: summary.parent_evidence_id,
      },
      view: {
        kind: "model-artifact",
        collection: "metadata",
        fields: ["key", "value"],
      },
    });
    expect(pageResponse.isError, JSON.stringify(pageResponse)).not.toBe(true);
    const page = analysisViewResultSchema.parse(
      parseEvidence(pageResponse.structuredContent).normalized_result,
    );
    if (page.kind !== "model-artifact") throw new Error("Incorrect model view");
    expect(page.model.chat_template_present).toBe(present);
    expect(
      page.items.map((row) => ("key" in row ? row.key : undefined)),
    ).toEqual(metadata.map((row) => row.key));
  },
);

it("keeps generated headline keys and imported compound metadata out of compact summaries", async () => {
  const root = await createTestTempDirectory("rea-model-headlines-");
  const path = join(root, "model");
  const architecture = "a".repeat(12000);
  const { text, u32 } = ggufFixture();
  await writeFile(
    path,
    ggufFixture({
      tensors: [],
      metadata: [
        { key: "general.architecture", type: 8, value: text(architecture) },
        { key: `${architecture}.context_length`, type: 4, value: u32(2048) },
      ],
    }).bytes,
  );
  const call = await modelMcp.session.call();
  const compact = await call("inspect_model_artifact", { path });
  expect(compact.isError, JSON.stringify(compact)).not.toBe(true);
  const summary = modelArtifactSummaryViewResultSchema.parse(
    parseEvidence(compact.structuredContent).normalized_result,
  );
  expect(summary.summary.headlines).toEqual([]);
  const full = parseEvidence(
    (await call("inspect_model_artifact", { path, detail: "complete" }))
      .structuredContent,
  );
  const report = modelArtifactSchema.parse(full.normalized_result);
  expect(report.metadata.map(({ key, value }) => ({ key, value }))).toEqual([
    { key: "general.architecture", value: architecture },
    { key: `${architecture}.context_length`, value: 2048 },
  ]);
  report.metadata[0]!.value = { future: architecture };
  const imported = createEvidence(undefined, full.provider, {
    operation: "inspect_model_artifact",
    parameters: full.parameters,
    result: report,
  });
  const page = await call("inspect_analysis_view", {
    source: { kind: "inline", evidence: imported },
    view: { kind: "summary" },
  });
  expect(page.isError, JSON.stringify(page)).not.toBe(true);
  const importedSummary = modelArtifactSummaryViewResultSchema.parse(
    parseEvidence(page.structuredContent).normalized_result,
  );
  expect(importedSummary.summary.headlines).toEqual([]);
});

it("rejects noncanonical imported model indexes and duplicate identities through public MCP", async () => {
  const root = await createTestTempDirectory("rea-model-import-");
  const path = join(root, "model");
  await writeFile(path, ggufFixture().bytes);
  const call = await modelMcp.session.call();
  const response = await call("inspect_model_artifact", {
    path,
    detail: "complete",
  });
  const complete = parseEvidence(response.structuredContent);
  const report = modelArtifactSchema.parse(complete.normalized_result);
  const corruptions: ((value: ModelArtifact) => void)[] = [
    (value) => {
      value.tensors[0]!.index = 7;
    },
    (value) => {
      value.metadata[0]!.index = 7;
    },
    (value) => {
      value.tensors[1]!.name = value.tensors[0]!.name;
    },
    (value) => {
      value.metadata[1]!.key = value.metadata[0]!.key;
    },
    (value) => {
      value.totals.by_type[1]!.type = value.totals.by_type[0]!.type;
    },
  ];
  for (const corrupt of corruptions) {
    const result = structuredClone(report);
    corrupt(result);
    const evidence = createEvidence(undefined, complete.provider, {
      operation: "inspect_model_artifact",
      parameters: complete.parameters,
      result,
    });
    const failure = parseMcpToolError(
      await call("inspect_analysis_view", {
        source: { kind: "inline", evidence },
        view: {
          kind: "model-artifact",
          collection: "tensors",
          names: ["weight"],
        },
      }),
    );
    expect(failure.error).toMatchObject({ code: "invalid_request" });
  }
  await assertHistoricalModelPages(call, complete.evidence_id, report);
});

it("bounds compact model warnings and omits unselected long labels while retaining complete Evidence", async () => {
  const root = await createTestTempDirectory("rea-model-long-labels-");
  const path = join(root, "model");
  const name = "tensor".repeat(4000);
  const type = "FUTURE".repeat(4000);
  const key = "metadata".repeat(3000);
  await writeFile(
    path,
    safetensorsFixture(
      JSON.stringify({
        __metadata__: { [key]: "kept" },
        [name]: { dtype: type, shape: [0], data_offsets: [0, 0] },
      }),
      Buffer.alloc(0),
    ).bytes,
  );
  const call = await modelMcp.session.call();
  const response = await call("inspect_model_artifact", { path });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  expect(JSON.stringify(response).length).toBeLessThan(16_000);
  const summary = modelArtifactSummaryViewResultSchema.parse(
    parseEvidence(response.structuredContent).normalized_result,
  );
  expect(summary.summary.coverage.storage_sizes).toBe("partial");
  expect(summary.summary.limitations.join(" ")).toContain(
    summary.parent_evidence_id,
  );
  const source = {
    kind: "retained-evidence",
    evidence_id: summary.parent_evidence_id,
  };
  for (const collection of ["tensors", "metadata", "types"] as const) {
    const page = await call("inspect_analysis_view", {
      source,
      view: { kind: "model-artifact", collection, fields: [], limit: 1 },
    });
    expect(page.isError, JSON.stringify(page)).not.toBe(true);
    expect(JSON.stringify(page).length).toBeLessThan(16_000);
    const view = analysisViewResultSchema.parse(
      parseEvidence(page.structuredContent).normalized_result,
    );
    if (view.kind !== "model-artifact") throw new Error("Incorrect view");
    expect(view.items).toEqual([{ index: 0 }]);
    expect(view.source_coverage.storage_sizes).toBe("partial");
    expect(view.limitations.join(" ")).toContain(summary.parent_evidence_id);
  }
  const full = await call("inspect_model_artifact", {
    path,
    detail: "complete",
  });
  expect(full.isError, JSON.stringify(full)).not.toBe(true);
  const report = modelArtifactSchema.parse(
    parseEvidence(full.structuredContent).normalized_result,
  );
  expect(report.tensors[0]).toMatchObject({ name, type });
  expect(report.metadata[0]).toMatchObject({ key, value: "kept" });
  expect(report.limitations.join(" ")).toContain(type);
});

const assertHistoricalModelPages = async (
  call: Awaited<ReturnType<typeof connectLocalToolsMcp>>["call"],
  parentEvidenceId: string,
  report: ModelArtifact,
): Promise<void> => {
  const pages = [];
  for (let offset = 0; offset < report.tensors.length; offset++) {
    const page = await call("inspect_analysis_view", {
      source: {
        kind: "retained-evidence",
        evidence_id: parentEvidenceId,
      },
      view: {
        kind: "model-artifact",
        collection: "tensors",
        offset,
        limit: 1,
        fields: ["name", "type", "shape", "file_offset"],
      },
    });
    expect(page.isError, JSON.stringify(page)).not.toBe(true);
    const selected = analysisViewResultSchema.parse(
      parseEvidence(page.structuredContent).normalized_result,
    );
    if (selected.kind !== "model-artifact") throw new Error("Incorrect view");
    expect(selected.source.header_sha256).toBe(report.artifact.header_sha256);
    expect(selected.source.sha256).toBeNull();
    pages.push(...selected.items);
  }
  expect(pages).toEqual(
    report.tensors.map(({ index, name, type, shape, file_offset }) => ({
      index,
      name,
      type,
      shape,
      file_offset,
    })),
  );
  const selected = await call("inspect_analysis_view", {
    source: {
      kind: "retained-evidence",
      evidence_id: parentEvidenceId,
    },
    view: {
      kind: "model-artifact",
      collection: "tensors",
      names: ["weight", "absent"],
      indices: [0, 1],
      fields: [],
    },
  });
  const selectedView = analysisViewResultSchema.parse(
    parseEvidence(selected.structuredContent).normalized_result,
  );
  if (selectedView.kind !== "model-artifact") throw new Error("Incorrect view");
  expect(selectedView.items).toEqual(
    report.tensors
      .filter((row) => row.name === "weight")
      .map(({ index }) => ({ index })),
  );
  const empty = await call("inspect_analysis_view", {
    source: {
      kind: "retained-evidence",
      evidence_id: parentEvidenceId,
    },
    view: {
      kind: "model-artifact",
      collection: "metadata",
      keys: [],
      offset: 100,
    },
  });
  expect(empty.isError, JSON.stringify(empty)).not.toBe(true);
  const emptyView = analysisViewResultSchema.parse(
    parseEvidence(empty.structuredContent).normalized_result,
  );
  expect(emptyView.coverage).toMatchObject({ total: 0, exhausted: true });
  const unverified = await call("inspect_analysis_view", {
    source: {
      kind: "retained-evidence",
      evidence_id: parentEvidenceId,
    },
    view: {
      kind: "model-artifact",
      collection: "tensors",
      storage_validation: ["unknown"],
      fields: ["name", "storage_validation", "byte_length"],
    },
  });
  expect(unverified.isError, JSON.stringify(unverified)).not.toBe(true);
  const unverifiedView = analysisViewResultSchema.parse(
    parseEvidence(unverified.structuredContent).normalized_result,
  );
  if (unverifiedView.kind !== "model-artifact")
    throw new Error("Incorrect storage selection");
  expect(unverifiedView.items).toEqual(
    report.tensors
      .filter((row) => row.storage_validation === "unknown")
      .map(({ index, name, storage_validation, byte_length }) => ({
        index,
        name,
        storage_validation,
        byte_length,
      })),
  );
  const histogram = await call("inspect_analysis_view", {
    source: {
      kind: "retained-evidence",
      evidence_id: parentEvidenceId,
    },
    view: {
      kind: "model-artifact",
      collection: "types",
      types: ["F32"],
      fields: ["type", "tensors", "parameter_count", "bytes"],
    },
  });
  expect(histogram.isError, JSON.stringify(histogram)).not.toBe(true);
  const histogramView = analysisViewResultSchema.parse(
    parseEvidence(histogram.structuredContent).normalized_result,
  );
  if (histogramView.kind !== "model-artifact")
    throw new Error("Incorrect histogram view");
  expect(histogramView.items).toEqual(
    report.totals.by_type.flatMap((row, index) =>
      row.type === "F32" ? [{ index, ...row }] : [],
    ),
  );
};

cliTest(
  "shares scoped model facts through real CLI/MCP and pages retained metadata after source removal",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-model-cli-");
    const call = await modelMcp.session.call();
    for (const [format, fixture] of [
      ["gguf", ggufFixture()],
      ["safetensors", safetensorsFixture()],
      [
        "safetensors",
        safetensorsFixture(
          '{"future":{"dtype":"FUTURE4","shape":[2],"data_offsets":[0,4]}}',
          Buffer.alloc(4),
        ),
      ],
    ] as const) {
      const path = join(root, `${format}.arbitrary`);
      await writeFile(path, fixture.bytes);
      const result = await cli.run({
        arguments: [
          "inspect-model-artifact",
          path,
          "--detail",
          "complete",
          "--json",
        ],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = INSPECT_MODEL_ARTIFACT_CONTRACT.outputSchema.parse(
        result.json,
      );
      const report = modelArtifactSchema.parse(evidence.normalized_result);
      expect(report.format).toBe(format);
      expect(report.artifact.sha256).toBeNull();
      expect(evidence.subject).toBeNull();
      const complete = await call("inspect_model_artifact", {
        path,
        detail: "complete",
      });
      expect(complete.isError, JSON.stringify(complete)).not.toBe(true);
      expect(
        parseEvidence(complete.structuredContent).normalized_result,
      ).toEqual(report);
      const hashed = await call("inspect_model_artifact", {
        path,
        detail: "complete",
        hash: "full",
      });
      expect(hashed.isError, JSON.stringify(hashed)).not.toBe(true);
      expect(
        parseEvidence(hashed.structuredContent).subject?.digest.sha256,
      ).toBe(createHash("sha256").update(fixture.bytes).digest("hex"));
      const summary = await call("inspect_model_artifact", { path });
      expect(summary.isError, JSON.stringify(summary)).not.toBe(true);
      const retained = modelArtifactSummaryViewResultSchema.parse(
        parseEvidence(summary.structuredContent).normalized_result,
      );
      expect(retained.summary.counts.tensors).toBe(report.tensors.length);
      const direct = await call("inspect_model_artifact", {
        path,
        view: {
          collection: "tensors",
          names: ["weight"],
          fields: ["name", "type", "shape", "file_offset"],
        },
      });
      expect(direct.isError, JSON.stringify(direct)).not.toBe(true);
      const directView = analysisViewResultSchema.parse(
        parseEvidence(direct.structuredContent).normalized_result,
      );
      if (directView.kind !== "model-artifact")
        throw new Error("Incorrect direct selection");
      expect(directView.model.counts.tensors).toBe(report.tensors.length);
      expect(directView.items).toEqual(
        report.tensors
          .filter((row) => row.name === "weight")
          .map(({ index, name, type, shape, file_offset }) => ({
            index,
            name,
            type,
            shape,
            file_offset,
          })),
      );
      expect(directView.parent_evidence_id).toBe(
        parseEvidence(complete.structuredContent).evidence_id,
      );
      await unlink(path);
      await assertHistoricalModelPages(
        call,
        retained.parent_evidence_id,
        report,
      );
    }
  },
);

cliTest(
  "preserves optional safetensors fields and aligns empty GGUF data in CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-model-boundary-compat-");
    const call = await modelMcp.session.call();
    const safetensors = safetensorsFixture(
      '{"__metadata__":null,"weight":{"dtype":"F32","shape":[1],"data_offsets":[0,4],"note":{"source":"local","flags":[null,false,-1,1.25]}}}',
      Buffer.alloc(4),
    );
    const emptyGgufHeader = ggufFixture({ tensors: [], metadata: [] });
    const alignedOffset = Math.ceil(emptyGgufHeader.header.length / 32) * 32;
    const emptyGguf = Buffer.concat([
      emptyGgufHeader.header,
      Buffer.alloc(alignedOffset - emptyGgufHeader.header.length),
    ]);
    for (const [name, bytes] of [
      ["optional.safetensors", safetensors.bytes],
      ["empty.gguf", emptyGguf],
    ] as const) {
      const path = join(root, name);
      await writeFile(path, bytes);
      const result = await runFileCli(cli, {
        arguments: [
          "inspect-model-artifact",
          path,
          "--detail",
          "complete",
          "--json",
        ],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const report = modelArtifactSchema.parse(
        INSPECT_MODEL_ARTIFACT_CONTRACT.outputSchema.parse(result.json)
          .normalized_result,
      );
      if (name.endsWith("safetensors")) {
        expect(report.metadata).toEqual([]);
        expect(report.tensors[0]?.name).toBe("weight");
        expect(report.artifact.header_sha256).toBe(
          createHash("sha256").update(safetensors.header).digest("hex"),
        );
      } else {
        expect(report.tensors).toEqual([]);
        expect(report.tensor_data_offset).toBe(alignedOffset);
        expect(report.artifact.header_length).toBe(
          emptyGgufHeader.header.length,
        );
        expect(report.artifact.header_sha256).toBe(
          createHash("sha256").update(emptyGgufHeader.header).digest("hex"),
        );
      }
      const response = await call("inspect_model_artifact", {
        path,
        detail: "complete",
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expect(
        parseEvidence(response.structuredContent).normalized_result,
      ).toEqual(report);
    }

    const mapPath = join(root, "same-key-map.safetensors");
    await writeFile(
      mapPath,
      safetensorsFixture(
        '{"__metadata__":{"json_number":"1.25"}}',
        Buffer.alloc(0),
      ).bytes,
    );
    const mapCli = await runFileCli(cli, {
      arguments: [
        "inspect-model-artifact",
        mapPath,
        "--detail",
        "complete",
        "--json",
      ],
    });
    expect(mapCli.exitCode, mapCli.stderr).toBe(0);
    const mapReport = modelArtifactSchema.parse(
      INSPECT_MODEL_ARTIFACT_CONTRACT.outputSchema.parse(mapCli.json)
        .normalized_result,
    );
    expect(
      mapReport.metadata.map(({ key, value }) => ({ key, value })),
    ).toEqual([{ key: "json_number", value: "1.25" }]);
    const mapMcp = await call("inspect_model_artifact", {
      path: mapPath,
      detail: "complete",
    });
    expect(mapMcp.isError, JSON.stringify(mapMcp)).not.toBe(true);
    expect(parseEvidence(mapMcp.structuredContent).normalized_result).toEqual(
      mapReport,
    );

    for (const [name, numeric] of [
      ["decimal", "1.25"],
      ["negative", "-1"],
      ["overflow", "18446744073709551616"],
    ] as const) {
      const malformedPath = join(root, `${name}-metadata.safetensors`);
      await writeFile(
        malformedPath,
        safetensorsFixture(`{"__metadata__":${numeric}}`, Buffer.alloc(0))
          .bytes,
      );
      const malformedCli = await runFileCli(cli, {
        arguments: ["inspect-model-artifact", malformedPath, "--json"],
      });
      expect(malformedCli.exitCode).toBe(1);
      expect(malformedCli.json).toMatchObject({
        code: "target_unavailable",
        category: "unsupported_target",
        details: { constraint: "file_format_rejected" },
      });
      const malformedMcp = parseMcpToolError(
        await call("inspect_model_artifact", { path: malformedPath }),
      );
      expect(malformedMcp.error).toMatchObject({
        code: "target_unavailable",
        category: "unsupported_target",
        details: { constraint: "file_format_rejected" },
      });
    }
  },
);

cliTest(
  "inspects unpadded zero-tensor vocab GGUF through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-model-vocab-only-");
    const call = await modelMcp.session.call();
    const base = ggufFixture();
    const vocab = ggufFixture({
      tensors: [],
      metadata: [
        { key: "general.type", type: 8, value: base.text("vocab") },
        {
          key: "tokenizer.ggml.model",
          type: 8,
          value: base.text("gpt2"),
        },
      ],
    });
    expect(vocab.header.length).toBe(105);
    expect(vocab.bytes.length).toBe(128);
    const padded = Buffer.concat([
      vocab.header,
      Buffer.alloc(vocab.bytes.length - vocab.header.length),
    ]);
    const files = [
      ["vocab-unpadded.gguf", vocab.header, vocab.header.length],
      ["vocab-padded.gguf", padded, vocab.bytes.length],
    ] as const;

    for (const [name, bytes, expectedOffset] of files) {
      const path = join(root, name);
      await writeFile(path, bytes);
      const cliResult = await cli.run({
        arguments: [
          "inspect-model-artifact",
          path,
          "--detail",
          "complete",
          "--hash",
          "full",
          "--json",
        ],
      });
      expect(cliResult.exitCode, cliResult.stderr).toBe(0);
      const report = modelArtifactSchema.parse(
        INSPECT_MODEL_ARTIFACT_CONTRACT.outputSchema.parse(cliResult.json)
          .normalized_result,
      );
      expect(report.metadata.map(({ key, value }) => ({ key, value }))).toEqual(
        [
          { key: "general.type", value: "vocab" },
          { key: "tokenizer.ggml.model", value: "gpt2" },
        ],
      );
      expect(report.tensors).toEqual([]);
      expect(report.tensor_data_offset).toBe(expectedOffset);
      expect(report.artifact.header_length).toBe(vocab.header.length);
      expect(report.artifact.header_sha256).toBe(
        createHash("sha256").update(vocab.header).digest("hex"),
      );
      expect(report.artifact.sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      const mcpResult = await call("inspect_model_artifact", {
        path,
        detail: "complete",
        hash: "full",
      });
      expect(mcpResult.isError, JSON.stringify(mcpResult)).not.toBe(true);
      expect(
        parseEvidence(mcpResult.structuredContent).normalized_result,
      ).toEqual(report);
    }

    const malformed = [
      ["partial-padding.gguf", Buffer.concat([vocab.header, Buffer.alloc(1)])],
      [
        "truncated-tensor.gguf",
        ggufFixture({
          metadata: [],
          tensors: [
            { name: "weight", type: 0, shape: [4n], offset: 0n, bytes: 16 },
          ],
        }).header,
      ],
    ] as const;
    for (const [name, bytes] of malformed) {
      const path = join(root, name);
      await writeFile(path, bytes);
      const cliResult = await cli.run({
        arguments: ["inspect-model-artifact", path, "--json"],
      });
      expect(cliResult.exitCode).toBe(1);
      expect(cliResult.json).toMatchObject({
        code: "target_unavailable",
        category: "unsupported_target",
        details: { constraint: "file_format_rejected" },
      });
      const mcpResult = parseMcpToolError(
        await call("inspect_model_artifact", { path }),
      );
      expect(mcpResult.error).toMatchObject({
        code: "target_unavailable",
        category: "unsupported_target",
        details: { constraint: "file_format_rejected" },
      });
    }
  },
);

cliTest(
  "exports complete model Evidence for portable paging and returns typed malformed errors",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-model-export-");
    const path = join(root, "model");
    const output = join(root, "evidence.json");
    await writeFile(path, ggufFixture().bytes);
    const result = await cli.run({
      arguments: [
        "inspect-model-artifact",
        path,
        "--detail",
        "summary",
        "--view",
        JSON.stringify({
          collection: "metadata",
          keys: ["tokenizer.chat_template"],
          fields: ["key", "value"],
        }),
        "--evidence_output",
        output,
        "--json",
      ],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const receipt = result.json as { summary: unknown };
    const delivered = analysisViewResultSchema.parse(
      parseEvidence(receipt.summary).normalized_result,
    );
    if (delivered.kind !== "model-artifact")
      throw new Error("Missing CLI direct selection");
    expect(delivered.items).toEqual([
      { index: 5, key: "tokenizer.chat_template", value: "{{ messages }}" },
    ]);
    const exported = await readEvidenceBundle(output);
    if (!exported.ok) throw exported.error;
    const complete = exported.value.records.find(
      (evidence) => evidence.operation === "inspect_model_artifact",
    );
    if (complete === undefined)
      throw new Error("Missing complete exported model Evidence");
    const recordPath = join(root, "model-record.json");
    await writeFile(recordPath, JSON.stringify(complete));
    const { call } = await connectLocalToolsMcp();
    await unlink(path);
    const page = await call("inspect_analysis_view", {
      source: { kind: "evidence-file", path: recordPath },
      view: {
        kind: "model-artifact",
        collection: "metadata",
        keys: ["tokenizer.chat_template", "custom.exact"],
        fields: ["key", "type", "value", "source_offset", "source_length"],
      },
    });
    expect(page.isError, JSON.stringify(page)).not.toBe(true);
    const selected = analysisViewResultSchema.parse(
      parseEvidence(page.structuredContent).normalized_result,
    );
    if (selected.kind !== "model-artifact") throw new Error("Incorrect view");
    expect(selected.items.map((row) => ("key" in row ? row.key : ""))).toEqual([
      "custom.exact",
      "tokenizer.chat_template",
    ]);
    await writeFile(
      path,
      safetensorsFixture(
        '{"x":{"dtype":"F32","shape":[3],"data_offsets":[4,16]}}',
      ).bytes,
    );
    const malformed = parseMcpToolError(
      await call("inspect_model_artifact", { path }),
    );
    expect(malformed.error).toMatchObject({
      code: "target_unavailable",
      category: "unsupported_target",
      details: { constraint: "file_format_rejected" },
    });
  },
);

cliTest(
  "rejects malformed model view JSON before opening the selected path",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-model-view-json-");
    const missing = join(root, "not-created.gguf");
    const result = await cli.run({
      arguments: ["inspect-model-artifact", missing, "--view", "{", "--json"],
    });

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "inspect_model_artifact",
        issues: [
          {
            path: ["view"],
            reason: "invalid_format",
            message: "view must be a JSON model page selection",
          },
        ],
      },
    });
    expect(JSON.stringify(result.json)).not.toContain("ENOENT");
  },
);
