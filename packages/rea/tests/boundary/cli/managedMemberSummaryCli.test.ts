import { pathToFileURL } from "node:url";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect } from "vitest";

import { inspectAnalysisView } from "../../../src/application/analysisView/AnalysisViewService.js";
import {
  analysisCliErrorEnvelopeSchema,
  analysisErrorProjectionSchema,
} from "../../../src/contracts/errorSchemas.js";
import {
  analysisViewResultSchema,
  managedMemberSummaryViewResultSchema,
} from "../../../src/domain/analysisView/analysisView.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { parseEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import {
  managedMemberInspectionSchema,
  type ManagedMemberInspection,
} from "../../../src/domain/managed/managedArtifact.js";
import { buildManagedPeFixture } from "../../../src/dotnet/ManagedPe.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";

const memberFixture = (): Buffer =>
  buildManagedPeFixture({
    methodRowCount: 2,
    memberRefRowCount: 3,
    // ldarg.0; ldfld field; call member ref; ldstr "ok"; pop; ret
    ilBody: Buffer.from([
      (18 << 2) | 2,
      0x02,
      0x7b,
      1,
      0,
      0,
      0x04,
      0x28,
      1,
      0,
      0,
      0x0a,
      0x72,
      1,
      0,
      0,
      0x70,
      0x26,
      0x2a,
    ]),
    userStringHeap: Buffer.from([0, 5, 0x6f, 0, 0x6b, 0, 0]),
    exportedTypes: [
      {
        namespace: "System",
        name: "Object",
        flags: 0x0020_0001,
        implementationRaw: (1 << 2) | 1,
      },
    ],
  });

type CliMemberViewContext = {
  readonly cli: TestCli;
  readonly cwd: string;
  readonly bundlePath: string;
  readonly parent: Evidence;
  readonly report: ManagedMemberInspection;
};

const verifyCliSelection = async ({
  cli,
  cwd,
  bundlePath,
  parent,
  report,
}: CliMemberViewContext) => {
  const selected = await cli.run({
    cwd,
    arguments: [
      "inspect-analysis-view",
      JSON.stringify({
        source: {
          kind: "retained-evidence",
          evidence_id: parent.evidence_id,
        },
        view: {
          kind: "managed-members",
          collection: "methods",
          names: ["Main"],
          declaring_types: ["Fixture.Program"],
          fields: ["name"],
          offset: 1,
          limit: 1,
        },
      }),
      "--evidence-bundle",
      bundlePath,
      "--json",
    ],
  });
  expect(selected.exitCode).toBe(0);
  const selectedEvidence = parseEvidence(selected.json);
  const selectedView = analysisViewResultSchema.parse(
    selectedEvidence.normalized_result,
  );
  expect(selectedEvidence.evidence_links).toEqual([parent.evidence_id]);
  expect(selectedView).toMatchObject({
    module: report.module,
    source_coverage: report.coverage,
    coverage: { total: 2, examined: 1 },
    page: {
      collection: "methods",
      source_count: 2,
      unresolved_filter_rows: 0,
      rows: [{ source_index: 1, token: "0x06000002", name: "Main" }],
    },
  });
  if (selectedView.kind !== "managed-members") throw new Error("Wrong view");
  expect(selectedView.page.rows[0]).not.toHaveProperty("body");
};

