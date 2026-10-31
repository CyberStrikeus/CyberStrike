import {
  apiSurfaceHar,
  environmentManifestHar,
} from "../../fixtures/historicalHar.js";
import { inspectAnalysisView } from "../../../src/application/analysisView/AnalysisViewService.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  analysisCliErrorEnvelopeSchema,
  analysisErrorProjectionSchema,
} from "../../../src/contracts/errorSchemas.js";

import { expect } from "vitest";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

import {
  analysisViewLayoutEvidence,
  analysisViewCaptureFixture,
  analysisViewCaptureEvidence,
  analysisViewObjectDenseCapture,
  analysisViewJavaScriptEvidence,
  analysisViewJavaScriptAnalysisWithSource,
  analysisViewNativeEvidence,
  environmentManifestCaptureFixture,
  environmentStateCaptureFixture,
} from "../../fixtures/analysisView.js";
import { binaryLayoutFixture } from "../../fixtures/binaryDiagnostics/layout.js";
import { evmInterfaceFixture } from "../../fixtures/evm/interface.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { z } from "zod";
import { ghidraFunctionDossier } from "../../../src/domain/ghidraValues.fixture.js";
import {
  createEvidenceBundle,
  parseEvidenceBundle,
} from "../../../src/domain/evidenceBundle.js";
import { inspectEvidenceBundle } from "../../../src/application/investigation/InspectEvidenceBundle.js";

cliTest(
  "authenticates an exact portable parent for non-managed views and rejects ambiguous or altered sources",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-analysis-bundle-cli-");
    const path = join(root, "bundle.json");
    const parent = analysisViewLayoutEvidence();
    const view = {
      kind: "item",
      collection: "sections",
      selector: { name: ".data" },
    };
    const request = {
      source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
      view,
    };
    const bundle = createEvidenceBundle([
      analysisViewJavaScriptEvidence(),
      parent,
    ]);
    const original = JSON.stringify(bundle);
    await writeFile(path, original);
    const result = await cli.run({
      arguments: [
        "inspect-analysis-view",
        JSON.stringify(request),
        "--evidence-bundle",
        path,
        "--json",
      ],
    });
    expect(result.exitCode).toBe(0);
    const expected = await inspectAnalysisView({
      source: { kind: "inline", evidence: parent },
      view,
    });
    if (!expected.ok) throw expected.error;
    const evidence = parseEvidence(result.json);
    expect(evidence.evidence_id).toBe(expected.value.evidence_id);
    expect(evidence.normalized_result).toEqual(
      expected.value.normalized_result,
    );
    expect(evidence.evidence_links).toEqual([parent.evidence_id]);
    expect(await readFile(path, "utf8")).toBe(original);

    for (const [source, expectedCode] of [
      [{ kind: "inline", evidence: parent }, "invalid_request"],
      [
        { kind: "retained-evidence", evidence_id: `ev_${"f".repeat(64)}` },
        "evidence_integrity_mismatch",
      ],
    ] as const) {
      const invocation = {
        arguments: [
          "inspect-analysis-view",
          JSON.stringify({ source, view }),
          "--evidence-bundle",
          path,
          "--json",
        ],
      };
      const rejected =
        source.kind === "inline"
          ? await cli.run(invocation)
          : await runFileCli(cli, invocation);
      expect(rejected.exitCode).toBe(1);
      expect(rejected.json).toMatchObject({ code: expectedCode });
      expect(rejected.json).not.toHaveProperty("evidence_id");
    }
    for (const [contents, expectedCode, freshProcess] of [
      [JSON.stringify(parent), "invalid_request", false],
      ["{invalid JSON", "evidence_integrity_mismatch", false],
      [
        JSON.stringify({
          ...bundle,
          records: bundle.records.map((record) => ({
            ...record,
            normalized_result: "altered",
          })),
        }),
        "evidence_integrity_mismatch",
        true,
      ],
    ] as const) {
      await writeFile(path, contents);
      const invocation = {
        arguments: [
          "inspect-analysis-view",
          JSON.stringify(request),
          "--evidence-bundle",
          path,
          "--json",
        ],
      };
      // Keep a fresh-process integrity check for the altered bundle while the
      // worker must reread the same path for the other invalid inputs.
      const rejected = freshProcess
        ? await cli.run(invocation)
        : await runFileCli(cli, invocation);
      expect(rejected.exitCode).toBe(1);
      expect(rejected.json).toMatchObject({ code: expectedCode });
      expect(rejected.json).not.toHaveProperty("evidence_id");
    }
  },
);

