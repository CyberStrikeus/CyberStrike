import { expect, it } from "vitest";

import { AdbDeviceAnalysisService } from "./AdbDeviceAnalysisService.js";
import type { AdbDeviceAnalysisPort } from "./AdbDeviceAnalysisPort.js";
import { createAnalysisExecution } from "../AnalysisProvider.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import { parseEvidence } from "../../domain/evidence.js";
import { ok } from "../../domain/result.js";

const identity = { id: "adb", name: "Android Debug Bridge", version: null };

const execution = createAnalysisExecution(
  {
    client: {
      binary_path: "/usr/bin/adb",
      path_source: "path",
      version: "34.0.5-debian",
      installed_path: "/usr/bin/adb",
    },
    devices: [],
    may_have_started_adb_server: false,
  },
  identity,
);

const refusedPort: AdbDeviceAnalysisPort = {
  async inspectAvailability() {
    throw new Error("must not probe");
  },
  async close() {},
  async execute() {
    throw new Error("must not execute");
  },
};

it.each([
  [{}],
  [{ serial: "" }],
  [{ serial: "has space" }],
  [{ serial: "emulator-5554", scope: "unknown" }],
  [{ serial: "emulator-5554", extra: true }],
])("rejects invalid device selection before any effect: %j", async (input) => {
  const service = new AdbDeviceAnalysisService(refusedPort);
  expect(await service.execute("inspect_adb_device", input)).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError" },
  });
});

it("rejects an unknown operation before any effect", async () => {
  const service = new AdbDeviceAnalysisService(refusedPort);
  const result = await service.execute("unknown_adb_operation" as never, {});
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected an unknown operation refusal");
  expect(result.error).toBeInstanceOf(AnalysisInputError);
  if (!(result.error instanceof AnalysisInputError)) throw result.error;
  expect(result.error.operation).toBe("unknown_adb_operation");
  expect(result.error.issues).toContainEqual(
    expect.objectContaining({ path: ["operation"] }),
  );
});

it("composes observed Evidence with the caller parameters inline", async () => {
  const port: AdbDeviceAnalysisPort = {
    async inspectAvailability() {
      return { status: "available", code: null, reason: null, diagnostics: {} };
    },
    async close() {},
    async execute(request) {
      expect(request).toEqual({
        operation: "list_adb_devices",
        input: {},
      });
      return ok(execution);
    },
  };
  const result = await new AdbDeviceAnalysisService(port).execute(
    "list_adb_devices",
    {},
  );
  if (!result.ok) throw new Error(result.error.message);
  const evidence = parseEvidence(result.value);
  expect(evidence.provider).toEqual(identity);
  expect(evidence.operation).toBe("list_adb_devices");
  expect(evidence.parameters).toEqual({});
  expect(evidence.confidence).toBe("observed");
});

it("preserves cancellation before execution", async () => {
  const controller = new AbortController();
  const cancellationReason = { source: "caller", operation: "shutdown" };
  controller.abort(cancellationReason);
  const service = new AdbDeviceAnalysisService(refusedPort);
  const result = await service.execute(
    "list_adb_devices",
    {},
    {
      signal: controller.signal,
    },
  );
  if (result.ok) throw new Error("Expected cancellation before execution");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(cancellationReason);
});