const verifyCliFullPages = async (
  { cli, cwd, bundlePath, parent, report }: CliMemberViewContext,
  reportedCounts: Readonly<Record<string, number | null>>,
) => {
  for (const collection of [
    "types",
    "exported_types",
    "fields",
    "methods",
    "member_refs",
    "call_edges",
    "field_accesses",
    "user_strings",
  ] as const) {
    const rows =
      collection === "user_strings"
        ? report.user_strings?.literals
        : report[collection];
    if (rows == null) throw new Error(`${collection} was not examined`);
    expect(rows.length, collection).toBeGreaterThan(0);
    expect(reportedCounts[collection]).toBe(rows.length);
    const paged: unknown[] = [];
    for (let offset: number | null = 0; offset !== null;) {
      const response = await cli.run({
        cwd,
        arguments: [
          "inspect-analysis-view",
          JSON.stringify({
            source: {
              kind: "retained-evidence",
              evidence_id: parent.evidence_id,
            },
            view: { kind: "managed-members", collection, offset, limit: 1 },
          }),
          "--evidence-bundle",
          bundlePath,
          "--json",
        ],
      });
      expect(response.exitCode).toBe(0);
      const evidence = parseEvidence(response.json);
      expect(evidence.evidence_links).toEqual([parent.evidence_id]);
      expect(evidence).not.toHaveProperty("caller_input_path");
      expect(evidence.subject).toEqual(parent.subject);
      const page = analysisViewResultSchema.parse(evidence.normalized_result);
      if (page.kind !== "managed-members") throw new Error("Wrong page kind");
      expect(page.page.collection).toBe(collection);
      expect(page.selection).toEqual(report.selection);
      expect(page.source_coverage).toEqual(report.coverage);
      expect(page.source_metadata_status).toBe(report.metadata.status);
      expect(page.coverage.total).toBe(rows.length);
      paged.push(...page.page.rows);
      offset = page.coverage.next_offset;
    }
    expect(paged).toEqual(rows);
  }
};

cliTest(
  "advertises durable summary and portable paging options in CLI help",
  async ({ cli }) => {
    for (const command of [
      "inspect-managed-members",
      "inspect-analysis-view",
    ]) {
      const result = await cli.run({ arguments: [command, "--help"] });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--evidence-bundle");
      if (command === "inspect-managed-members") {
        expect(result.stdout).toContain("--detail");
        expect(result.stdout).toContain("summary");
        expect(result.stdout).toContain("complete");
      }
    }
  },
);

cliTest(
  "classifies a field MemberRef loaded by ldtoken in the CLI inspection",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-ldtoken-cli-");
    const path = join(root, "field-token.dll");
    const il = Buffer.from([0xd0, 1, 0, 0, 0x0a, 0x26, 0x2a]);
    await writeFile(
      path,
      buildManagedPeFixture({
        targetFramework: null,
        memberRefName: "Counter",
        memberRefParentRaw: 8,
        memberRefSignature: Buffer.from([0x06, 0x08]),
        ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
      }),
    );
    const inspected = await cli.run({
      arguments: ["inspect-managed-members", path, "--json"],
    });
    expect(inspected.exitCode).toBe(0);
    const evidence = parseEvidence(inspected.json);
    const result = managedMemberInspectionSchema.parse(
      evidence.normalized_result,
    );
    expect(result.member_refs[0]?.signature.kind).toBe("field");
    expect(result.methods[0]?.body.anchors[0]).toMatchObject({
      opcode: "ldtoken",
      operand_kind: "field",
      operand: "0x0a000001",
    });
  },
);