cliTest(
  "preserves native relationship coverage independently of exhausted CLI pages",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-native-coverage-cli-");
    const parent = analysisViewNativeEvidence({
      status: "partial",
      limited_directions: ["callees"],
      limitations: ["Callees: fixture read limit"],
      diagnostics: ["Fixture relationship diagnostic"],
    });
    const parentBefore = JSON.stringify(parent);
    const request = join(root, "request.json");
    await writeFile(
      request,
      JSON.stringify({
        source: { kind: "inline", evidence: parent },
        view: { kind: "native", facet: "callees", offset: 0, limit: 1 },
      }),
    );
    const response = await cli.run({
      arguments: ["inspect-analysis-view", request, "--json"],
    });
    expect(response.exitCode).toBe(0);
    const evidence = parseEvidence(response.json);
    expect(evidence.relationship_coverage).toEqual(
      parent.relationship_coverage,
    );
    expect(evidence.normalized_result).toMatchObject({
      item: [],
      coverage: { total: 0, exhausted: true },
      limitations: expect.arrayContaining(["Fixture dossier caveat"]),
    });
    expect(evidence.evidence_links).toEqual([parent.evidence_id]);
    expect(JSON.stringify(parent)).toBe(parentBefore);
  },
);

cliTest(
  "reads typed module references through the public CLI with canonical Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-module-reference-cli-");
    const request = join(root, "request.json");
    const parent = analysisViewJavaScriptEvidence(
      analysisViewJavaScriptAnalysisWithSource(),
    );
    const input = {
      source: { kind: "inline", evidence: parent },
      view: {
        kind: "javascript",
        collection: "modules",
        projection: "references",
        where: { path: "renderer.js" },
        limit: 1,
      },
    };
    const expected = await inspectAnalysisView(input);
    if (!expected.ok) throw expected.error;
    await writeFile(request, JSON.stringify(input));
    const response = await cli.run({
      arguments: ["inspect-analysis-view", request, "--json"],
    });
    expect(response.exitCode).toBe(0);
    const evidence = parseEvidence(response.json);
    expect(evidence.normalized_result).toEqual(
      expected.value.normalized_result,
    );
    expect(evidence.evidence_id).toBe(expected.value.evidence_id);
    expect(evidence.evidence_links).toEqual([parent.evidence_id]);
  },
);
cliTest(
  "projects opted-in query names through compiled CLI without query values",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-query-names-cli-");
    const path = join(root, "view.json");
    const capture = analysisViewCaptureFixture();
    capture.records = capture.records.slice(0, 2);
    capture.total_records = 2;
    capture.records.forEach((record, index) => {
      record.reported = {
        request: {
          method: "GET",
          url:
            index === 0
              ? "https://api.test/products?category=books&page=1&category=repeat"
              : "https://api.test/products?category=games&sort=price#ignored",
        },
      };
    });
    await writeFile(
      path,
      JSON.stringify({
        source: {
          kind: "inline",
          evidence: analysisViewCaptureEvidence(capture),
        },
        view: { kind: "api-surface", include_query_parameter_names: true },
      }),
    );
    const result = await cli.run({
      arguments: ["inspect-analysis-view", path, "--json"],
    });
    expect(result.exitCode).toBe(0);
    const evidence = parseEvidence(result.json);
    expect(evidence.normalized_result).toMatchObject({
      groups: [
        {
          query_parameter_names: [
            { name: "category", record_ordinals: [0, 1] },
            { name: "page", record_ordinals: [0] },
            { name: "sort", record_ordinals: [1] },
          ],
        },
      ],
    });
    for (const value of ["books", "games", "repeat", "price", "ignored"])
      expect(result.stdout).not.toContain(value);
  },
);

cliTest(
  "projects portable artifact inventory after the original ZIP is removed",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-inventory-view-cli-");
    const archive = join(root, "fixture.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("main.js", new TextReader("console.log('portable');\n"));
    await writeFile(archive, await writer.close());
    const bundlePath = join(root, "inspection-bundle.json");
    const inspected = await cli.run({
      arguments: [
        "inspect-artifact",
        archive,
        "--detail",
        "summary",
        "--evidence_output",
        bundlePath,
        "--json",
      ],
    });
    expect(inspected.exitCode).toBe(0);
    const savedBundle = parseEvidenceBundle(
      JSON.parse(await readFile(bundlePath, "utf8")),
    );
    const parent = savedBundle.records.find(
      (record) => record.operation === "inspect_artifact",
    )!;
    const atomicId = artifactInspectionResultSchema.parse(
      parent.normalized_result,
    ).substeps[0]!.evidence_id;
    expect(savedBundle.records.map((record) => record.evidence_id)).toContain(
      atomicId,
    );
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected shared MCP session");
    expect(
      (await call("import_evidence_bundle", { path: bundlePath })).isError,
    ).not.toBe(true);
    const atomicView = await call("inspect_analysis_view", {
      source: { kind: "retained-evidence", evidence_id: atomicId },
      view: {
        kind: "inventory",
        collection: "occurrences",
        logical_paths: ["main.js"],
      },
    });
    expect(atomicView.isError).not.toBe(true);
    expect(
      parseEvidence(atomicView.structuredContent).normalized_result,
    ).toMatchObject({
      parent_evidence_id: atomicId,
      items: [expect.objectContaining({ logical_path: "main.js" })],
    });
    const unsupportedRequest = join(root, "unsupported-view.json");
    const unsupportedInput = {
      source: { kind: "inline", evidence: parent },
      view: { kind: "page", collection: "sections", offset: 0, limit: 20 },
    };
    await writeFile(unsupportedRequest, JSON.stringify(unsupportedInput));
    const unsupported = await cli.run({
      arguments: ["inspect-analysis-view", unsupportedRequest, "--json"],
    });
    expect(unsupported.exitCode).toBe(1);
    expect(unsupported.json).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["view"],
            message: "Artifact Evidence supports summary and inventory views.",
          },
        ],
      },
    });
    await unlink(archive);
    const request = join(root, "view.json");
    await writeFile(
      request,
      JSON.stringify({
        source: { kind: "inline", evidence: parent },
        view: {
          kind: "inventory",
          collection: "occurrences",
          logical_paths: ["main.js"],
        },
      }),
    );
    const projected = await cli.run({
      arguments: ["inspect-analysis-view", request, "--json"],
    });
    expect(projected.exitCode).toBe(0);
    expect(projected.json).toMatchObject({
      operation: "inspect_analysis_view",
      evidence_links: [parent.evidence_id],
      normalized_result: {
        parent_evidence_id: parent.evidence_id,
        kind: "inventory",
        source_complete: true,
        artifact: { path: archive, sha256: parent.subject?.digest.sha256 },
        items: [expect.objectContaining({ logical_path: "main.js" })],
        coverage: { total: 1, exhausted: true, next_offset: null },
      },
    });
  },
);

