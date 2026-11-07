import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { parseEvidence, createEvidence } from "../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../src/domain/evidenceBundle.js";
import { rustBinarySchema } from "../../src/domain/rust/rustBinary.js";
import { analysisViewResultSchema } from "../../src/domain/analysisView/analysisView.js";
import { readEvidenceBundle } from "../../src/application/EvidenceBundleFiles.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import {
  createRustImage,
  rustDependencyPayload,
} from "../fixtures/rust/image.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

/** Both authenticated retention and portable imports query the same captured facts. */
const assertRetainedPages = async (
  call: Awaited<ReturnType<typeof connectLocalToolsMcp>>["call"],
  evidenceId: string,
  exported: string,
) => {
  for (const [filter, expected] of [
    [
      { names: ["same"], versions: ["2"], fields: ["name", "version"] },
      [{ index: 1, name: "same", version: "2" }],
    ],
    [{ names: ["same"], indices: [0], fields: [] }, [{ index: 0 }]],
    [{ names: ["same"], versions: [], fields: [] }, []],
  ] as const) {
    const reply = await call("inspect_analysis_view", {
      source: { kind: "retained-evidence", evidence_id: evidenceId },
      view: { kind: "rust", collection: "packages", ...filter },
    });
    expect(reply.isError).not.toBe(true);
    expect(
      parseEvidence(reply.structuredContent).normalized_result,
    ).toMatchObject({ page: { rows: expected } });
  }

  for (const source of [
    { kind: "retained-evidence", evidence_id: evidenceId },
    { kind: "evidence-file", path: exported },
  ]) {
    const reply = await call("inspect_analysis_view", {
      source,
      view: {
        kind: "rust",
        collection: "packages",
        names: ["same"],
        indices: [0, 1, 99],
        offset: 1,
        limit: 1,
        fields: [],
      },
    });
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    expect(
      parseEvidence(reply.structuredContent).normalized_result,
    ).toMatchObject({
      parent_evidence_id: evidenceId,
      page: { rows: [{ index: 1 }] },
      coverage: {
        total: 2,
        examined: 1,
        exhausted: true,
        next_offset: null,
      },
    });
    const edgeReply = await call("inspect_analysis_view", {
      source,
      view: {
        kind: "rust",
        collection: "edges",
        from_indices: [1, 3],
        to_indices: [0],
        fields: ["from_index", "to_index"],
      },
    });
    expect(edgeReply.isError).not.toBe(true);
    expect(
      parseEvidence(edgeReply.structuredContent).normalized_result,
    ).toMatchObject({
      page: {
        collection: "edges",
        rows: [
          { index: 1, from_index: 1, to_index: 0 },
          { index: 3, from_index: 3, to_index: 0 },
        ],
      },
    });
    const empty = await call("inspect_analysis_view", {
      source,
      view: {
        kind: "rust",
        collection: "packages",
        names: [],
        versions: ["1"],
        fields: ["name"],
      },
    });
    expect(
      parseEvidence(empty.structuredContent).normalized_result,
    ).toMatchObject({
      page: { rows: [] },
      coverage: { total: 0, exhausted: true },
    });
  }
};

