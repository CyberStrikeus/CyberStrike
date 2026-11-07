import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { PeResourcesService } from "./PeResourcesService.js";
import { PE_RESOURCES_PROVIDER } from "../../domain/investigationProviders.js";
import { inspectPeResourcesInputSchema } from "../../domain/native/peResources.js";
import { parsePeResources } from "../../native/pe/PeResourceParser.js";
import { peResourceFixture } from "../../native/pe/PeResources.fixture.js";
import { ok } from "../../domain/result.js";
import { parseEvidence } from "../../domain/evidence.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";

const observedReport = () => {
  const { bytes } = peResourceFixture();
  return parsePeResources(
    bytes,
    {
      path: "/fixtures/example.exe",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    inspectPeResourcesInputSchema.parse({ path: "/fixtures/example.exe" }),
  );
};

it.each([
  "different-path",
  "outside-range",
  "wrong-coverage",
  "bad-icon-reference",
  "mismatched-directory-path",
  "outside-directory-entry",
  "outside-directory-name",
])(
  "rejects invalid provider output before creating Evidence: %s",
  async (problem) => {
    const report = await observedReport();
    if (problem === "different-path") report.artifact.path = "/other.exe";
    if (problem === "outside-range")
      report.resources[0]!.payload.location.offset = report.artifact.bytes;
    if (problem === "wrong-coverage") report.coverage.resources = 99;
    if (problem === "bad-icon-reference")
      report.icon_groups[0]!.images[0]!.candidate_resource_indices = [999];
    if (problem === "mismatched-directory-path")
      report.directories[1]!.path = [];
    if (problem === "outside-directory-entry")
      report.directories[1]!.entry_locations[0] = {
        offset: report.artifact.bytes,
        bytes: 8,
      };
    if (problem === "outside-directory-name") {
      const directory = report.directories.find(
        (item) => item.path[1]?.kind === "name",
      );
      const identity = directory?.path[1];
      if (directory === undefined || identity?.kind !== "name")
        throw new Error("Missing named directory fixture");
      directory.path[1] = {
        ...identity,
        location: { offset: report.artifact.bytes, bytes: 2 },
      };
    }
    const service = new PeResourcesService({
      identity: PE_RESOURCES_PROVIDER,
      inspect: () => Promise.resolve(ok(report)),
    });
    expect(
      await service.inspect({ path: "/fixtures/example.exe" }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
  },
);

it.each([
  ["i386 PE32", 0x014c, "pe32", "x86"],
  ["AMD64 PE32+", 0x8664, "pe32-plus", "x86_64"],
  ["ARM PE32", 0x01c0, "pe32", "arm"],
  ["Thumb PE32", 0x01c2, "pe32", "arm"],
  ["ARMNT PE32", 0x01c4, "pe32", "arm"],
  ["ARM64 PE32+", 0xaa64, "pe32-plus", "arm64"],
  ["AMD64 machine with PE32 magic", 0x8664, "pe32", null],
  ["i386 machine with PE32+ magic", 0x014c, "pe32-plus", null],
  ["ReadyToRun Linux override", 0x8664 ^ 0x7b79, "pe32-plus", null],
  ["unknown machine", 0x01f0, "pe32", null],
] as const)(
  "names the subject architecture from the COFF machine: %s",
  async (_case, machine, format, architecture) => {
    const report = await observedReport();
    report.machine = machine;
    report.format = format;
    const service = new PeResourcesService({
      identity: PE_RESOURCES_PROVIDER,
      inspect: () => Promise.resolve(ok(report)),
    });
    const result = await service.inspect({ path: report.artifact.path });
    if (!result.ok) throw result.error;
    expect(result.value.subject?.architecture ?? null).toBe(architecture);
  },
);

it("retains a completed observation on late cancellation and keeps output errors primary", async () => {
  const report = await observedReport();
  const controller = new AbortController();
  const reason = { request: "late PE cancellation" };
  const service = new PeResourcesService({
    identity: PE_RESOURCES_PROVIDER,
    inspect: () => {
      controller.abort(reason);
      return Promise.resolve(ok(report));
    },
  });
  const late = await service.inspect(
    { path: report.artifact.path },
    { signal: controller.signal },
  );
  expect(late).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  if (!late.ok) {
    expect(late.error.cause).toBe(reason);
    expect(parseEvidence(late.error.partialObservation)).toMatchObject({
      operation: "inspect_pe_resources",
      subject: { architecture: "x86" },
      normalized_result: report,
    });
  }

  const malformed = await observedReport();
  malformed.artifact.path = "/other.exe";
  const outputController = new AbortController();
  const invalid = await new PeResourcesService({
    identity: PE_RESOURCES_PROVIDER,
    inspect: () => {
      outputController.abort();
      return Promise.resolve(ok(malformed));
    },
  }).inspect(
    { path: "/fixtures/example.exe" },
    { signal: outputController.signal },
  );
  expect(invalid.ok).toBe(false);
  if (!invalid.ok) expect(invalid.error).toBeInstanceOf(AnalysisOutputError);
});

it.each([
  null,
  "caller cancellation",
  { request: "opaque caller value" },
  new Error("caller failure"),
  new AnalysisOutputError("caller_operation", "caller-owned cleanup", {
    cleanup: {
      reason: "unresolved caller resource",
      resources: ["caller resource"],
    },
  }),
])(
  "preserves an opaque admission cancellation reason without invoking the reader: %j",
  async (reason) => {
    const controller = new AbortController();
    controller.abort(reason);
    let calls = 0;
    const service = new PeResourcesService({
      identity: PE_RESOURCES_PROVIDER,
      inspect: async () => {
        calls += 1;
        throw new Error("cancelled admission must not invoke the reader");
      },
    });
    const result = await service.inspect(null, { signal: controller.signal });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected cancelled admission");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.partialObservation).toBeUndefined();
    expect(calls).toBe(0);
    if (reason instanceof AnalysisOutputError)
      expect(reason.cleanupIncomplete).toBe(true);
  },
);