cliTest(
  "preserves artifact parent schema diagnostics through the application and CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-inventory-diagnostics-cli-",
    );
    const archive = join(root, "fixture.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("main.js", new TextReader("console.log(1);\n"));
    await writeFile(archive, await writer.close());
    const inspected = await cli.run({
      arguments: ["inspect-artifact", archive, "--json"],
    });
    expect(inspected.exitCode).toBe(0);
    const inspection = parseEvidence(inspected.json);
    const inventory = artifactInspectionResultSchema.parse(
      inspection.normalized_result,
    ).substeps[0]!.evidence;
    const path = join(root, "view.json");
    const reseal = (carrier: Evidence, result: JsonValue) => {
      const subject = carrier.subject!;
      return createEvidence(
        {
          path: subject.local_path,
          sha256: subject.digest.sha256,
          format: subject.format,
        },
        carrier.provider,
        { operation: carrier.operation, parameters: {}, result },
      );
    };
    for (const [carrier, group, field] of [
      [inventory, "manifest", "node_count"],
      [inspection, "coverage", "substeps_completed"],
    ] as const) {
      for (const variant of ["valid", "type", "missing"] as const) {
        const payload = structuredClone(carrier.normalized_result) as Record<
          string,
          Record<string, JsonValue>
        >;
        if (variant === "type") payload[group]![field] = "bad";
        if (variant === "missing") delete payload[group]![field];
        const evidence = reseal(carrier, payload);
        const request = {
          source: { kind: "inline" as const, evidence },
          view: { kind: "summary" as const },
        };
        const application = await inspectAnalysisView(request);
        await writeFile(path, JSON.stringify(request));
        const invocation = {
          arguments: ["inspect-analysis-view", path, "--json"],
        };
        // Exercise a valid and a malformed parent in fresh processes as well
        // as the shared worker's repeated reads of the rewritten input path.
        const reply =
          group === "manifest" && variant !== "missing"
            ? await cli.run(invocation)
            : await runFileCli(cli, invocation);
        expect(reply.stderr).toBe("");
        if (variant === "valid") {
          expect(application.ok).toBe(true);
          expect(reply.exitCode).toBe(0);
          expect(parseEvidence(reply.json).normalized_result).toMatchObject({
            kind: "summary",
          });
          continue;
        }
        expect(application.ok).toBe(false);
        if (application.ok) throw new Error("Expected an invalid parent");
        expect(application.error.cause).toBeInstanceOf(z.ZodError);
        expect(reply.exitCode).toBe(1);
        expect(reply.json).toMatchObject({
          code: "invalid_request",
          category: "invalid_input",
          retryable: false,
          recovery: {
            kind: "inspect_input_contract",
            operation: "inspect_analysis_view",
          },
          details: {
            issues: [
              {
                path: ["source", "normalized_result", group, field],
                reason:
                  variant === "type" ? "invalid_type" : "missing_argument",
                expected: "number",
              },
            ],
          },
        });
      }
    }
    const nested = artifactInspectionResultSchema.parse(
      inspection.normalized_result,
    );
    nested.substeps.push(structuredClone(nested.substeps[0]!));
    nested.coverage.substeps_completed = nested.substeps.length;
    nested.substeps[1]!.evidence.evidence_id = `ev_${"f".repeat(64)}`;
    const request = {
      source: { kind: "inline" as const, evidence: reseal(inspection, nested) },
      view: { kind: "summary" as const },
    };
    const application = await inspectAnalysisView(request);
    expect(application.ok).toBe(false);
    if (application.ok) throw new Error("Expected invalid nested Evidence");
    expect(application.error.cause).toMatchObject({
      cause: expect.any(z.ZodError),
      issues: [
        expect.objectContaining({
          path: ["substeps", 1, "evidence", "evidence_id"],
        }),
      ],
    });
    await writeFile(path, JSON.stringify(request));
    const refused = await cli.run({
      arguments: ["inspect-analysis-view", path, "--json"],
    });
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toBe("");
    expect(refused.json).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: [
              "source",
              "normalized_result",
              "substeps",
              1,
              "evidence",
              "evidence_id",
            ],
            reason: "invalid_value",
            message: "Evidence semantic identifier does not match its record",
          },
        ],
      },
    });
  },
);