cliTest(
  "queries stable Rust packages and edges through real CLI/MCP and portable Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-views-");
    const { call } = await connectLocalToolsMcp();
    for (const format of ["elf", "pe", "macho"] as const) {
      const path = join(root, `source.${format}`);
      const output = join(root, `${format}-source.json`);
      const payload = rustDependencyPayload({
        packages: [
          {
            name: "same",
            version: "1",
            source: "crates.io",
            dependencies: [2],
            features: ["default"],
          },
          {
            name: "same",
            version: "2",
            source: "git+https://upstream.example/repo",
            dependencies: [0, 2],
          },
          { name: "leaf", version: "1", source: "local" },
          {
            name: "app",
            version: "1",
            source: "local",
            dependencies: [0, 1],
            root: true,
          },
        ],
      });
      await writeFile(path, createRustImage({ format, payload }));
      const fullReply = await call("inspect_rust_binary", { path });
      expect(fullReply.isError).not.toBe(true);
      const full = parseEvidence(fullReply.structuredContent);
      const report = rustBinarySchema.parse(full.normalized_result);
      const explicit = await call("inspect_rust_binary", {
        path,
        detail: "complete",
      });
      expect(parseEvidence(explicit.structuredContent)).toEqual(full);
      const selection = {
        collection: "packages",
        names: ["same"],
        fields: ["name", "version", "dependencies", "features"],
      };
      const direct = await call("inspect_rust_binary", {
        path,
        view: selection,
      });
      expect(direct.isError, JSON.stringify(direct)).not.toBe(true);
      const selected = parseEvidence(
        direct.structuredContent,
      ).normalized_result;
      expect(selected).toMatchObject({
        kind: "rust",
        parent_evidence_id: full.evidence_id,
        page: {
          collection: "packages",
          rows: [
            {
              index: 0,
              name: "same",
              version: "1",
              dependencies: [2],
              features: ["default"],
            },
            { index: 1, name: "same", version: "2", dependencies: [0, 2] },
          ],
        },
      });
      const summary = await call("inspect_rust_binary", {
        path,
        detail: "summary",
      });
      expect(summary.isError).not.toBe(true);
      expect(
        parseEvidence(summary.structuredContent).normalized_result,
      ).toMatchObject({
        kind: "summary",
        summary: {
          auditable_metadata: {
            counts: { packages: 4, edges: 5 },
            format_version: null,
          },
        },
        source_coverage: {
          embedded_records: "complete",
          runtime_dependencies: "unknown",
        },
      });
      const delivered = await cli.run({
        arguments: [
          "inspect-rust-binary",
          path,
          "--view",
          JSON.stringify(selection),
          "--evidence_output",
          output,
          "--json",
        ],
      });
      expect(delivered.exitCode, delivered.stderr).toBe(0);
      expect(delivered.json).toMatchObject({
        summary: { normalized_result: selected },
      });
      const bundle = await readEvidenceBundle(output);
      if (!bundle.ok) throw bundle.error;
      expect(
        bundle.value.records.find(
          (row) => row.evidence_id === full.evidence_id,
        ),
      ).toEqual({ ...full, caller_input_path: path });
      const exported = join(root, `${format}-record.json`);
      await writeFile(exported, JSON.stringify(full));
      await unlink(path);

      await assertRetainedPages(call, full.evidence_id, exported);
      const malformed = structuredClone(report);
      malformed.auditable_metadata!.dependency_edges[0]!.to_index = 999;
      if (full.subject == null)
        throw new Error("Missing complete Rust subject");
      const invalid = createEvidence(
        {
          path,
          sha256: report.artifact.sha256,
          format: format === "macho" ? "mach-o" : format,
          ...(full.subject.architecture === null
            ? {}
            : { architecture: full.subject.architecture }),
        },
        full.provider,
        {
          operation: full.operation,
          parameters: full.parameters,
          result: malformed,
        },
      );
      expect(
        parseMcpToolError(
          await call("inspect_analysis_view", {
            source: { kind: "inline", evidence: invalid },
            view: { kind: "rust", collection: "edges" },
          }),
        ).error,
      ).toMatchObject({ code: "invalid_request" });
    }
  },
  60000,
);