cliTest(
  "retains complete member Evidence for exact CLI pages after process exit and target removal",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-member-summary-cli-");
    const path = join(root, "fixture.dll");
    const bundlePath = join(root, "members.json");
    await writeFile(path, memberFixture());
    const typeNames = ["Fixture.Program", "Missing.Type"];
    const arguments_ = [
      "inspect-managed-members",
      path,
      ...typeNames.flatMap((type) => ["--type", type]),
      "--json",
    ];
    const omitted = await cli.run({ arguments: arguments_ });
    expect(omitted.exitCode).toBe(0);
    const complete = parseEvidence(omitted.json);
    expect(complete.caller_input_path).toBe(path);
    const completeBundlePath = join(root, "complete.json");
    const explicit = await cli.run({
      arguments: [
        ...arguments_,
        "--detail",
        "complete",
        "--evidence-bundle",
        completeBundlePath,
      ],
    });
    expect(explicit.exitCode).toBe(0);
    expect(parseEvidence(explicit.json)).toMatchObject({
      evidence_id: complete.evidence_id,
      caller_input_path: path,
    });
    expect(
      parseEvidenceBundle(
        JSON.parse(await readFile(completeBundlePath, "utf8")),
      ).records[0],
    ).toMatchObject({
      evidence_id: complete.evidence_id,
      caller_input_path: path,
    });

    const reply = await cli.run({
      cwd: root,
      arguments: [
        ...arguments_,
        "--detail",
        "summary",
        "--evidence-bundle",
        "members.json",
      ],
    });
    expect(reply.exitCode).toBe(0);
    const receipt = parseEvidence(reply.json);
    expect(receipt.caller_input_path).toBe(path);
    const summary = managedMemberSummaryViewResultSchema.parse(
      receipt.normalized_result,
    );
    const originalBytes = await readFile(bundlePath, "utf8");
    const bundle = parseEvidenceBundle(JSON.parse(originalBytes));
    expect(bundle.records).toHaveLength(1);
    const parent = bundle.records[0]!;
    expect(parent.evidence_id).toBe(complete.evidence_id);
    expect(parent.caller_input_path).toBe(path);
    expect(parent.normalized_result).toEqual(complete.normalized_result);
    expect(parent.raw_result).toEqual(complete.raw_result);
    expect(parent.subject).toEqual(complete.subject);
    expect(parent.locations).toEqual(complete.locations);
    expect(parent.parameters).toEqual({
      type_names: typeNames,
      input_path: path,
    });
    expect(receipt.evidence_links).toEqual([parent.evidence_id]);
    const portable = await inspectAnalysisView({
      source: { kind: "inline", evidence: parent },
      view: { kind: "summary" },
    });
    if (!portable.ok) throw portable.error;
    expect(receipt.evidence_id).toBe(portable.value.evidence_id);
    expect(portable.value).not.toHaveProperty("caller_input_path");
    expect(receipt.normalized_result).toEqual(portable.value.normalized_result);
    const report = managedMemberInspectionSchema.parse(
      parent.normalized_result,
    );
    // The fixture declares three MemberRef rows. Paging against the produced
    // report alone would also pass if the inspector silently dropped rows.
    expect(report.member_refs.map(({ token }) => token)).toEqual([
      "0x0a000001",
      "0x0a000002",
      "0x0a000003",
    ]);
    expect(summary.summary.reported_counts.member_refs).toBe(3);
    expect(summary.summary.selection).toEqual({
      type_names: typeNames,
      unmatched_type_names: ["Missing.Type"],
    });
    expect(summary.summary.coverage).toEqual(report.coverage);
    expect(summary.summary.identity_scope).toEqual(report.identity_scope);
    expect(summary.summary.assembly).toEqual(report.assembly);
    expect(summary.summary).not.toHaveProperty("member_refs");
    expect(summary.summary).not.toHaveProperty("methods");

    await unlink(path);
    const otherDirectory = join(root, "later-process");
    await mkdir(otherDirectory);
    const pageContext = {
      cli,
      cwd: otherDirectory,
      bundlePath,
      parent,
      report,
    };
    await verifyCliFullPages(pageContext, summary.summary.reported_counts);
    await verifyCliSelection(pageContext);
    expect(await readFile(bundlePath, "utf8")).toBe(originalBytes);
  },
  180_000,
);

cliTest(
  "refuses summary without a durable destination before opening the target",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-member-summary-missing-");
    const result = await cli.run({
      arguments: [
        "inspect-managed-members",
        join(root, "absent.dll"),
        "--detail",
        "summary",
        "--json",
      ],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          expect.objectContaining({
            path: ["evidence_bundle"],
            message: expect.stringContaining("summary"),
          }),
        ],
      },
    });
    expect(result.json).not.toHaveProperty("evidence_id");
  },
);