cliTest(
  "admits portable captures before parsing and preserves capture caveats",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-inline-capture-cli-");
    const path = join(root, "view.json");
    const environment = {
      HOME: root,
      XDG_CONFIG_HOME: root,
      XDG_CACHE_HOME: root,
    };
    await writeFile(
      path,
      JSON.stringify({
        source: {
          kind: "inline",
          evidence: analysisViewCaptureEvidence(
            analysisViewObjectDenseCapture(),
          ),
        },
        view: { kind: "api-surface" },
      }),
    );
    const refused = await cli.run({
      arguments: ["inspect-analysis-view", path, "--json"],
      environment,
    });
    expect(refused.exitCode).toBe(1);
    expect(refused.json).toMatchObject({
      code: "resource_constraint",
      details: { resource: "memory" },
    });

    const capture = analysisViewCaptureFixture();
    capture.records = capture.records.slice(0, 1);
    capture.total_records = 1;
    const caveat = "Producer omitted exchanges before capture startup.";
    capture.limitations = [caveat, caveat];
    capture.records[0]!.reported = {
      request: { method: "GET", url: "https://api.test/a" },
      response: {
        status: 200,
        content: { mimeType: "\u000btext/plain\u000b" },
      },
    };
    const parent = analysisViewCaptureEvidence(capture);
    expect(parent.limitations).not.toContain(caveat);
    await writeFile(
      path,
      JSON.stringify({
        source: { kind: "inline", evidence: parent },
        view: { kind: "api-surface" },
      }),
    );
    const response = await cli.run({
      arguments: ["inspect-analysis-view", path, "--json"],
      environment,
    });
    expect(response.exitCode, response.stdout).toBe(0);
    const result = parseEvidence(response.json);
    expect(result.limitations.filter((value) => value === caveat)).toEqual([
      caveat,
    ]);
    expect(result.normalized_result).toMatchObject({
      groups: [{ content_types: [], flags: ["single-sample"] }],
      limitations: expect.arrayContaining([caveat]),
      unknowns: [
        "Some retained records have unavailable status or content type values.",
      ],
    });
  },
);

cliTest(
  "discovers native records from a complete portable bundle using the shared workflow",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-evidence-discovery-cli-");
    const parent = createEvidence(
      { path: "/fixtures/native.exe", format: "pe", sha256: "a".repeat(64) },
      { id: "ghidra", name: "Ghidra", version: "12.1.4" },
      {
        operation: "analyze_function",
        parameters: {},
        result: ghidraFunctionDossier(),
      },
    );
    const bundle = createEvidenceBundle([parent]);
    const path = join(root, "evidence.json");
    await writeFile(path, JSON.stringify(bundle));
    const options = {
      detail: "summary" as const,
      filters: { evidence_id: parent.evidence_id },
    };
    const result = await cli.run({
      arguments: [
        "inspect-evidence-bundle",
        JSON.stringify({ path, ...options }),
        "--json",
      ],
      environment: { HOME: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root },
    });
    expect(result.exitCode).toBe(0);
    const expected = inspectEvidenceBundle(bundle, options);
    if (!expected.ok) throw expected.error;
    expect(result.json).toEqual(expected.value);
    const complete = await cli.run({
      arguments: [
        "inspect-evidence-bundle",
        JSON.stringify({ path }),
        "--json",
      ],
      environment: { HOME: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root },
    });
    expect(complete.exitCode).toBe(0);
    expect(complete.json).toEqual(bundle);
  },
);

cliTest(
  "formats the full caller-admitted native inventory page as Markdown and JSON",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-native-inventory-markdown-",
    );
    const input = join(root, "view.json");
    const rowCount = 150_000;
    {
      const parent = createEvidence(
        {
          path: "/fixtures/native.exe",
          format: "pe",
          sha256: "a".repeat(64),
        },
        { id: "fixture", name: "Fixture", version: "1" },
        {
          operation: "list_names",
          parameters: {},
          result: Array.from({ length: rowCount }, (_, index) => ({
            address: `0x${index.toString(16)}`,
            value: `item${index}`,
          })),
        },
      );
      const request = {
        source: { kind: "inline", evidence: parent },
        view: {
          kind: "native-inventory",
          limit: rowCount,
          fields: ["value"],
        },
      };
      await writeFile(input, JSON.stringify(request));
    }
    const environment = {
      HOME: root,
      XDG_CONFIG_HOME: root,
      XDG_CACHE_HOME: root,
      REA_LOG_LEVEL: "silent",
    };

    {
      const json = await cli.run({
        arguments: [
          "inspect-analysis-view",
          input,
          "--format",
          "json",
          "--filter-output",
          "normalized_result.rows",
        ],
        environment,
        timeoutMs: 60_000,
      });
      expect(json.exitCode).toBe(0);
      expect(
        (json.json as { normalized_result: { rows: unknown[] } })
          .normalized_result.rows,
      ).toHaveLength(rowCount);
    }

    const markdown = await cli.run({
      arguments: [
        "inspect-analysis-view",
        input,
        "--format",
        "md",
        "--filter-output",
        "normalized_result.rows",
      ],
      environment,
      timeoutMs: 60_000,
    });
    expect(markdown.exitCode).toBe(0);
    expect(markdown.stdout).toContain("## normalized_result.rows");
    expect(markdown.stdout).toContain("| source_index");
    let lineBreaks = 0;
    for (const character of markdown.stdout)
      if (character === "\n") lineBreaks += 1;
    expect(lineBreaks).toBeGreaterThan(rowCount);
    expect(markdown.stdout).toContain("149999");
  },
);

