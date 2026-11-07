import { expect, it } from "vitest";
import { ok } from "../../src/domain/result.js";
import { WebNetworkCaptureService } from "../../src/application/WebNetworkCaptureService.js";
import { WebSourceLocationService } from "../../src/application/WebSourceLocationService.js";
import {
  webSourceLocationArgs,
  webSourceLocationFixture,
  webSourceMapDecoderFixture,
} from "../fixtures/webSourceLocation.js";
import { historicalHar } from "../fixtures/historicalHar.js";
import { BinaryLayoutService } from "../../src/application/binaryDiagnostics/BinaryLayoutService.js";
import {
  binaryLayoutFixture,
  BINARY_LAYOUT_TEST_PROVIDER,
} from "../fixtures/binaryDiagnostics/layout.js";
import { PeResourcesService } from "../../src/application/binaryDiagnostics/PeResourcesService.js";
import { PE_RESOURCES_PROVIDER } from "../../src/domain/investigationProviders.js";
import { inspectPeResourcesInputSchema } from "../../src/domain/native/peResources.js";
import { parsePeResources } from "../../src/native/pe/PeResourceParser.js";
import { peResourceFixture } from "../../src/native/pe/PeResources.fixture.js";
import { createHash } from "node:crypto";
import { RecordedCrashService } from "../../src/application/binaryDiagnostics/RecordedCrashService.js";
import {
  recordedCrashFixture,
  RECORDED_CRASH_TEST_PROVIDER,
} from "../fixtures/binaryDiagnostics/recordedCrash.js";
import { EvmInterfaceService } from "../../src/application/evm/EvmInterfaceService.js";
import {
  evmInterfaceExecution,
  evmInterfaceFixture,
} from "../fixtures/evm/interface.js";
import type { EvmInterfaceExecution } from "../../src/application/evm/EvmInterfacePort.js";

it("retains valid web-network observations and validates malformed ones before cancellation", async () => {
  const report = {
    decoder: { id: "fixture", name: "fixture", version: "1" },
    container: {
      reported: null,
      numeric_literals: [],
      redactions: [],
      records_pointer: "/log/entries",
    },
    total_records: 1,
    records: [
      {
        ordinal: 0,
        location: { kind: "json-pointer" as const, pointer: "/log/entries/0" },
        reported: historicalHar().log.entries[0] ?? null,
        numeric_literals: [],
        binary_fields: [],
        redactions: [],
        limitations: [],
      },
    ],
    artifact: { path: "/capture.har", sha256: "a".repeat(64), bytes: 10 },
    format: "har" as const,
    runtime_attribution: "unknown" as const,
    limitations: ["fixture"],
  };
  const controller = new AbortController();
  const valid = await new WebNetworkCaptureService({
    inspect: () => {
      controller.abort();
      return Promise.resolve(ok(report));
    },
  }).inspect(
    { capture_path: report.artifact.path, format: "har" },
    { signal: controller.signal },
  );
  expect(valid).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      partialObservation: {
        normalized_result: expect.objectContaining({
          artifact: report.artifact,
        }),
      },
    },
  });
  const malformed = {
    ...report,
    artifact: { ...report.artifact, path: "/other.har" },
  };
  const invalidController = new AbortController();
  const invalid = await new WebNetworkCaptureService({
    inspect: () => {
      invalidController.abort();
      return Promise.resolve(ok(malformed));
    },
  }).inspect(
    { capture_path: report.artifact.path, format: "har" },
    { signal: invalidController.signal },
  );
  expect(invalid).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisOutputError" },
  });
});

it("retains valid source-map traces and preserves malformed decoder output over late cancellation", async () => {
  const controller = new AbortController();
  const valid = await new WebSourceLocationService(
    { load: () => Promise.resolve(ok(webSourceLocationFixture())) },
    {
      trace: async (input) => {
        const result = await webSourceMapDecoderFixture.trace(input);
        controller.abort();
        return result;
      },
    },
  ).trace(webSourceLocationArgs, { signal: controller.signal });
  expect(valid).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      partialObservation: { operation: "trace_web_source_location" },
    },
  });
  const invalidController = new AbortController();
  const invalid = await new WebSourceLocationService(
    { load: () => Promise.resolve(ok(webSourceLocationFixture())) },
    {
      trace: async (input) => {
        const result = await webSourceMapDecoderFixture.trace(input);
        if (!result.ok) return result;
        result.value.url_context = "https://wrong.test/";
        invalidController.abort();
        return result;
      },
    },
  ).trace(webSourceLocationArgs, { signal: invalidController.signal });
  expect(invalid).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisOutputError" },
  });
});