cliTest(
  "does not replace caller files or report successful summary when bundle publication fails",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-member-summary-write-");
    const path = join(root, "fixture.dll");
    const bytes = buildManagedPeFixture();
    await writeFile(path, bytes);
    const complete = await cli.run({
      arguments: ["inspect-managed-members", path, "--json"],
    });
    expect(complete.exitCode).toBe(0);
    const parent = parseEvidence(complete.json);
    for (const destination of [path, join(root, "absent", "bundle.json")]) {
      const result = await cli.run({
        arguments: [
          "inspect-managed-members",
          path,
          "--detail",
          "summary",
          "--evidence-bundle",
          destination,
          "--json",
        ],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: {
          path: destination,
          reason: destination === path ? "exists" : "missing",
        },
      });
      const {
        error: _label,
        input_path: _inputPath,
        input_reason: _inputReason,
        ...projection
      } = analysisCliErrorEnvelopeSchema.parse(result.json);
      const failure = analysisErrorProjectionSchema.parse(projection);
      if (failure.code !== "invalid_request")
        throw new Error(`Unexpected publication failure: ${failure.code}`);
      const retained = parseEvidence(failure.details?.partial_observation);
      expect(retained.evidence_id).toBe(parent.evidence_id);
      expect(retained.normalized_result).toEqual(parent.normalized_result);
      expect(result.json).not.toHaveProperty("evidence_id");
      expect(result.json).not.toHaveProperty("normalized_result");
    }
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    expect(await readdir(root)).toEqual(["fixture.dll"]);
  },
);

cliTest(
  "preserves provider refusal without publishing an Evidence bundle",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-member-summary-provider-");
    const path = join(root, "absent.dll");
    const destination = join(root, "bundle.json");
    const complete = await cli.run({
      arguments: ["inspect-managed-members", path, "--json"],
    });
    const summary = await cli.run({
      arguments: [
        "inspect-managed-members",
        path,
        "--detail",
        "summary",
        "--evidence-bundle",
        destination,
        "--json",
      ],
    });
    expect(complete.exitCode).toBe(1);
    expect(summary.exitCode).toBe(1);
    expect(summary.json).toEqual(complete.json);
    await expect(readFile(destination)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

cliTest(
  "keeps unavailable managed member coverage explicit in saved summary Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-member-summary-unknown-");
    const path = join(root, "malformed.dll");
    const destination = join(root, "bundle.json");
    await writeFile(path, buildManagedPeFixture({ virtualSectionSize: 0 }));
    const result = await cli.run({
      arguments: [
        "inspect-managed-members",
        path,
        "--detail",
        "summary",
        "--evidence-bundle",
        destination,
        "--json",
      ],
    });
    expect(result.exitCode).toBe(0);
    const summary = managedMemberSummaryViewResultSchema.parse(
      parseEvidence(result.json).normalized_result,
    );
    expect(summary.summary).toMatchObject({
      metadata: { status: "malformed" },
      coverage: { state: "unavailable" },
      reported_counts: { methods: 0 },
    });
    expect(summary.unknowns.length).toBeGreaterThan(0);
    const bundle = parseEvidenceBundle(
      JSON.parse(await readFile(destination, "utf8")),
    );
    const report = managedMemberInspectionSchema.parse(
      bundle.records[0]!.normalized_result,
    );
    expect(summary.summary.coverage).toEqual(report.coverage);
    expect(summary.limitations).toEqual(report.limitations);
  },
);

