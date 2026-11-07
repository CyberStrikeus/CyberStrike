import { expect, it } from "vitest";
import { BinaryLayoutService } from "./BinaryLayoutService.js";
import {
  binaryLayoutFixture,
  BINARY_LAYOUT_TEST_PROVIDER,
} from "../../../tests/fixtures/binaryDiagnostics/layout.js";
import { AnalysisCapabilityUnavailableError } from "../../domain/analysisErrorCore.js";
import { parseEvidence } from "../../domain/evidence.js";
import { err, ok } from "../../domain/result.js";

it.each([
  { path: "relative.elf" },
  { path: "/selected.elf", approval: true },
  { path: 123 },
  {},
])(
  "rejects malformed selection before starting the provider: %j",
  async (input) => {
    const service = new BinaryLayoutService({
      inspectAndClose(input, options) {
        return this.inspect(input, options);
      },
      identity: BINARY_LAYOUT_TEST_PROVIDER,
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

it("records the decoded layout once in its Evidence", async () => {
  const layout = binaryLayoutFixture();
  const service = new BinaryLayoutService({
    inspectAndClose(input, options) {
      return this.inspect(input, options);
    },
    identity: BINARY_LAYOUT_TEST_PROVIDER,
    inspect: () => Promise.resolve(ok(layout)),
  });
  const result = await service.inspect({ path: layout.artifact.path });
  if (!result.ok) throw result.error;
  const evidence = parseEvidence(result.value);
  expect(evidence.normalized_result).toEqual(layout);
  expect(evidence.raw_result).toBeNull();
});

it.each([
  [{ machine: "EM_X86_64", bits: 64, byte_order: "little" }, "x86_64"],
  [{ machine: "EM_386", bits: 32, byte_order: "little" }, "x86"],
  [{ machine: "EM_ARM", bits: 32, byte_order: "little" }, "arm"],
  [{ machine: "EM_MIPS", bits: 32, byte_order: "big" }, "mips"],
] as const)(
  "names the reported %j machine in its Evidence subject",
  async (architecture, expected) => {
    const layout = { ...binaryLayoutFixture(), architecture };
    const service = new BinaryLayoutService({
      inspectAndClose(input, options) {
        return this.inspect(input, options);
      },
      identity: BINARY_LAYOUT_TEST_PROVIDER,
      inspect: () => Promise.resolve(ok(layout)),
    });
    const result = await service.inspect({ path: layout.artifact.path });
    if (!result.ok) throw result.error;
    expect(parseEvidence(result.value).subject?.architecture).toBe(expected);
  },
);

it("preserves a provider's actionable unsupported reason", async () => {
  const failure = new AnalysisCapabilityUnavailableError(
    "fixture-layout",
    "inspect_binary_layout",
    "ELF core belongs to recorded-crash analysis.",
  );
  const service = new BinaryLayoutService({
    inspectAndClose(input, options) {
      return this.inspect(input, options);
    },
    identity: BINARY_LAYOUT_TEST_PROVIDER,
    inspect: () => Promise.resolve(err(failure)),
  });
  expect(await service.inspect({ path: "/source.elf" })).toEqual(err(failure));
});

it("preserves the caller's exact abort reason before invocation", async () => {
  const controller = new AbortController();
  const reason = Object.freeze({ requested: "layout-stop" });
  controller.abort(reason);
  let calls = 0;
  const service = new BinaryLayoutService({
    inspectAndClose(input, options) {
      return this.inspect(input, options);
    },
    identity: BINARY_LAYOUT_TEST_PROVIDER,
    inspect: () => {
      calls++;
      return Promise.resolve(ok(binaryLayoutFixture()));
    },
  });
  const result = await service.inspect(
    { path: "/artifacts/source-owned.elf" },
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
  const service = new BinaryLayoutService({
    inspectAndClose(input, options) {
      return this.inspect(input, options);
    },
    identity: BINARY_LAYOUT_TEST_PROVIDER,
    inspect: () => {
      controller.abort();
      return Promise.resolve(ok(binaryLayoutFixture()));
    },
  });
  const late = await service.inspect(
    { path: "/artifacts/source-owned.elf" },
    { signal: controller.signal },
  );
  expect(late).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      capturedOutput: binaryLayoutFixture().diagnostics,
      partialObservation: {
        operation: "inspect_binary_layout",
        normalized_result: binaryLayoutFixture(),
      },
    },
  });
  if (!late.ok) {
    expect(parseEvidence(late.error.partialObservation)).toMatchObject({
      operation: "inspect_binary_layout",
      normalized_result: binaryLayoutFixture(),
    });
  }
});

it.each(["different-path", "invalid-digest", "outside-range"])(
  "rejects provider evidence at the next boundary: %s",
  async (problem) => {
    const fixture = binaryLayoutFixture();
    if (problem === "different-path") fixture.artifact.path = "/different.elf";
    if (problem === "invalid-digest") fixture.artifact.sha256 = "unobserved";
    if (problem === "outside-range")
      fixture.segments.push({
        index: 0,
        type: "PT_LOAD",
        offset: "0x80",
        header_location: { offset: "0x0", bytes: "0x38" },
        file_backing: "file",
        file_size: "0x1",
        memory_size: "0x1",
        virtual_address: "0x20000000000001",
        physical_address: "0x0",
        alignment: "0x1",
        flags: "0x5",
        permissions: { read: true, write: false, execute: true },
      });
    const service = new BinaryLayoutService({
      inspectAndClose(input, options) {
        return this.inspect(input, options);
      },
      identity: BINARY_LAYOUT_TEST_PROVIDER,
      inspect: () => Promise.resolve(ok(fixture)),
    });
    expect(
      await service.inspect({ path: "/artifacts/source-owned.elf" }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisOutputError",
        capturedOutput: fixture.diagnostics,
      },
    });
    const controller = new AbortController();
    const lateInvalid = await new BinaryLayoutService({
      inspectAndClose(input, options) {
        return this.inspect(input, options);
      },
      identity: BINARY_LAYOUT_TEST_PROVIDER,
      inspect: () => {
        controller.abort();
        return Promise.resolve(ok(fixture));
      },
    }).inspect(
      { path: "/artifacts/source-owned.elf" },
      { signal: controller.signal },
    );
    expect(lateInvalid).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisOutputError" },
    });
  },
);
