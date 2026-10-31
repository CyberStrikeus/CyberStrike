import { expect, it } from "vitest";

import { BrowserObservationError } from "../../domain/browserObservationError.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { err, ok } from "../../domain/result.js";
import { parseEvidence } from "../../domain/evidence.js";
import type { JavaScriptRuntimeTargetList } from "../../domain/javascript/javascriptRuntimeObservation.js";
import { javascriptRuntimeObservationSchema } from "../../domain/javascript/javascriptRuntimeObservation.js";
import type { JavaScriptRuntimeObservationPort } from "./JavaScriptRuntimeObservationPort.js";
import {
  listJavaScriptRuntimeTargets,
  observeJavaScriptRuntime,
} from "./JavaScriptRuntimeObservationService.js";
import {
  expectDroppedPartial,
  expectKeptPartial,
  expectOutputError,
  expectOwnerError,
  expectPreemptedCancellation,
} from "../ownerObservationExpectation.fixture.js";

const observeCancelled = async (partial: unknown) => {
  const reason = { requested: "stop before runtime observation completed" };
  const failure = new AnalysisCancelledError("observe_javascript_runtime", {
    cause: reason,
    partialObservation: partial as never,
  });
  const result = await observeJavaScriptRuntime(
    {
      identity: () => ({ id: "test", name: "Test", version: "1" }),
      listTargets: async () =>
        err(new AnalysisCancelledError("list_javascript_runtime_targets")),
      observe: async () => err(failure),
    },
    {
      inspector_endpoint: "http://127.0.0.1:9229",
      target_id: "target",
      observation_ms: 0,
    },
  );
  return { result, failure, reason };
};

it("preserves failed Inspector cleanup when cancellation occurs during observation", async () => {
  const controller = new AbortController();
  const failure = new BrowserObservationError(
    "observe_javascript_runtime",
    "cleanup_failed",
    {
      cause: new AnalysisCancelledError("observe_javascript_runtime"),
    },
  );
  const provider: JavaScriptRuntimeObservationPort = {
    identity: () => ({
      id: "test-inspector",
      name: "Test Inspector",
      version: "1",
    }),
    listTargets: async () => err(failure),
    observe: async () => {
      controller.abort();
      return err(failure);
    },
  };
  const result = await observeJavaScriptRuntime(
    provider,
    {
      inspector_endpoint: "http://127.0.0.1:9229",
      target_id: "target",
      observation_ms: 0,
    },
    { signal: controller.signal },
  );

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected failed cleanup");
  expect(result.error).toBe(failure);
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toEqual(["browser_transport"]);
  expect(result.error.userCategory).toBe("cancelled");
});

it("retains target Evidence when cancellation arrives during provider cleanup", async () => {
  const controller = new AbortController();
  const provider: JavaScriptRuntimeObservationPort = {
    identity: () => ({
      id: "test-inspector",
      name: "Test Inspector",
      version: "1",
    }),
    listTargets: async () => {
      controller.abort();
      return ok({
        runtime: {
          product: "node.js/v24",
          protocol_version: "1.3",
          v8_version: "13",
        },
        targets: [],
        excluded: { unsupported_location: 0, unconnectable: 0 },
        limitations: [],
      });
    },
    observe: async () =>
      err(new AnalysisCancelledError("observe_javascript_runtime")),
  };
  const result = await listJavaScriptRuntimeTargets(
    provider,
    { inspector_endpoint: "http://127.0.0.1:9229" },
    { signal: controller.signal },
  );

  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      operation: "list_javascript_runtime_targets",
      partialObservation: {
        normalized_result: {
          runtime: { product: "node.js/v24" },
          targets: [],
        },
      },
    },
  });
  if (!result.ok) {
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "list_javascript_runtime_targets",
      normalized_result: { targets: [] },
    });
  }
});

it("does not let late cancellation hide an invalid completed Inspector report", async () => {
  const malformed = {
    runtime: {
      product: "Node.js",
      protocol_version: "1.3",
      v8_version: "12.0",
    },
    targets: [],
    excluded: { unsupported_location: -1, unconnectable: 0 },
    limitations: [],
  } as unknown as JavaScriptRuntimeTargetList;
  const output = await listJavaScriptRuntimeTargets(
    {
      identity: () => ({ id: "test", name: "Test", version: "1" }),
      listTargets: async () => ok(malformed),
      observe: async () => {
        throw new Error("not used");
      },
    },
    { inspector_endpoint: "http://127.0.0.1:9229" },
  );
  expectOutputError(output);

  const controller = new AbortController();
  const late = await listJavaScriptRuntimeTargets(
    {
      identity: () => ({ id: "test", name: "Test", version: "1" }),
      listTargets: async () => {
        controller.abort();
        return ok(malformed);
      },
      observe: async () => {
        throw new Error("not used");
      },
    },
    { inspector_endpoint: "http://127.0.0.1:9229" },
    { signal: controller.signal },
  );
  expectOutputError(late);
});

