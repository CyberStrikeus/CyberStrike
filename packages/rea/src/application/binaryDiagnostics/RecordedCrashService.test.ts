import { expect, it } from "vitest";
import { RecordedCrashService } from "./RecordedCrashService.js";
import {
  recordedCrashFixture,
  RECORDED_CRASH_TEST_PROVIDER,
  recordedCrashDebuggerFixture,
} from "../../../tests/fixtures/binaryDiagnostics/recordedCrash.js";
import { parseEvidence } from "../../domain/evidence.js";
import { AnalysisCapabilityUnavailableError } from "../../domain/analysisErrorCore.js";
import { err, ok } from "../../domain/result.js";

it("labels an envelope containing debugger-derived maps as derived", async () => {
  const fixture = recordedCrashFixture();
  fixture.debugger = recordedCrashDebuggerFixture();
  const service = new RecordedCrashService({
    inspectAndClose(input, options) {
      return this.inspect(input, options);
    },
    identity: RECORDED_CRASH_TEST_PROVIDER,
    inspect: () => Promise.resolve(ok(fixture)),
  });
  const result = await service.inspect({
    path: fixture.artifact.path,
    include_debugger_context: true,
  });
  if (!result.ok) throw result.error;
  const evidence = parseEvidence(result.value);
  expect(evidence.confidence).toBe("derived");
  expect(evidence.normalized_result).toEqual(fixture);
  expect(evidence.raw_result).toBeNull();
});

it.each([
  ["x86_64-little-endian", "x86_64"],
  ["aarch64-little-endian", "arm64"],
] as const)(
  "names the CPU family carried by a %s core on created Evidence",
  async (architecture, expected) => {
    const fixture = recordedCrashFixture("/selected.core", architecture);
    const service = new RecordedCrashService({
      inspectAndClose(input, options) {
        return this.inspect(input, options);
      },
      identity: RECORDED_CRASH_TEST_PROVIDER,
      inspect: () => Promise.resolve(ok(fixture)),
    });
    const result = await service.inspect({
      path: fixture.artifact.path,
      include_debugger_context: false,
    });
    if (!result.ok) throw result.error;
    expect(parseEvidence(result.value).subject?.architecture).toBe(expected);
  },
);

it.each([
  { path: "relative.elf" },
  { path: "/selected.core", approval: true },
  { path: 123 },
  {},
])(
  "rejects malformed selection before starting the provider: %j",
  async (input) => {
    const service = new RecordedCrashService({
      inspectAndClose(input, options) {
        return this.inspect(input, options);
      },
      identity: RECORDED_CRASH_TEST_PROVIDER,
      inspect: () => {
        throw new Error("must not run");
      },
    });
    const result = await service.inspect(input);
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
    if (input.path === "relative.elf")
      expect(result).toMatchObject({
        ok: false,
        error: {
          issues: [{ path: ["path"], reason: "invalid_format" }],
        },
      });
  },
);

it("preserves a provider's actionable unsupported reason", async () => {
  const failure = new AnalysisCapabilityUnavailableError(
    "fixture-recorded-crash",
    "inspect_recorded_crash",
    "ELF core belongs to recorded-crash analysis.",
  );
  const service = new RecordedCrashService({
    inspectAndClose(input, options) {
      return this.inspect(input, options);
    },
    identity: RECORDED_CRASH_TEST_PROVIDER,
    inspect: () => Promise.resolve(err(failure)),
  });
  expect(await service.inspect({ path: "/source.elf" })).toEqual(err(failure));
});

it("preserves the caller's exact abort reason before invocation", async () => {
  const controller = new AbortController();
  const reason = Object.freeze({ requested: "crash-stop" });
  controller.abort(reason);
  let calls = 0;
  const service = new RecordedCrashService({
    inspectAndClose(input, options) {
      return this.inspect(input, options);
    },
    identity: RECORDED_CRASH_TEST_PROVIDER,
    inspect: () => {
      calls++;
      return Promise.resolve(ok(recordedCrashFixture()));
    },
  });
  const result = await service.inspect(
    { path: "/artifacts/source-owned.core" },
    { signal: controller.signal },
  );
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(result.ok ? undefined : result.error.cause).toBe(reason);
  expect(calls).toBe(0);
});

it("retains the acquired observation when cancellation arrives during inspection", async () => {
  const controller = new AbortController();
  const service = new RecordedCrashService({
    inspectAndClose(input, options) {
      return this.inspect(input, options);
    },
    identity: RECORDED_CRASH_TEST_PROVIDER,
    inspect: () => {
      controller.abort();
      return Promise.resolve(ok(recordedCrashFixture()));
    },
  });
  const late = await service.inspect(
    { path: "/artifacts/source-owned.core" },
    { signal: controller.signal },
  );
  expect(late).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      capturedOutput: recordedCrashFixture().diagnostics,
      partialObservation: {
        operation: "inspect_recorded_crash",
        normalized_result: recordedCrashFixture(),
      },
    },
  });
  if (!late.ok) {
    expect(parseEvidence(late.error.partialObservation)).toMatchObject({
      operation: "inspect_recorded_crash",
      normalized_result: recordedCrashFixture(),
    });
  }
});

it.each([
  "different-path",
  "invalid-digest",
  "outside-range",
  "owner-base64",
  "descriptor-base64",
])("rejects provider evidence at the next boundary: %s", async (problem) => {
  const fixture = recordedCrashFixture();
  if (problem === "different-path") fixture.artifact.path = "/different.elf";
  if (problem === "invalid-digest") fixture.artifact.sha256 = "unobserved";
  if (problem === "owner-base64") fixture.notes[0]!.owner_bytes_base64 = "A";
  if (problem === "descriptor-base64")
    fixture.notes[0]!.descriptor_bytes_base64 = "A";
  if (problem === "outside-range")
    fixture.segments.push({
      index: 0,
      type: "PT_LOAD",
      type_id: 1,
      offset: "0x200",
      header_location: { offset: "0x0", bytes: "0x38" },
      file_backing: "file",
      file_size: "0x1",
      memory_size: "0x1",
      virtual_address: "0x20000000000001",
      physical_address: "0x0",
      alignment: "0x1",
      flags: "0x5",
    });
  const service = new RecordedCrashService({
    inspectAndClose(input, options) {
      return this.inspect(input, options);
    },
    identity: RECORDED_CRASH_TEST_PROVIDER,
    inspect: () => Promise.resolve(ok(fixture)),
  });
  expect(
    await service.inspect({ path: "/artifacts/source-owned.core" }),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisOutputError",
      capturedOutput: fixture.diagnostics,
    },
  });
  const controller = new AbortController();
  const lateInvalid = await new RecordedCrashService({
    inspectAndClose(input, options) {
      return this.inspect(input, options);
    },
    identity: RECORDED_CRASH_TEST_PROVIDER,
    inspect: () => {
      controller.abort();
      return Promise.resolve(ok(fixture));
    },
  }).inspect(
    { path: "/artifacts/source-owned.core" },
    { signal: controller.signal },
  );
  expect(lateInvalid).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisOutputError" },
  });
});