cliTest(
  "projects one section from a JSON file of inline layout Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-analysis-view-cli-");
    const parent = analysisViewLayoutEvidence();
    const request = {
      source: { kind: "inline", evidence: parent },
      view: {
        kind: "item",
        collection: "sections",
        selector: { name: ".data" },
      },
    };
    const input = join(root, "view.json");
    await mkdir(root, { recursive: true });
    await writeFile(input, JSON.stringify(request));
    const result = await cli.run({
      arguments: ["inspect-analysis-view", input, "--json"],
      environment: {
        HOME: root,
        XDG_CONFIG_HOME: root,
        XDG_CACHE_HOME: root,
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      operation: "inspect_analysis_view",
      normalized_result: {
        kind: "item",
        parent_evidence_id: parent.evidence_id,
        item: { name: { display: ".data" } },
      },
    });
  },
);

cliTest(
  "reports empty retained layout collections without invented index bounds",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-empty-layout-view-cli-");
    const empty = analysisViewLayoutEvidence(binaryLayoutFixture());
    for (const collection of ["sections", "symbols"] as const) {
      const result = await cli.run({
        arguments: [
          "inspect-analysis-view",
          JSON.stringify({
            source: { kind: "inline", evidence: empty },
            view: { kind: "item", collection, selector: { index: 0 } },
          }),
          "--json",
        ],
        environment: {
          HOME: root,
          XDG_CONFIG_HOME: root,
          XDG_CACHE_HOME: root,
        },
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["view", "selector", "index"],
              reason: "invalid_value",
              message: expect.stringContaining(`No retained ${collection}`),
            },
          ],
        },
      });
      expect(result.json).not.toHaveProperty("details.issues.0.minimum");
      expect(result.json).not.toHaveProperty("details.issues.0.maximum");
    }
    const populated = await cli.run({
      arguments: [
        "inspect-analysis-view",
        JSON.stringify({
          source: { kind: "inline", evidence: analysisViewLayoutEvidence() },
          view: {
            kind: "item",
            collection: "sections",
            selector: { index: 3 },
          },
        }),
        "--json",
      ],
      environment: {
        HOME: root,
        XDG_CONFIG_HOME: root,
        XDG_CACHE_HOME: root,
      },
    });
    expect(populated.exitCode).toBe(1);
    expect(populated.json).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["view", "selector", "index"],
            reason: "out_of_range",
            minimum: 0,
            maximum: 2,
          },
        ],
      },
    });
  },
);

cliTest(
  "projects native function pseudocode without requiring Ghidra",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-native-view-cli-");
    const parent = createEvidence(
      { path: "/fixtures/native.exe", format: "pe", sha256: "a".repeat(64) },
      { id: "ghidra", name: "Ghidra", version: "12.1.4" },
      {
        operation: "analyze_function",
        parameters: { address: "0x401000" },
        result: ghidraFunctionDossier(),
      },
    );
    const input = join(root, "native-view.json");
    await writeFile(
      input,
      JSON.stringify({
        source: { kind: "inline", evidence: parent },
        view: { kind: "native", facet: "pseudocode", offset: 0, limit: 12 },
      }),
    );
    const result = await cli.run({
      arguments: ["inspect-analysis-view", input, "--json"],
      environment: { HOME: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root },
    });
    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      operation: "inspect_analysis_view",
      normalized_result: {
        kind: "native",
        parent_evidence_id: parent.evidence_id,
        procedure_address: "0x401000",
        item: { text: "int fixture_", unit: "utf16-code-units" },
      },
      locations: [
        { kind: "artifact-path", path: "/fixtures/native.exe" },
        { kind: "address", address: "0x401000" },
      ],
    });
  },
);

cliTest(
  "keeps an inferred parent's confidence on every view through the compiled CLI",
  async ({ cli }) => {
    const value = evmInterfaceFixture();
    const parent = createEvidence(
      {
        path: value.artifact.path,
        sha256: value.artifact.sha256,
        format: "file",
      },
      { id: "fixture-evm", name: "EVMole", version: "1" },
      {
        operation: "inspect_evm_interface",
        parameters: { path: value.artifact.path, encoding: "hex" },
        result: value,
        confidence: "inferred",
      },
    );
    for (const view of [
      { kind: "summary" },
      { kind: "evm", facet: "bytecode_hex", offset: 0, limit: 4 },
    ]) {
      const result = await cli.run({
        arguments: [
          "inspect-analysis-view",
          JSON.stringify({
            source: { kind: "inline", evidence: parent },
            view,
          }),
          "--json",
        ],
      });
      expect(result.exitCode, result.stdout).toBe(0);
      expect(parseEvidence(result.json)).toMatchObject({
        confidence: "inferred",
        authority: parent.authority,
        evidence_links: [parent.evidence_id],
      });
    }
  },
);

