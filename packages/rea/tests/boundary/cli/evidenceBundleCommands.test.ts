import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { PRE_66_NULL_COVERAGE_EVIDENCE } from "../../../src/domain/evidenceLegacy.fixture.js";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";

import { jsonValueSchema } from "../../../src/domain/jsonValue.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import {
  createResidualUnknown,
  updateResidualUnknown,
} from "../../../src/domain/residualUnknown.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { JSON_BYTE_ORDER_MARK_MESSAGE } from "../../../src/application/Utf8JsonInput.js";

const revisionBundle = () => {
  const records = ["open", "investigate"].map((operation) =>
    createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      { operation, parameters: {}, result: { observed: operation } },
    ),
  );
  const [opened, investigated] = records;
  if (opened === undefined || investigated === undefined)
    throw new Error("Missing mutation Evidence");
  const details = {
    severity: "high" as const,
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
    required_authority: null,
    required_confidence: "observed" as const,
    required_environment: null,
    recommended_probes: [],
    relationships: [],
  };
  const initial = createResidualUnknown(
    { question: "How is this input handled?", domain: "protocol", ...details },
    opened.evidence_id,
    null,
  );
  const revised = updateResidualUnknown(
    initial,
    {
      unknown_id: initial.unknown_id,
      expected_revision: initial.revision,
      status: "investigating",
      ...details,
      resolution: null,
    },
    investigated.evidence_id,
  );
  return createEvidenceBundle(records, [initial, revised]);
};

cliTest(
  "rejects empty Evidence path arguments before filesystem selection",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-empty-evidence-path-");
    const encoded = JSON.stringify(revisionBundle());
    await writeFile(join(root, "bundle.json"), encoded);
    for (const [args, field] of [
      [["evidence-import", ""], "path"],
      [["evidence-export", "", "refused.json"], "source"],
      [["evidence-export", "bundle.json", ""], "output"],
      [["compare", "", "bundle.json"], "left"],
      [["compare", "bundle.json", ""], "right"],
      [["evidence-export", "missing.json", ""], "output"],
    ] as const) {
      const result = await cli.run({
        arguments: [...args, "--json"],
        cwd: root,
      });
      expect(result.exitCode, JSON.stringify(args)).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.json).toMatchObject({
        code: "VALIDATION_ERROR",
        fieldErrors: [{ path: field, code: "too_small", missing: false }],
      });
      expect(result.json).not.toHaveProperty("details.path");
      expect(await readdir(root)).toEqual(["bundle.json"]);
      expect(await readFile(join(root, "bundle.json"), "utf8")).toBe(encoded);
    }
  },
);

cliTest(
  "preserves whitespace in selected Evidence filenames",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-evidence-spaced-path-");
    const source = " bundle name.json";
    const output = " exported bundle.json";
    const bundle = revisionBundle();
    const encoded = JSON.stringify(bundle);
    await writeFile(join(root, source), encoded);
    const imported = await cli.run({
      arguments: ["evidence-import", source, "--json"],
      cwd: root,
    });
    expect(imported.exitCode, imported.stderr).toBe(0);
    expect(imported.json).toEqual({ imported: 2, unknowns_added: 2, total: 2 });
    const exported = await cli.run({
      arguments: ["evidence-export", source, output, "--json"],
      cwd: root,
    });
    expect(exported.exitCode, exported.stderr).toBe(0);
    expect(JSON.parse(await readFile(join(root, output), "utf8"))).toEqual(
      bundle,
    );
    const compared = await cli.run({
      arguments: ["compare", source, output, "--json"],
      cwd: root,
    });
    expect(compared.exitCode, compared.stderr).toBe(0);
    expect(compared.json).toMatchObject({ status: "unchanged" });
    expect(await readFile(join(root, source), "utf8")).toBe(encoded);
    expect((await readdir(root)).sort()).toEqual([source, output].sort());
  },
);

