import { expect, it } from "vitest";

import { AndroidAnalysisService } from "../../../../src/application/android/AndroidAnalysisService.js";
import { AnalysisCancelledError } from "../../../../src/domain/analysisErrorCore.js";
import { ok } from "../../../../src/domain/result.js";
import { parseEvidence } from "../../../../src/domain/evidence.js";
import type { AnalysisExecution } from "../../../../src/application/AnalysisProvider.js";
import { createJadxProtocolFixture } from "../../../fixtures/android/jadx.js";

it.each([
  "inspect_android_package",
  "search_android_classes",
  "inspect_android_class",
  "inspect_android_method",
  "trace_android_references",
] as const)(
  "retains %s Evidence when cancellation follows provider completion",
  async (operation) => {
    const fixture = await createJadxProtocolFixture();
    const input = {
      path: fixture.apk,
      ...(operation === "search_android_classes" ? { query: "Target" } : {}),
      ...(operation === "inspect_android_class" ||
      operation === "inspect_android_method" ||
      operation === "trace_android_references"
        ? { class_name: "fixture.Target" }
        : {}),
      ...(operation === "inspect_android_method"
        ? { method_name: "onCreate" }
        : {}),
    };
    const control = await fixture.service.execute(operation, input);
    if (!control.ok) throw control.error;
    const controller = new AbortController();
    const observations: AnalysisExecution[] = [];
    let records = 0;
    const service = new AndroidAnalysisService(
      {
        inspectAvailability: fixture.provider.inspectAvailability.bind(
          fixture.provider,
        ),
        close: fixture.provider.close.bind(fixture.provider),
        execute: async (...args) => {
          const completed = await fixture.provider.execute(...args);
          if (completed.ok) observations.push(completed.value);
          controller.abort();
          return completed;
        },
      },
      () => {
        records += 1;
        return ok("added" as const);
      },
    );
    const result = await service.execute(operation, input, {
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation,
      },
    });
    if (result.ok) throw new Error("Expected cancelled provider completion");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    const partial = parseEvidence(result.error.partialObservation);
    expect(partial).toMatchObject({
      operation,
      subject: control.value.subject,
      parameters: control.value.parameters,
      provider: control.value.provider,
      confidence: control.value.confidence,
      normalized_result: control.value.normalized_result,
    });
    expect(observations).toHaveLength(1);
    expect(records).toBe(0);
    expect(partial.raw_result).toEqual(observations[0]?.rawResult);
    expect(control.value.confidence).toBe(
      operation === "inspect_android_method" ? "derived" : "observed",
    );
  },
);