cliTest("rejects malformed JSON before projection", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-analysis-view-cli-bad-");
  const result = await cli.run({
    arguments: ["inspect-analysis-view", "{", "--json"],
    environment: {
      HOME: root,
      XDG_CONFIG_HOME: root,
      XDG_CACHE_HOME: root,
    },
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    details: { operation: "inspect-analysis-view" },
  });
});

cliTest("rejects a request that omits source", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-analysis-view-cli-missing-");
  const input = join(root, "missing-source.json");
  await writeFile(input, JSON.stringify({ view: { kind: "summary" } }));
  const result = await cli.run({
    arguments: ["inspect-analysis-view", input, "--json"],
    environment: {
      HOME: root,
      XDG_CONFIG_HOME: root,
      XDG_CACHE_HOME: root,
    },
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    details: { operation: "inspect_analysis_view" },
  });
});

for (const [view, reason] of [
  [{ kind: "unknown-view" }, "invalid_value"],
  [{}, "missing_argument"],
] as const) {
  cliTest(
    `reports correction details for ${reason} view kind`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-view-variant-");
      const input = join(root, "view.json");
      await writeFile(
        input,
        JSON.stringify({
          source: {
            kind: "inline",
            evidence: analysisViewLayoutEvidence(),
          },
          view,
        }),
      );
      const result = await cli.run({
        arguments: ["inspect-analysis-view", input, "--json"],
        environment: {
          HOME: root,
          XDG_CONFIG_HOME: root,
          XDG_CACHE_HOME: root,
        },
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["view", "kind"],
              reason,
              expected: expect.arrayContaining(["summary", "page"]),
            },
          ],
        },
      });
      expect(JSON.stringify(result.json)).not.toContain("unknown-view");
    },
  );
}

cliTest(
  "decodes HAR credentials and projects recorded API paths through the compiled workflows",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-surface-cli-");
    const fixture = apiSurfaceHar();
    const entry = fixture.log.entries[0]!;
    const urls = [
      "https://user:password@api.example.test/a/%2e%2e/admin?token=ordinary#fragment",
      "https://api.example.test/admin",
      "https:user:password@api.example.test/path",
      "https:///user:password@api.example.test/path",
    ];
    fixture.log.entries.push(
      ...urls.map((url) => ({
        ...entry,
        request: { ...entry.request, url },
      })),
    );
    const bytes = JSON.stringify(fixture);
    const capturePath = join(root, "capture.har");
    const input = join(root, "view.json");
    const environment = {
      HOME: root,
      XDG_CONFIG_HOME: root,
      XDG_CACHE_HOME: root,
    };
    await writeFile(capturePath, bytes);
    const capture = await cli.run({
      arguments: ["inspect-web-network-capture", capturePath, "har", "--json"],
      environment,
    });
    expect(capture.exitCode, capture.stdout).toBe(0);
    const parent = parseEvidence(capture.json);
    expect(parent.subject?.digest.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(JSON.stringify(parent)).not.toContain("password");
    await writeFile(
      input,
      JSON.stringify({
        source: { kind: "inline", evidence: parent },
        view: { kind: "api-surface" },
      }),
    );
    const result = await cli.run({
      arguments: ["inspect-analysis-view", input, "--json"],
      environment,
    });
    expect(result.exitCode, result.stdout).toBe(0);
    expect(result.json).toMatchObject({
      confidence: "inferred",
      evidence_links: [parent.evidence_id],
      normalized_result: {
        kind: "api-surface",
        records: { examined: 17, total: 17, excluded: 2 },
        coverage: { total: 14, exhausted: true },
        groups: expect.arrayContaining([
          expect.objectContaining({
            path_template: "/a/%2e%2e/admin",
            record_ordinals: [13],
          }),
          expect.objectContaining({
            path_template: "/admin",
            record_ordinals: [14],
          }),
        ]),
        excluded_records: [
          { ordinal: 15, reason: "url-redacted" },
          { ordinal: 16, reason: "url-redacted" },
        ],
      },
    });
    expect(JSON.stringify(result.json)).not.toContain("password");
    expect(JSON.stringify(result.json)).not.toContain("ordinary");
  },
);