cliTest(
  "advertises the same nonempty path constraints to schema clients",
  async ({ cli }) => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const [command, valid] of [
      ["evidence-import", { path: " bundle.json" }],
      ["evidence-export", { source: " bundle.json", output: " exported.json" }],
      ["compare", { left: " bundle.json", right: " other.json" }],
    ] as const) {
      const result = await cli.run({
        arguments: [command, "--schema", "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      const { args } = z
        .object({ args: z.record(z.string(), z.unknown()) })
        .parse(result.json);
      expect(ajv.validateSchema(args), ajv.errorsText()).toBe(true);
      const validate = ajv.compile(args);
      expect(validate(valid), command).toBe(true);
      for (const field of Object.keys(valid))
        expect(validate({ ...valid, [field]: "" }), `${command}.${field}`).toBe(
          false,
        );
    }
  },
);

cliTest(
  "rejects directory exports with file-path recovery in both overwrite modes",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-export-directory-cli-");
    const source = join(root, "bundle.json");
    const output = join(root, "output");
    const sentinel = join(output, "keep.txt");
    const emptyBundle = createEvidenceBundle([]);
    const sourceBytes = JSON.stringify(emptyBundle);
    await writeFile(source, sourceBytes);
    await mkdir(output);
    await writeFile(sentinel, "keep\n");

    for (const flags of [[], ["--overwrite"]]) {
      const result = await cli.run({
        arguments: ["evidence-export", source, output, ...flags, "--json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.json).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        details: { operation: "write", reason: "not-file", path: output },
        message: expect.stringContaining("regular file"),
        remediation: { action: expect.stringContaining("regular file") },
      });
      expect((await lstat(output)).isDirectory()).toBe(true);
      expect(await readdir(output)).toEqual(["keep.txt"]);
      expect(await readFile(sentinel, "utf8")).toBe("keep\n");
      expect((await readdir(root)).sort()).toEqual(["bundle.json", "output"]);
    }

    const file = join(root, "fresh.json");
    const arguments_ = ["evidence-export", source, file, "--json"];
    const fresh = await cli.run({ arguments: arguments_ });
    expect(fresh.exitCode, fresh.stderr).toBe(0);
    const exported = await readFile(file, "utf8");
    expect(JSON.parse(exported)).toEqual(emptyBundle);

    const existingBytes = "previous output\n";
    await writeFile(file, existingBytes);
    const collision = await cli.run({ arguments: arguments_ });
    expect(collision.exitCode).toBe(1);
    expect(collision.json).toMatchObject({
      code: "invalid_request",
      details: { operation: "write", reason: "exists", path: file },
      message: expect.stringContaining("allow overwrite"),
    });
    expect(await readFile(file, "utf8")).toBe(existingBytes);

    const replacement = await cli.run({
      arguments: [...arguments_, "--overwrite"],
    });
    expect(replacement.exitCode, replacement.stderr).toBe(0);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(emptyBundle);
    expect(await readFile(source, "utf8")).toBe(sourceBytes);
    expect((await readdir(root)).sort()).toEqual([
      "bundle.json",
      "fresh.json",
      "output",
    ]);
  },
);

cliTest.for([
  "evidence-import",
  "evidence-export",
  "compare-left",
  "compare-right",
])(
  "explains a bundle BOM with the format owner's recovery through $0",
  async (operation, { cli }) => {
    const root = await createTestTempDirectory("rea-bundle-bom-cli-");
    const path = join(root, "bundle.json");
    const canonical = join(root, "canonical.json");
    const output = join(root, "exported.json");
    const encoded = JSON.stringify(revisionBundle());
    const bom = `\uFEFF${encoded}`;
    await writeFile(path, bom);
    await writeFile(canonical, encoded);
    const arguments_ =
      operation === "evidence-import"
        ? [operation, path]
        : operation === "evidence-export"
          ? [operation, path, output]
          : operation === "compare-left"
            ? ["compare", path, canonical]
            : ["compare", canonical, path];
    const result = await cli.run({
      arguments: [...arguments_, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "evidence_integrity_mismatch",
      message: JSON_BYTE_ORDER_MARK_MESSAGE,
      remediation: { action: JSON_BYTE_ORDER_MARK_MESSAGE },
    });
    expect(await readFile(path, "utf8")).toBe(bom);
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

cliTest.for([
  "export_evidence_bundle",
  "compare_bundles",
  "get_evidence_bundle",
])("attributes an early heap refusal to $0", async (operation, { cli }) => {
  const root = await createTestTempDirectory("rea-bundle-operation-");
  const path = join(root, "parent.json");
  const output = join(root, "output.json");
  await writeFile(path, JSON.stringify(revisionBundle()));
  const preload =
    "import v8 from 'node:v8';import {syncBuiltinESMExports} from 'node:module';const read=v8.getHeapStatistics;v8.getHeapStatistics=()=>({...read(),total_available_size:0});syncBuiltinESMExports();";
  const arguments_ =
    operation === "export_evidence_bundle"
      ? ["evidence-export", path, output]
      : operation === "compare_bundles"
        ? ["compare", path, path]
        : ["inspect-evidence-bundle", JSON.stringify({ path })];
  const result = await cli.run({
    arguments: [...arguments_, "--json"],
    environment: {
      REA_LOG_LEVEL: "silent",
      NODE_OPTIONS: `--max-old-space-size=2048 --import=data:text/javascript;base64,${Buffer.from(preload).toString("base64")}`,
    },
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "resource_constraint",
    details: { operation },
  });
  expect(await readdir(root)).toEqual(["parent.json"]);
});

cliTest(
  "reports standalone import counts for every unknown revision",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-evidence-import-");
    const path = join(root, "bundle.json");
    await writeFile(path, JSON.stringify(revisionBundle()));
    const result = await cli.run({
      arguments: ["evidence-import", path, "--json"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({ imported: 2, unknowns_added: 2, total: 2 });
  },
);

cliTest(
  "reports exported residual-unknown revision counts",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-evidence-export-counts-");
    for (const [label, bundle] of [
      ["empty", createEvidenceBundle([])],
      ["revisions", revisionBundle()],
    ] as const) {
      const source = join(root, `${label}.json`);
      await writeFile(source, JSON.stringify(bundle));
      for (const full of [false, true]) {
        const output = join(root, `${label}-${String(full)}.json`);
        const result = await cli.run({
          arguments: [
            "evidence-export",
            source,
            output,
            "--json",
            ...(full ? ["--full-output"] : []),
          ],
        });
        expect(result.exitCode, result.stderr).toBe(0);
        const receipt = full
          ? (result.json as { data: unknown }).data
          : result.json;
        expect(receipt).toMatchObject({
          path: output,
          records: bundle.records.length,
          unknowns: bundle.unknowns.length,
        });
        expect(JSON.parse(await readFile(output, "utf8"))).toEqual(bundle);
      }
    }
  },
);

cliTest(
  "reports a standalone Evidence record as the wrong input file kind",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-evidence-record-input-");
    const path = join(root, "record.json");
    const record = revisionBundle().records[0];
    if (record === undefined) throw new Error("Missing fixture Evidence");
    await writeFile(path, JSON.stringify(record));
    const result = await cli.run({
      arguments: ["evidence-import", path, "--json"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      details: { path },
      message: expect.stringContaining("this JSON is one Evidence record"),
    });
  },
);

cliTest(
  "rejects altered Evidence and incomplete unknown history before reporting counts",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-evidence-import-invalid-");
    const path = join(root, "bundle.json");
    const bundle = revisionBundle();
    for (const invalid of [
      {
        ...bundle,
        records: bundle.records.map((record) => ({
          ...record,
          normalized_result: "altered",
        })),
      },
      { ...bundle, unknowns: bundle.unknowns.slice(1) },
    ]) {
      await writeFile(path, JSON.stringify(invalid));
      const result = await cli.run({
        arguments: ["evidence-import", path, "--json"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "evidence_integrity_mismatch",
      });
      expect(result.json).not.toHaveProperty("imported");
    }
  },
);

cliTest(
  "preserves a selected own __proto__ member from complete bundle data",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-evidence-filter-proto-");
    const path = join(root, "bundle.json");
    const result = jsonValueSchema.parse(
      JSON.parse('{"__proto__":{"answer":7},"normal":{"answer":7}}'),
    );
    const record = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      { operation: "ordinary-json", parameters: {}, result },
    );
    await writeFile(path, JSON.stringify(createEvidenceBundle([record])));

    const output = await cli.run({
      arguments: [
        "inspect-evidence-bundle",
        JSON.stringify({ path, detail: "complete" }),
        "--json",
        "--filter-output",
        "records[0,1].normalized_result.__proto__.answer",
      ],
    });

    expect(output.exitCode).toBe(0);
    const records = (
      output.json as {
        records: Array<{ normalized_result: unknown }>;
      }
    ).records;
    const normalizedResult = records[0]?.normalized_result;
    expect(typeof normalizedResult).toBe("object");
    expect(normalizedResult).not.toBeNull();
    expect(Object.hasOwn(normalizedResult as object, "__proto__")).toBe(true);
    expect((normalizedResult as Record<string, unknown>)["__proto__"]).toEqual({
      answer: 7,
    });
  },
);

cliTest(
  "preserves cell text when formatting retained Evidence as Markdown",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-evidence-markdown-cells-");
    const path = join(root, "bundle.json");
    const result = {
      text: "left|right\\tail\nnext",
      type: "List<string>",
      literal: "&copy; <br>",
    };
    const record = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "ordinary-json",
        parameters: {},
        result,
      },
    );
    await writeFile(path, JSON.stringify(createEvidenceBundle([record])));
    const base = [
      "inspect-evidence-bundle",
      JSON.stringify({ path, detail: "complete" }),
      "--filter-output",
      "records.0.normalized_result",
    ];
    const json = await cli.run({ arguments: [...base, "--json"] });
    expect(json.exitCode, json.stderr).toBe(0);
    expect(json.stdout).toContain(JSON.stringify(result.text));
    expect(json.stdout).toContain(JSON.stringify(result.type));
    expect(json.stdout).toContain(JSON.stringify(result.literal));
    const markdown = await cli.run({ arguments: [...base, "--format", "md"] });
    expect(markdown.exitCode, markdown.stderr).toBe(0);
    expect(markdown.stdout).toContain("left\\|right\\\\tail<br>next");
    expect(markdown.stdout).toContain("List&lt;string&gt;");
    expect(markdown.stdout).toContain("&amp;copy; &lt;br&gt;");
  },
);

cliTest(
  "diagnoses an obsolete explicit-null Evidence commitment without claiming the file was modified",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-legacy-coverage-identity-");
    const path = join(root, "legacy.json");
    const record = PRE_66_NULL_COVERAGE_EVIDENCE;
    const bundle = {
      artifacts: [],
      providers: [record.provider],
      environments: [],
      scenarios: [],
      captures: [],
      unknowns: [],
      records: [record],
    };
    await writeFile(path, JSON.stringify(bundle));
    const imported = await cli.run({
      arguments: ["evidence-import", path, "--json"],
    });
    expect(imported.exitCode).toBe(1);
    expect(imported.json).toMatchObject({
      code: "evidence_integrity_mismatch",
      retryable: false,
      message: expect.stringContaining(
        "earlier relationship_coverage identity commitment",
      ),
    });
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected shared MCP session");
    const response = await call("import_evidence_bundle", { path });
    expect(response.isError).toBe(true);
    expect(parseMcpToolError(response)).toMatchObject({
      error: {
        code: "evidence_integrity_mismatch",
        retryable: false,
        message: expect.stringContaining(
          "earlier relationship_coverage identity commitment",
        ),
      },
    });
  },
);