it("converts a raw runtime observation retained by cleanup failure", async () => {
  const observation = javascriptRuntimeObservationSchema.parse({
    runtime: {
      product: "node.js/v24",
      protocol_version: "1.3",
      v8_version: "13",
    },
    target: {
      target_id: "target",
      protocol_type: "node",
      attached: false,
      location: { kind: "file", file_path: "/fixture.js" },
      runtime_kind: "node",
      runtime_kind_authority: "caller-declared-unverified",
    },
    capture: {
      observation_ms: 0,
      events_observed: 0,
      events_retained: 0,
      events_dropped: 0,
      metadata_bytes_retained: 0,
      truncated: false,
      truncation_reasons: [],
    },
    scripts: {
      items: [],
      observed_total: 0,
      excluded: { unsupported_location: 0, invalid_protocol_value: 0 },
    },
    execution_contexts: [],
    directly_observed: ["Inspector target attached and queried."],
    unavailable_without_instrumentation: [],
    unknowns: [],
    limitations: [],
  });
  const failure = new BrowserObservationError(
    "observe_javascript_runtime",
    "cleanup_failed",
    {
      cleanup: {
        reason: "Inspector close failed",
        resources: ["browser_transport"],
      },
      partialObservation: observation,
    },
  );
  const result = await observeJavaScriptRuntime(
    {
      identity: () => ({ id: "test", name: "Test", version: "1" }),
      listTargets: async () =>
        ok({
          runtime: {
            product: "node.js/v24",
            protocol_version: "1.3",
            v8_version: "13",
          },
          targets: [],
          excluded: { unsupported_location: 0, unconnectable: 0 },
          limitations: [],
        }),
      observe: async () => err(failure),
    },
    {
      inspector_endpoint: "http://127.0.0.1:9229",
      target_id: "target",
      observation_ms: 0,
    },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBe(failure);
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "observe_javascript_runtime",
      normalized_result: observation,
    });
  }
});

it("reports non-JSON Inspector output before late cancellation", async () => {
  const controller = new AbortController();
  const value = {
    runtime: {
      product: "node.js/v24",
      protocol_version: "1.3",
      v8_version: "13",
    },
    targets: [],
    excluded: { unsupported_location: 0, unconnectable: 0 },
    limitations: [] as string[],
  };
  Reflect.set(value, "limitations", [undefined]);
  const provider: JavaScriptRuntimeObservationPort = {
    identity: () => ({
      id: "test-inspector",
      name: "Test Inspector",
      version: "1",
    }),
    listTargets: async () => {
      controller.abort();
      return ok(value);
    },
    observe: async () =>
      err(new AnalysisCancelledError("observe_javascript_runtime")),
  };

  await expect(
    listJavaScriptRuntimeTargets(
      provider,
      { inspector_endpoint: "http://127.0.0.1:9229" },
      { signal: controller.signal },
    ),
  ).resolves.toMatchObject({
    ok: false,
    error: { _tag: "AnalysisOutputError", partialObservation: undefined },
  });
});

it.each(["list", "observe"] as const)(
  "preserves a pre-abort reason before Inspector %s provider work",
  async (kind) => {
    const reason = new Error(`stop Inspector ${kind}`);
    const controller = new AbortController();
    controller.abort(reason);
    let providerCalls = 0;
    const provider: JavaScriptRuntimeObservationPort = {
      identity: () => ({ id: "test", name: "Test", version: "1" }),
      listTargets: async () => {
        providerCalls += 1;
        return err(
          new AnalysisCancelledError("list_javascript_runtime_targets"),
        );
      },
      observe: async () => {
        providerCalls += 1;
        return err(new AnalysisCancelledError("observe_javascript_runtime"));
      },
    };
    const result =
      kind === "list"
        ? await listJavaScriptRuntimeTargets(
            provider,
            { inspector_endpoint: "http://127.0.0.1:9229" },
            { signal: controller.signal },
          )
        : await observeJavaScriptRuntime(
            provider,
            {
              inspector_endpoint: "http://127.0.0.1:9229",
              target_id: "target",
              observation_ms: 0,
            },
            { signal: controller.signal },
          );

    expectPreemptedCancellation(result, reason, providerCalls);
  },
);

it("keeps cancellation when the retained runtime observation is incomplete", async () => {
  const partial = { runtime: "partial", scripts: [] };
  const { result, failure, reason } = await observeCancelled(partial);
  expectKeptPartial(expectOwnerError(result, failure, reason), partial);
});

it.each([{ scripts: [undefined] }, { elapsed_ms: Number.NaN }])(
  "drops a non-JSON runtime partial and keeps cancellation primary",
  async (partial) => {
    const { result, failure, reason } = await observeCancelled(partial);
    expectDroppedPartial(
      expectOwnerError(result, failure, reason),
      "Inspector retained a non-JSON incomplete observation.",
    );
  },
);