cliTest(
  "projects an environment manifest from an Evidence file through the compiled CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-evidence-file-cli-");
    const capturePath = join(root, "capture.json");
    const parent = analysisViewCaptureEvidence(
      environmentManifestCaptureFixture(),
    );
    await writeFile(capturePath, JSON.stringify(parent));
    const requestPath = join(root, "view.json");
    const view = {
      kind: "environment-manifest",
      template_rules: ["opaque-token", "sibling-pair-variance"],
    } as const;
    await writeFile(
      requestPath,
      JSON.stringify({
        source: { kind: "evidence-file", path: capturePath },
        view,
      }),
    );
    const result = await cli.run({
      arguments: ["inspect-analysis-view", requestPath, "--json"],
    });
    expect(result.exitCode, result.stdout).toBe(0);
    const evidence = parseEvidence(result.json);
    expect(evidence.parameters).toMatchObject({
      parent_evidence_id: parent.evidence_id,
    });
    // The file source projects exactly what the same Evidence projects inline.
    const inline = await inspectAnalysisView({
      source: { kind: "inline", evidence: parent },
      view,
    });
    if (!inline.ok) throw inline.error;
    expect(evidence.normalized_result).toEqual(inline.value.normalized_result);
    expect(evidence.normalized_result).toMatchObject({
      kind: "environment-manifest",
      origin: "http://grafana.example",
    });
  },
);

cliTest(
  "projects an environment manifest through the compiled CLI without recorded values",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-environment-manifest-cli-");
    const path = join(root, "view.json");
    await writeFile(
      path,
      JSON.stringify({
        source: {
          kind: "inline",
          evidence: analysisViewCaptureEvidence(
            environmentManifestCaptureFixture(),
          ),
        },
        view: {
          kind: "environment-manifest",
          template_rules: [
            "after-uid-literal",
            "opaque-token",
            "sibling-variance",
          ],
        },
      }),
    );
    const result = await cli.run({
      arguments: ["inspect-analysis-view", path, "--json"],
    });
    expect(result.exitCode, result.stdout).toBe(0);
    const evidence = parseEvidence(result.json);
    expect(evidence.confidence).toBe("inferred");
    expect(evidence.normalized_result).toMatchObject({
      kind: "environment-manifest",
      origin: "http://grafana.example",
      name: "grafana-example",
      coverage: { total: 19, exhausted: true },
      excluded: expect.arrayContaining([
        expect.objectContaining({ reason: "other-origin" }),
      ]),
    });
    for (const template of [
      "/api/dashboards/uid/{uid}",
      "/api/folders/{uid}",
      "/api/plugins/{plugin_id}/settings",
      "/api/datasources/uid/{uid}/health",
    ])
      expect(result.stdout).toContain(JSON.stringify(template));
    for (const value of ["probe folder", "Main Org", "JFIF", "console.log"])
      expect(result.stdout).not.toContain(value);
    await writeFile(
      path,
      JSON.stringify({
        source: {
          kind: "inline",
          evidence: analysisViewCaptureEvidence(
            analysisViewObjectDenseCapture(),
          ),
        },
        view: { kind: "environment-manifest" },
      }),
    );
    const refused = await cli.run({
      arguments: ["inspect-analysis-view", path, "--json"],
    });
    expect(refused.exitCode).toBe(1);
    expect(refused.json).toMatchObject({
      code: "resource_constraint",
      details: { resource: "memory" },
    });
  },
);

cliTest(
  "extracts an environment state through the compiled CLI with recorded values",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-environment-state-cli-");
    const path = join(root, "view.json");
    await writeFile(
      path,
      JSON.stringify({
        source: {
          kind: "inline",
          evidence: analysisViewCaptureEvidence(
            environmentStateCaptureFixture(),
          ),
        },
        view: {
          kind: "environment-state",
          template_rules: [
            "after-uid-literal",
            "opaque-token",
            "sibling-variance",
          ],
        },
      }),
    );
    const result = await cli.run({
      arguments: ["inspect-analysis-view", path, "--json"],
    });
    expect(result.exitCode, result.stdout).toBe(0);
    const evidence = parseEvidence(result.json);
    expect(evidence.confidence).toBe("inferred");
    expect(evidence.normalized_result).toMatchObject({
      kind: "environment-state",
      origin: "http://grafana.example",
      timeline: "recorded-start-time",
      types: expect.arrayContaining([
        expect.objectContaining({
          collection_template: "/api/folders",
          id_field: "uid",
        }),
      ]),
    });
    for (const value of ["probe folder", "probe@example.test"])
      expect(result.stdout).toContain(value);
  },
);

cliTest.for([
  {
    spelling: "minute-only offset timestamps",
    starts: ["2026-10-20T09:00Z", "2026-10-20T09:02Z", "2026-10-20T09:01Z"],
  },
  {
    spelling: "ten-digit fractional timestamps",
    starts: [
      "2026-10-20T09:00:00.0000000001Z",
      "2026-10-20T09:00:00.0000000003Z",
      "2026-10-20T09:00:00.0000000002Z",
    ],
  },
])(
  "keeps the pre-write environment state through the compiled CLI for $spelling",
  async ({ starts }, { cli }) => {
    const root = await createTestTempDirectory("rea-state-chronology-cli-");
    const path = join(root, "view.json");
    const entries = starts.map((startedDateTime, ordinal) => ({
      startedDateTime,
      time: 0,
      request: {
        method: ordinal === 2 ? "PATCH" : "GET",
        url: "http://app.example/api/settings",
        ...(ordinal === 2
          ? {
              postData: {
                mimeType: "application/json",
                text: '{"theme":"dark"}',
              },
            }
          : {}),
      },
      response: {
        status: 200,
        content: {
          mimeType: "application/json",
          text: ordinal === 0 ? '{"theme":"light"}' : '{"theme":"dark"}',
        },
      },
    }));
    const parent = analysisViewCaptureEvidence(
      environmentManifestCaptureFixture(entries),
    );
    expect(parent.normalized_result).toMatchObject({
      records: entries.map((reported, ordinal) => ({ ordinal, reported })),
    });
    const request = JSON.stringify({
      source: { kind: "inline", evidence: parent },
      view: { kind: "environment-state" },
    });
    await writeFile(path, request);
    const result = await cli.run({
      arguments: ["inspect-analysis-view", path, "--json"],
    });
    expect(result.exitCode, result.stdout).toBe(0);
    const evidence = parseEvidence(result.json);
    expect(evidence.evidence_links).toEqual([parent.evidence_id]);
    expect(evidence.normalized_result).toMatchObject({
      kind: "environment-state",
      timeline: "recorded-start-time",
      documents: [
        {
          tool: "get_settings",
          path: "/api/settings",
          value: { theme: "light" },
          record_ordinal: 0,
        },
      ],
    });
    expect(await readFile(path, "utf8")).toBe(request);
  },
);

