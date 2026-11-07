import { expect, it } from "vitest";

import { ApktoolResourceAnalysisService } from "./ApktoolResourceAnalysisService.js";
import type { ApktoolResourceAnalysisPort } from "./ApktoolResourceAnalysisPort.js";
import { createAnalysisExecution } from "../AnalysisProvider.js";
import { AnalysisCancelledError } from "../../domain/analysisErrorCore.js";
import { parseEvidence } from "../../domain/evidence.js";
import { ok } from "../../domain/result.js";

const identity = { id: "apktool", name: "Apktool", version: null };

const execution = createAnalysisExecution(
  {
    client: {
      command: "/usr/bin/apktool",
      command_source: "path",
      apktool_version: "2.7.0-dirty",
    },
  },
  identity,
);

const refusedPort: ApktoolResourceAnalysisPort = {
  async inspectAvailability() {
    throw new Error("must not probe");
  },
  async close() {},
  async execute() {
    throw new Error("must not execute");
  },
};

it.each([
  [{ path: "/targets/app.apk", include_strings: "yes" }],
  [{ path: "/targets/app.apk", string_tables_only: "yes" }],
  [{ path: "/targets/app.apk", locale: "not a locale" }],
  [{ path: "/targets/app.apk", locales: ["not a locale"] }],
  [{ path: "/targets/app.apk", locales: [] }],
  [
    {
      path: "/targets/app.apk",
      locales: Array.from({ length: 21 }, () => "de"),
    },
  ],
  [{ path: "/targets/app.apk", extra: true }],
])("rejects invalid decode selection before any effect: %j", async (input) => {
  const service = new ApktoolResourceAnalysisService(refusedPort);
  expect(
    await service.execute("decode_android_resources", input),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
});

it("admits valid batched locales and forwards them to provider", async () => {
  const port: ApktoolResourceAnalysisPort = {
    async inspectAvailability() {
      return { status: "available", code: null, reason: null, diagnostics: {} };
    },
    async close() {},
    async execute(request) {
      expect(request).toEqual({
        operation: "decode_android_resources",
        input: {
          path: "/targets/app.apk",
          include_strings: true,
          locales: ["de", "pt-BR"],
        },
      });
      return ok(execution);
    },
  };
  const result = await new ApktoolResourceAnalysisService(port).execute(
    "decode_android_resources",
    {
      path: "/targets/app.apk",
      include_strings: true,
      locales: ["de", "pt-BR"],
    },
  );
  if (!result.ok) throw new Error(result.error.message);
  const evidence = parseEvidence(result.value);
  expect(evidence.parameters).toEqual({
    path: "/targets/app.apk",
    include_strings: true,
    locales: ["de", "pt-BR"],
  });
});

it("composes observed Evidence with the caller parameters inline", async () => {
  const port: ApktoolResourceAnalysisPort = {
    async inspectAvailability() {
      return { status: "available", code: null, reason: null, diagnostics: {} };
    },
    async close() {},
    async execute(request) {
      expect(request).toEqual({
        operation: "decode_android_resources",
        input: { path: "/targets/app.apk", include_strings: true },
      });
      return ok(execution);
    },
  };
  const result = await new ApktoolResourceAnalysisService(port).execute(
    "decode_android_resources",
    { path: "/targets/app.apk", include_strings: true },
  );
  if (!result.ok) throw new Error(result.error.message);
  const evidence = parseEvidence(result.value);
  expect(evidence.provider).toEqual(identity);
  expect(evidence.operation).toBe("decode_android_resources");
  expect(evidence.parameters).toEqual({
    path: "/targets/app.apk",
    include_strings: true,
  });
  expect(evidence.confidence).toBe("observed");
});

it("preserves cancellation before execution", async () => {
  const controller = new AbortController();
  controller.abort();
  const service = new ApktoolResourceAnalysisService(refusedPort);
  const result = await service.execute(
    "decode_android_resources",
    { path: "/targets/app.apk", include_strings: true },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
});

it("preserves a cancellation that races a completed observation", async () => {
  const controller = new AbortController();
  const racingPort: ApktoolResourceAnalysisPort = {
    async inspectAvailability() {
      return { status: "available", code: null, reason: null, diagnostics: {} };
    },
    async close() {},
    async execute() {
      // The provider may finish its work before the abort is delivered, so a
      // successful result is not by itself proof the caller still wants it.
      controller.abort();
      return ok(execution);
    },
  };
  const result = await new ApktoolResourceAnalysisService(racingPort).execute(
    "decode_android_resources",
    { path: "/targets/app.apk", include_strings: true },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  // The observation the provider completed is retained on the cancellation, so
  // a session still records the Evidence instead of losing finished work.
  const retained = parseEvidence(result.error.partialObservation);
  expect(retained.operation).toBe("decode_android_resources");
  expect(retained.provider).toEqual(identity);
  expect(retained.parameters).toEqual({
    path: "/targets/app.apk",
    include_strings: true,
  });
  expect(retained.confidence).toBe("observed");
});
