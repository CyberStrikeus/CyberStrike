import { expect, it } from "vitest";
import { createEvidence } from "../../domain/evidence.js";
import {
  analysisViewResultSchema,
  inspectAnalysisViewInputSchema,
} from "../../domain/analysisView/analysisView.js";
import { projectNativeLoadImageView } from "../../domain/analysisView/nativeLoadImageView.js";
import type { NativeLoadImage } from "../../domain/native/nativeLoadImage.js";
import {
  nativeDosLoadImageFixture,
  nativeLoadImageObservationFixture,
} from "../../../tests/fixtures/nativeLoadImage.js";
import { inspectAnalysisView } from "./AnalysisViewService.js";

const source = (): Extract<NativeLoadImage, { status: "unsupported" }> => ({
  status: "unsupported",
  reason:
    "ELF load observations have no independent verification in this fixture.",
  observations: {
    ...nativeLoadImageObservationFixture(),
    executable_format: "Executable and Linking Format (ELF)",
    relocations: [
      {
        address: "ram:0x0010",
        segment: null,
        offset: null,
        status: "APPLIED",
        type: 8,
        values: [16],
        original_bytes_hex: "0000",
        memory_bytes_hex: "1000",
      },
      {
        address: "ram:0x0010",
        segment: null,
        offset: null,
        status: "UNSUPPORTED",
        type: 9,
        values: [],
        original_bytes_hex: null,
        memory_bytes_hex: null,
      },
    ],
  },
  limitations: [
    "Load observations do not establish runtime relocation behavior.",
  ],
});
const evidence = (report: NativeLoadImage) =>
  createEvidence(
    { path: "/selected/fixture", sha256: "a".repeat(64), format: "elf" },
    { id: "ghidra", name: "Ghidra", version: "12.1.4" },
    {
      operation: "inspect_native_load_image",
      parameters: {},
      result: report,
      limitations: ["Provider observation remains historical."],
    },
    { immutable: true },
  );
const view = async (report: NativeLoadImage, request: unknown) => {
  const result = await inspectAnalysisView({
    source: { kind: "inline", evidence: evidence(report) },
    view: request,
  });
  if (!result.ok) throw result.error;
  return analysisViewResultSchema.parse(result.value.normalized_result);
};

it("summarizes measured ELF facts without upgrading unsupported verification", async () => {
  const report = source();
  const parent = evidence(report);
  const summary = await view(report, { kind: "summary" });
  expect(summary).toMatchObject({
    parent_evidence_id: parent.evidence_id,
    parent_operation: "inspect_native_load_image",
    source_provider: parent.provider,
    source_analysis_profile_digest: null,
    source_parameters: {},
    artifact: { path: "/selected/fixture", sha256: "a".repeat(64) },
    summary: {
      verification: { status: "unsupported", reason: report.reason },
      observation: {
        executable_format: "Executable and Linking Format (ELF)",
      },
      counts: {
        relocations: 2,
        checks: null,
        sections: null,
        metadata_recovery: null,
      },
    },
    limitations: expect.arrayContaining([
      ...report.limitations,
      "Provider observation remains historical.",
    ]),
    unknowns: expect.arrayContaining([report.reason]),
  });
  expect(JSON.stringify(summary)).not.toContain("memory_bytes_hex");
});

it("preserves same-address alternatives, padding, nulls and byte facts over pages", async () => {
  const report = source();
  const records = [];
  for (let offset = 0; offset < 2; offset++) {
    const page = await view(report, {
      kind: "native-load-image",
      collection: "relocations",
      fields: [
        "address",
        "segment",
        "offset",
        "status",
        "type",
        "values",
        "original_bytes_hex",
        "memory_bytes_hex",
      ],
      offset,
      limit: 1,
    });
    if (page.kind !== "native-load-image") throw new Error("Expected page");
    expect(page.verification_status).toBe("unsupported");
    expect(
      analysisViewResultSchema.safeParse({
        ...page,
        items: {
          ...page.items,
          rows: null,
        },
      }).success,
    ).toBe(false);
    expect(page.items.rows?.[0]?.source_index).toBe(offset);
    expect(page.coverage).toMatchObject({
      total: 2,
      next_offset: offset === 0 ? 1 : null,
      exhausted: offset === 1,
    });
    records.push(...(page.items.rows ?? []).map((row) => row.record));
  }
  expect(records).toEqual(report.observations.relocations);
});