cliTest(
  "queries historical feature omissions from authenticated bundles without changing the parent",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-historical-features-");
    const path = join(root, "source.elf");
    await writeFile(
      path,
      createRustImage({
        format: "elf",
        payload: rustDependencyPayload({
          packages: [{ name: "old", version: "1", source: "local" }],
        }),
      }),
    );
    const { call } = await connectLocalToolsMcp();
    const captured = await call("inspect_rust_binary", { path });
    expect(captured.isError, JSON.stringify(captured.content)).not.toBe(true);
    const full = parseEvidence(captured.structuredContent);
    const report = rustBinarySchema.parse(full.normalized_result);
    const metadata = report.auditable_metadata;
    if (metadata === null) throw new Error("Expected Rust dependency metadata");
    if (full.subject == null)
      throw new Error("Expected Rust artifact identity");
    const historical = createEvidence(
      {
        path,
        sha256: report.artifact.sha256,
        format: "elf",
        ...(full.subject.architecture === null
          ? {}
          : { architecture: full.subject.architecture }),
      },
      full.provider,
      {
        operation: full.operation,
        parameters: full.parameters,
        result: {
          ...report,
          auditable_metadata: {
            ...metadata,
            packages: metadata.packages.map(
              ({ features: _features, ...row }) => row,
            ),
          },
        },
      },
    );
    const bundle = join(root, "historical-bundle.json");
    const record = join(root, "historical-record.json");
    await writeFile(bundle, JSON.stringify(createEvidenceBundle([historical])));
    await writeFile(record, JSON.stringify(historical));
    await unlink(path);
    const view = { kind: "rust", collection: "packages", fields: ["features"] };
    for (const source of [
      { kind: "retained-evidence", evidence_id: historical.evidence_id },
      { kind: "evidence-file", path: record },
    ]) {
      const reply = await cli.run({
        arguments: [
          "inspect-analysis-view",
          JSON.stringify({ source, view }),
          ...(source.kind === "retained-evidence"
            ? ["--evidence-bundle", bundle]
            : []),
          "--json",
        ],
      });
      expect(reply.exitCode, reply.stderr + JSON.stringify(reply.json)).toBe(0);
      expect(parseEvidence(reply.json).normalized_result).toMatchObject({
        parent_evidence_id: historical.evidence_id,
        page: { rows: [{ index: 0, features: null }] },
      });
    }
    const imported = await call("import_evidence_bundle", { path: bundle });
    expect(imported.isError, JSON.stringify(imported.content)).not.toBe(true);
    for (const fields of [["features"], [], ["features"]]) {
      const reply = await call("inspect_analysis_view", {
        source: {
          kind: "retained-evidence",
          evidence_id: historical.evidence_id,
        },
        view: { ...view, fields },
      });
      expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
      expect(
        parseEvidence(reply.structuredContent).normalized_result,
      ).toMatchObject({
        parent_evidence_id: historical.evidence_id,
        page: {
          rows: [
            fields.length === 0 ? { index: 0 } : { index: 0, features: null },
          ],
        },
      });
    }
    expect(JSON.parse(await readFile(record, "utf8"))).toEqual(historical);
  },
);

cliTest(
  "preserves unknown Rust metadata and refuses invalid compact CLI choices before reading",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-view-missing-");
    const path = join(root, "plain.elf");
    await writeFile(
      path,
      createRustImage({ format: "elf", omitSection: true }),
    );
    const { call } = await connectLocalToolsMcp();
    const summary = await call("inspect_rust_binary", {
      path,
      detail: "summary",
    });
    expect(summary.isError).not.toBe(true);
    const view = analysisViewResultSchema.parse(
      parseEvidence(summary.structuredContent).normalized_result,
    );
    expect(view).toMatchObject({
      summary: { auditable_metadata: null },
      source_coverage: {
        embedded_records: "unknown",
        runtime_dependencies: "unknown",
      },
    });
    const missing = join(root, "never-created");
    for (const args of [
      ["--detail", "summary"],
      ["--view", "{"],
      ["--detail", "complete", "--view", '{"collection":"packages"}'],
    ]) {
      const refused = await cli.run({
        arguments: ["inspect-rust-binary", missing, ...args, "--json"],
      });
      expect(refused.exitCode).toBe(1);
      expect(refused.json).toMatchObject({ code: "invalid_request" });
      expect(JSON.stringify(refused.json)).not.toContain("ENOENT");
    }
    expect((await readFile(path)).length).toBeGreaterThan(0);
  },
  30000,
);