it("retains valid binary-layout Evidence while preserving malformed output precedence", async () => {
  const controller = new AbortController();
  const layoutInspect = () => {
    controller.abort();
    return Promise.resolve(ok(binaryLayoutFixture()));
  };
  const valid = await new BinaryLayoutService({
    identity: BINARY_LAYOUT_TEST_PROVIDER,
    inspect: layoutInspect,
    inspectAndClose: layoutInspect,
  }).inspect(
    { path: "/artifacts/source-owned.elf" },
    { signal: controller.signal },
  );
  expect(valid).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      partialObservation: { operation: "inspect_binary_layout" },
    },
  });
  const invalidController = new AbortController();
  const malformed = binaryLayoutFixture();
  malformed.artifact.path = "/other.elf";
  const malformedLayoutInspect = () => {
    invalidController.abort();
    return Promise.resolve(ok(malformed));
  };
  const invalid = await new BinaryLayoutService({
    identity: BINARY_LAYOUT_TEST_PROVIDER,
    inspect: malformedLayoutInspect,
    inspectAndClose: malformedLayoutInspect,
  }).inspect(
    { path: "/artifacts/source-owned.elf" },
    { signal: invalidController.signal },
  );
  expect(invalid).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisOutputError" },
  });
});

const peReport = async () => {
  const { bytes } = peResourceFixture();
  return await parsePeResources(
    bytes,
    {
      path: "/fixtures/example.exe",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    inspectPeResourcesInputSchema.parse({ path: "/fixtures/example.exe" }),
  );
};
it("retains valid PE-resource Evidence and preserves malformed output precedence", async () => {
  const controller = new AbortController();
  const valid = await new PeResourcesService({
    identity: PE_RESOURCES_PROVIDER,
    inspect: () => {
      controller.abort();
      return peReport().then(ok);
    },
  }).inspect({ path: "/fixtures/example.exe" }, { signal: controller.signal });
  expect(valid).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      partialObservation: { operation: "inspect_pe_resources" },
    },
  });
  const invalidController = new AbortController();
  const malformed = await peReport();
  malformed.artifact.path = "/other.exe";
  const invalid = await new PeResourcesService({
    identity: PE_RESOURCES_PROVIDER,
    inspect: () => {
      invalidController.abort();
      return Promise.resolve(ok(malformed));
    },
  }).inspect(
    { path: "/fixtures/example.exe" },
    { signal: invalidController.signal },
  );
  expect(invalid).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisOutputError" },
  });
});

it("retains valid recorded-crash Evidence and preserves malformed output precedence", async () => {
  const controller = new AbortController();
  const crashInspect = () => {
    controller.abort();
    return Promise.resolve(ok(recordedCrashFixture()));
  };
  const valid = await new RecordedCrashService({
    identity: RECORDED_CRASH_TEST_PROVIDER,
    inspect: crashInspect,
    inspectAndClose: crashInspect,
  }).inspect(
    { path: "/artifacts/source-owned.core", include_debugger_context: false },
    { signal: controller.signal },
  );
  expect(valid).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      partialObservation: { operation: "inspect_recorded_crash" },
    },
  });
  const invalidController = new AbortController();
  const malformed = recordedCrashFixture();
  malformed.artifact.path = "/other.core";
  const malformedCrashInspect = () => {
    invalidController.abort();
    return Promise.resolve(ok(malformed));
  };
  const invalid = await new RecordedCrashService({
    identity: RECORDED_CRASH_TEST_PROVIDER,
    inspect: malformedCrashInspect,
    inspectAndClose: malformedCrashInspect,
  }).inspect(
    { path: "/artifacts/source-owned.core", include_debugger_context: false },
    { signal: invalidController.signal },
  );
  expect(invalid).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisOutputError" },
  });
});

it("retains valid EVM interface Evidence and preserves malformed output precedence", async () => {
  const controller = new AbortController();
  const valid = await new EvmInterfaceService({
    inspect: () => {
      controller.abort();
      return Promise.resolve(ok(evmInterfaceExecution(evmInterfaceFixture())));
    },
  }).inspect(
    { path: "/artifacts/source-owned.hex", encoding: "hex" },
    { signal: controller.signal },
  );
  expect(valid).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      partialObservation: { operation: "inspect_evm_interface" },
    },
  });
  const invalidController = new AbortController();
  const malformed = evmInterfaceFixture();
  malformed.artifact.path = "/other.hex";
  const invalid = await new EvmInterfaceService({
    inspect: () => {
      invalidController.abort();
      return Promise.resolve(
        ok(
          evmInterfaceExecution(malformed) as unknown as EvmInterfaceExecution,
        ),
      );
    },
  }).inspect(
    { path: "/artifacts/source-owned.hex", encoding: "hex" },
    { signal: invalidController.signal },
  );
  expect(invalid).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisOutputError" },
  });
});