it("filters indices before paging and projects only selected fields", async () => {
  const page = await view(source(), {
    kind: "native-load-image",
    collection: "relocations",
    indices: [1, 400, 0, 1],
    offset: 1,
    fields: ["address", "status", "status"],
    limit: 1,
  });
  expect(page).toMatchObject({
    items: {
      collection: "relocations",
      rows: [
        {
          source_index: 1,
          record: { address: "ram:0x0010", status: "UNSUPPORTED" },
        },
      ],
    },
    coverage: { examined: 1, total: 2, next_offset: null, exhausted: true },
  });
  if (page.kind !== "native-load-image") throw new Error("Expected page");
  expect(page.items.rows?.[0]?.record).toEqual({
    address: "ram:0x0010",
    status: "UNSUPPORTED",
  });
});

it.each(["checks", "sections"])(
  "keeps unrecorded or inapplicable %s null rather than inventing empty observations",
  async (collection) => {
    expect(
      await view(source(), { kind: "native-load-image", collection }),
    ).toMatchObject({
      items: { collection, rows: null },
      unknowns: expect.arrayContaining([
        "Null collection counts or rows mean not recorded or not applicable, not observed absence.",
      ]),
    });
  },
);

it("distinguishes an explicitly recorded empty metadata collection and exhausted selection", async () => {
  const report = source();
  report.observations.metadata_recovery = [];
  expect(await view(report, { kind: "summary" })).toMatchObject({
    summary: { counts: { metadata_recovery: 0 } },
  });
  for (const request of [
    { collection: "entry_context" },
    { collection: "relocations", indices: [] },
    { collection: "relocations", offset: 400 },
  ])
    expect(
      await view(report, { kind: "native-load-image", ...request }),
    ).toMatchObject({
      items: { rows: [] },
      coverage: { status: "empty", exhausted: true, next_offset: null },
    });
});

it("preserves recorded DOS verification details and ordered mismatch checks", async () => {
  const report = nativeDosLoadImageFixture();
  const summary = await view(report, { kind: "summary" });
  expect(summary).toMatchObject({
    summary: {
      verification: {
        status: "verified",
        format: "dos-mz",
        target_sha256: report.target_sha256,
      },
      counts: { checks: report.checks.length },
    },
  });
  const mismatch = {
    ...report,
    status: "mismatch" as const,
    checks: [
      {
        ...report.checks[0]!,
        matched: false,
        expected: { original: 1 },
        observed: null,
      },
    ],
  };
  expect(
    await view(mismatch, {
      kind: "native-load-image",
      collection: "checks",
      fields: [
        "name",
        "matched",
        "expected",
        "observed",
        "file_offset",
        "address",
      ],
    }),
  ).toMatchObject({
    items: { rows: [{ source_index: 0, record: mismatch.checks[0] }] },
  });
  expect(await view(mismatch, { kind: "summary" })).toMatchObject({
    summary: { verification: { status: "mismatch" } },
  });
});

it("keeps byte and potentially large comparison payloads opt-in while retaining full source facts", async () => {
  const relocations = await view(source(), {
    kind: "native-load-image",
    collection: "relocations",
  });
  if (relocations.kind !== "native-load-image")
    throw new Error("Expected page");
  expect(relocations.items.rows?.[0]?.record).toEqual({
    address: "ram:0x0010",
    segment: null,
    offset: null,
    status: "APPLIED",
    type: 8,
    values: [16],
  });
  const report = nativeDosLoadImageFixture();
  const body = { complete_comparison: "retained proof body".repeat(128) };
  report.checks[0]!.expected = body;
  const checks = await view(report, {
    kind: "native-load-image",
    collection: "checks",
  });
  if (checks.kind !== "native-load-image") throw new Error("Expected page");
  expect(checks.items.rows?.[0]?.record).toEqual({
    name: "original_file_sha256",
    matched: true,
    file_offset: null,
    address: null,
  });
  expect(
    await view(report, {
      kind: "native-load-image",
      collection: "checks",
      fields: ["expected"],
    }),
  ).toMatchObject({
    items: { rows: [{ source_index: 0, record: { expected: body } }] },
  });
  expect(report.checks[0]!.expected).toEqual(body);
});

it("rejects collection-inapplicable fields and malformed sibling facts even for an empty selection", async () => {
  expect(
    inspectAnalysisViewInputSchema.safeParse({
      source: { kind: "inline", evidence: evidence(source()) },
      view: {
        kind: "native-load-image",
        collection: "entry_points",
        fields: ["original_bytes_hex"],
      },
    }).success,
  ).toBe(false);
  const report = source();
  const parent = {
    evidenceId: "ev_" + "b".repeat(64),
    operation: "inspect_native_load_image",
    normalizedResult: report,
    limitations: [],
  };
  const request = {
    kind: "native-load-image" as const,
    collection: "relocations" as const,
    indices: [],
    offset: 0,
    limit: 1,
  };
  expect(projectNativeLoadImageView(parent, request).ok).toBe(true);
  Reflect.set(report.observations.relocations[1]!, "status", "");
  expect(projectNativeLoadImageView(parent, request).ok).toBe(false);
});
