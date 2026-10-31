import { describe, expect, it } from "vitest";

import { JebAnalysisService } from "./JebAnalysisService.js";
import type { JebAnalysisPort } from "./JebAnalysisPort.js";
import type { JebRequest } from "../../domain/jeb/jebAnalysis.js";
import { createAnalysisExecution } from "../AnalysisProvider.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../../domain/result.js";

const identity = { id: "jeb", name: "JEB", version: "5.48.0" } as const;

const fakePort = (
  requests: JebRequest[],
  outcome: ReturnType<typeof ok> | ReturnType<typeof err> = ok(
    createAnalysisExecution({ observed: true }, identity, {
      limitations: ["engine-side analysis"],
    }),
  ),
): JebAnalysisPort => ({
  async inspectAvailability() {
    return {
      status: "available",
      code: null,
      reason: null,
      diagnostics: {},
      supportedOperations: [
        "inspect_jeb_client",
        "list_jeb_units",
        "open_jeb_project",
        "decompile_jeb_item",
      ],
    };
  },
  async close() {},
  async execute(request) {
    requests.push(request);
    return outcome as Result<
      ReturnType<typeof createAnalysisExecution>,
      AnalysisError
    >;
  },
});

describe("JebAnalysisService admission", () => {
  it("rejects malformed input before any provider call", async () => {
    const requests: JebRequest[] = [];
    const service = new JebAnalysisService(fakePort(requests));
    const result = await service.execute("list_jeb_units", {
      count: 101,
      index: -1,
      parent_unit_path: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisInputError);
    if (!(result.error instanceof AnalysisInputError)) throw result.error;
    expect(result.error.issues).toContainEqual({
      path: ["parent_unit_path"],
      reason: "out_of_range",
      minimum: 1,
    });
    expect(requests).toHaveLength(0);
  });

  it("returns cancellation without provider effects when already aborted", async () => {
    const requests: JebRequest[] = [];
    const service = new JebAnalysisService(fakePort(requests));
    const controller = new AbortController();
    controller.abort();
    const result = await service.execute(
      "inspect_jeb_client",
      {},
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(requests).toHaveLength(0);
  });

  it("applies protocol defaults and composes provider evidence", async () => {
    const requests: JebRequest[] = [];
    const service = new JebAnalysisService(fakePort(requests));
    const result = await service.execute("list_jeb_units", {});
    if (!result.ok) throw result.error;
    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (request?.operation !== "list_jeb_units")
      throw new Error("Expected the list_jeb_units provider request");
    expect(request.input.index).toBe(0);
    expect(request.input.count).toBe(100);
    expect(result.value.normalized_result).toEqual({ observed: true });
    expect(result.value.parameters).toEqual({ index: 0, count: 100 });
    expect(result.value.limitations).toContain("engine-side analysis");
    expect(result.value.provider.id).toBe("jeb");
  });

  it("preserves provider failure reasons", async () => {
    const service = new JebAnalysisService(
      fakePort([], err(new AnalysisCancelledError("open_jeb_project"))),
    );
    const result = await service.execute("open_jeb_project", {
      path: "/tmp/Example.apk",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  });
});
