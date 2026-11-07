import { expect, it } from "vitest";

import { FlutterBuildAnalysisService } from "./FlutterBuildAnalysisService.js";
import type { FlutterBuildAnalysisPort } from "./FlutterBuildAnalysisPort.js";
import { createAnalysisExecution } from "../AnalysisProvider.js";
import { AnalysisCancelledError } from "../../domain/analysisErrorCore.js";
import { parseEvidence } from "../../domain/evidence.js";
import { ok } from "../../domain/result.js";

const identity = {
  id: "flutter",
  name: "Flutter build identification",
  version: null,
};

const execution = createAnalysisExecution(
  {
    target: { path: "/targets/app.apk", bytes: 10, sha256: "a".repeat(64) },
    flutter_detected: true,
    abis: [],
    coverage: "complete",
  },
  identity,
);

const refusing: FlutterBuildAnalysisPort = {
  async inspectAvailability() {
    throw new Error("must not probe");
  },
  async close() {},
  async execute() {
    throw new Error("must not execute");
  },
};

const malformedSelections: readonly unknown[] = [
  { path: "/targets/app.apk", extra: true },
  { path: 7 },
  {},
  { path: "/targets/app.apk", abi: "not a locale" },
];
it.each(malformedSelections)("refuses %j at admission", async (input) => {
  const settled = await new FlutterBuildAnalysisService(refusing).execute(
    "identify_flutter_build",
    input,
  );
  expect(settled.ok).toBe(false);
  if (settled.ok) return;
  expect(settled.error._tag).toBe("AnalysisInputError");
});

it("passes the validated request to the provider and seals Evidence", async () => {
  const seen: unknown[] = [];
  const recording: FlutterBuildAnalysisPort = {
    async inspectAvailability() {
      return { status: "available", code: null, reason: null, diagnostics: {} };
    },
    async close() {},
    async execute(request) {
      seen.push(request);
      return ok(execution);
    },
  };
  const result = await new FlutterBuildAnalysisService(recording).execute(
    "identify_flutter_build",
    { path: "/targets/app.apk" },
  );
  expect(seen).toEqual([
    {
      operation: "identify_flutter_build",
      input: { path: "/targets/app.apk" },
    },
  ]);
  if (!result.ok) throw new Error(result.error.message);
  const evidence = parseEvidence(result.value);
  expect(evidence.provider).toEqual(identity);
  expect(evidence.confidence).toBe("observed");
});

it("settles an already-aborted call as cancellation before execution", async () => {
  const controller = new AbortController();
  controller.abort();
  const settled = await new FlutterBuildAnalysisService(refusing).execute(
    "identify_flutter_build",
    { path: "/targets/app.apk" },
    {
      signal: controller.signal,
    },
  );
  expect(settled.ok).toBe(false);
  if (settled.ok) return;
  expect(settled.error).toBeInstanceOf(AnalysisCancelledError);
});