cliTest(
  "decodes a Grafana-shaped HAR and projects its environment manifest through the compiled workflows",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-manifest-chain-cli-");
    const capturePath = join(root, "capture.har");
    await writeFile(capturePath, JSON.stringify(environmentManifestHar()));
    const capture = await cli.run({
      arguments: ["inspect-web-network-capture", capturePath, "har", "--json"],
    });
    expect(capture.exitCode, capture.stdout).toBe(0);
    const parent = parseEvidence(capture.json);
    const input = join(root, "manifest.json");
    await writeFile(
      input,
      JSON.stringify({
        source: { kind: "inline", evidence: parent },
        view: { kind: "environment-manifest" },
      }),
    );
    const result = await cli.run({
      arguments: ["inspect-analysis-view", input, "--json"],
    });
    expect(result.exitCode, result.stdout).toBe(0);
    expect(result.json).toMatchObject({
      confidence: "inferred",
      evidence_links: [parent.evidence_id],
      normalized_result: {
        kind: "environment-manifest",
        name: "grafana-example",
        templated_groups: 6,
        coverage: { total: 22, exhausted: true },
        artifact: { path: capturePath, sha256: parent.subject?.digest.sha256 },
        records: expect.arrayContaining([
          {
            ordinal: 3,
            method: "GET",
            path: "/api/org",
            status: 200,
            content_type: "application/json",
          },
        ]),
        unknowns: [
          expect.objectContaining({ kind: "authorization-model" }),
          expect.objectContaining({ kind: "response-semantics" }),
          expect.objectContaining({ kind: "state-transition" }),
        ],
      },
    });
    expect(JSON.stringify(result.json)).not.toContain("probe folder");
  },
);

cliTest.for(
  (process.platform === "win32"
    ? (["event"] as const)
    : (["event", "os"] as const)
  ).flatMap((delivery) => [
    { signal: "SIGINT" as const, status: 130, delivery },
    { signal: "SIGTERM" as const, status: 143, delivery },
  ]),
)(
  "retains inline projection when $signal ($delivery) is queued during final sealing",
  async ({ signal, status, delivery }, { cli }) => {
    const root = await createTestTempDirectory("rea-inline-view-signal-");
    const parent = analysisViewLayoutEvidence(),
      marker = join(root, "signal.json");
    const preload = resolve(
      "tests/fixtures/evidenceCompletionSignalPreload.mjs",
    );
    const reply = await cli.run({
      arguments: [
        "inspect-analysis-view",
        JSON.stringify({
          source: { kind: "inline", evidence: parent },
          view: { kind: "summary" },
        }),
        "--json",
      ],
      environment: {
        HOME: root,
        REA_LOG_LEVEL: "silent",
        REA_TEST_EVIDENCE_COMPLETION: JSON.stringify({
          operation: "inspect_analysis_view",
          parent_evidence_id: parent.evidence_id,
          marker,
          signal,
          delivery,
        }),
        NODE_OPTIONS: `--max-old-space-size=2048 --import=${pathToFileURL(preload).href}`,
      },
    });
    expect(reply.exitCode).toBe(status);
    const { error: label, ...projection } =
      analysisCliErrorEnvelopeSchema.parse(reply.json);
    expect(label).toBe("Application workflow failed");
    const error = analysisErrorProjectionSchema.parse(projection);
    expect(error.code).toBe("cancelled");
    expect(error.details?.operation).toBe("inspect_analysis_view");
    const partial = parseEvidence(error.details?.partial_observation);
    expect(partial.operation).toBe("inspect_analysis_view");
    expect(partial.evidence_links).toEqual([parent.evidence_id]);
    expect(partial.normalized_result).toMatchObject({
      parent_evidence_id: parent.evidence_id,
      kind: "summary",
    });
    const proof = JSON.parse(await readFile(marker, "utf8"));
    expect(proof).toMatchObject({
      evidence_id: partial.evidence_id,
      signal,
      delivery,
    });
    expect(proof.listeners).toBeGreaterThan(0);
  },
);