cliTest(
  "preserves decoded CIL and reports invalid LocalVarSigTok through CLI Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-member-locals-token-");
    const path = join(root, "fixture.dll");
    const body = Buffer.alloc(13);
    body.writeUInt16LE(0x3003, 0);
    body.writeUInt16LE(8, 2);
    body.writeUInt32LE(1, 4);
    body.writeUInt32LE(0x06000001, 8);
    body[12] = 0x2a;
    await writeFile(path, buildManagedPeFixture({ ilBody: body }));

    const result = await cli.run({
      arguments: ["inspect-managed-members", path, "--json"],
    });
    expect(result.exitCode).toBe(0);
    const evidence = parseEvidence(result.json);
    const inspection = managedMemberInspectionSchema.parse(
      evidence.normalized_result,
    );
    expect(inspection.methods[0]?.body).toMatchObject({
      status: "malformed",
      local_var_sig_token: "0x06000001",
      anchors: [expect.objectContaining({ opcode: "ret" })],
    });
    expect(inspection.coverage).toMatchObject({
      state: "partial",
      issues: [expect.objectContaining({ code: "invalid-row" })],
    });
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
  "keeps a committed receipt when $signal ($delivery) is queued during final cleanup",
  async ({ signal, status, delivery }, { cli }) => {
    const root = await createTestTempDirectory("rea-managed-queued-signal-");
    const target = join(root, "fixture.dll");
    const destination = join(root, "parent.json");
    const marker = join(root, "signal.json");
    const preload = resolve("tests/fixtures/evidencePublicationPreload.mjs");
    const prefix = join(await realpath(root), ".rea-write-");
    await writeFile(target, memberFixture());
    const reply = await cli.run({
      cwd: root,
      arguments: [
        "inspect-managed-members",
        target,
        "--type",
        "Fixture.Program",
        "--detail",
        "summary",
        "--evidence-bundle",
        destination,
        "--json",
      ],
      environment: {
        HOME: root,
        REA_LOG_LEVEL: "silent",
        REA_TEST_EVIDENCE_PUBLICATION: JSON.stringify({
          prefix,
          marker,
          signal,
          delivery,
        }),
        NODE_OPTIONS: `--max-old-space-size=2048 --import=${pathToFileURL(preload).href}`,
      },
    });
    expect(reply.exitCode).toBe(status);
    const { error: _label, ...projection } =
      analysisCliErrorEnvelopeSchema.parse(reply.json);
    const error = analysisErrorProjectionSchema.parse(projection);
    expect(error.code).toBe("cancelled");
    expect(error.details?.operation).toBe("inspect_managed_members");
    const bytes = await readFile(destination);
    const parent = parseEvidenceBundle(JSON.parse(bytes.toString()))
      .records[0]!;
    expect(error.details).toMatchObject({
      diagnostics: {
        evidence_bundle: { path: destination, bytes: bytes.length },
      },
    });
    const partial = parseEvidence(error.details?.partial_observation);
    expect(partial.evidence_links).toEqual([parent.evidence_id]);
    expect(partial.normalized_result).toMatchObject({
      kind: "summary",
      parent_evidence_id: parent.evidence_id,
    });
    expect(JSON.parse(await readFile(marker, "utf8"))).toMatchObject({
      signal,
      listeners: expect.any(Number),
    });
    expect(
      JSON.parse(await readFile(marker, "utf8")).listeners,
    ).toBeGreaterThan(0);
    expect(
      (await readdir(root)).some((name) => name.startsWith(".rea-write-")),
    ).toBe(false);
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
  "retains complete default Evidence when $signal ($delivery) is queued during sealing",
  async ({ signal, status, delivery }, { cli }) => {
    const root = await createTestTempDirectory("rea-managed-complete-signal-");
    const target = join(root, "fixture.dll"),
      marker = join(root, "signal.json");
    await writeFile(target, memberFixture());
    const preload = resolve(
      "tests/fixtures/evidenceCompletionSignalPreload.mjs",
    );
    const reply = await cli.run({
      arguments: [
        "inspect-managed-members",
        target,
        "--type",
        "Fixture.Program",
        "--json",
      ],
      environment: {
        HOME: root,
        REA_LOG_LEVEL: "silent",
        REA_TEST_EVIDENCE_COMPLETION: JSON.stringify({
          operation: "inspect_managed_members",
          target_path: target,
          marker,
          signal,
          delivery,
        }),
        NODE_OPTIONS: `--max-old-space-size=2048 --import=${pathToFileURL(preload).href}`,
      },
    });
    expect(reply.exitCode).toBe(status);
    const { error: _label, ...projection } =
      analysisCliErrorEnvelopeSchema.parse(reply.json);
    const error = analysisErrorProjectionSchema.parse(projection);
    expect(error.code).toBe("cancelled");
    expect(error.details?.operation).toBe("inspect_managed_members");
    const partial = parseEvidence(error.details?.partial_observation);
    expect(partial.operation).toBe("inspect_managed_members");
    expect(partial.subject?.local_path).toBe(target);
    expect(
      managedMemberInspectionSchema.parse(partial.normalized_result).methods,
    ).toHaveLength(2);
    const proof = JSON.parse(await readFile(marker, "utf8"));
    expect(proof).toMatchObject({
      evidence_id: partial.evidence_id,
      signal,
      delivery,
    });
    expect(proof.listeners).toBeGreaterThan(0);
    expect((await readdir(root)).sort()).toEqual([
      "fixture.dll",
      "signal.json",
    ]);
  },
);
