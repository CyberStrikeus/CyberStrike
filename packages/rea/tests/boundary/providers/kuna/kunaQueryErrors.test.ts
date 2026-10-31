import { expect, it } from "vitest";
import { kunaQueryFailureForCaller } from "../../../../src/kuna/KunaQueryErrors.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisTimeoutError,
} from "../../../../src/domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../../../src/domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { analysisErrorWithCleanupFailure } from "../../../../src/domain/analysisErrorCleanup.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { createEvidence } from "../../../../src/domain/evidence.js";

const capturedOutput = {
  stdout: "selected output",
  stderr: "selected warning",
  truncated: false,
};
const partialObservation = createEvidence(
  undefined,
  { id: "kuna", name: "Kuna", version: null },
  {
    operation: "kuna:strings",
    parameters: {},
    result: [],
    confidence: "observed",
  },
);
const context = {
  capturedOutput,
  partialObservation,
  diagnostics: { selected_url: "https://example.test/?keep=1" },
  cleanup: { reason: "controlled close refusal", resources: ["one", "two"] },
};

it.each([
  {
    name: "cleanup",
    create: () =>
      new ProviderCleanupError("kuna", ["one", "two"], context.diagnostics, {
        ...context,
        operation: "kuna:strings",
      }),
  },
  {
    name: "adapter",
    create: () => new ProviderAdapterError("kuna", "kuna:strings", context),
  },
  {
    name: "output",
    create: () =>
      new AnalysisOutputError("kuna:strings", "invalid scan", {
        ...context,
        cleanupOnly: true,
      }),
  },
  {
    name: "timeout",
    create: () => new AnalysisTimeoutError("kuna:strings", 17, context),
  },
])(
  "keeps $name caller projections bound to the exact producer cleanup state",
  ({ create }) => {
    const source = create();
    let resources = ["one", "two"];
    source.bindCleanupResourceOwner({
      get cleanupResources() {
        return resources;
      },
    });
    const callers = ["list_strings", "search_strings"].map((operation) =>
      kunaQueryFailureForCaller(source, operation),
    );
    for (const caller of callers) {
      expect(caller._tag).toBe(source._tag);
      if (source instanceof ProviderCleanupError)
        expect(caller).toBeInstanceOf(ProviderCleanupError);
      if (source instanceof AnalysisTimeoutError)
        expect(caller).toMatchObject({ timeoutMs: source.timeoutMs });
      if (source instanceof AnalysisOutputError)
        expect(caller).toMatchObject({
          cleanupOnly: source.cleanupOnly,
          reason: source.reason,
        });
      expect(caller.capturedOutput).toEqual(capturedOutput);
      expect(caller.partialObservation).toEqual(partialObservation);
      expect(caller.diagnostics).toMatchObject({
        ...context.diagnostics,
        producer_operation: "kuna:strings",
      });
      expect(caller.cleanupIncomplete).toBe(true);
    }
    resources = ["two"];
    for (const caller of callers)
      expect(caller.cleanupResources).toEqual(["two"]);
    source.resolveCleanup();
    for (const caller of callers) expect(caller.cleanupIncomplete).toBe(false);
  },
);

it("does not resurrect an already resolved cleanup failure", () => {
  const source = new ProviderCleanupError(
    "kuna",
    ["owner"],
    {},
    { operation: "kuna:strings" },
  );
  source.resolveCleanup();
  const caller = kunaQueryFailureForCaller(source, "search_strings");
  expect(caller.cleanupIncomplete).toBe(false);
});

it.each([
  null,
  "caller stopped",
  new ProviderCleanupError("foreign", ["foreign-owner"], {}),
])(
  "preserves an opaque cancellation reason without adopting its cleanup authority: %j",
  (reason) => {
    const source = new AnalysisCancelledError("kuna:strings", {
      cause: reason,
    });
    const caller = kunaQueryFailureForCaller(source, "search_strings");
    expect(caller.cause).toBe(reason);
    expect(caller.cleanupIncomplete).toBe(false);
  },
);

it("restores a caller-attributed typed primary after its exact cleanup owner resolves", () => {
  const primary = new AnalysisTimeoutError("list_procedures", 23, {
    capturedOutput,
  });
  const cleanup = new ProviderCleanupError("kuna", ["owner"], {});
  const source = analysisErrorWithCleanupFailure(
    primary,
    cleanup,
    "list_procedures",
  ).bindCleanupDependencies([cleanup]);
  const caller = kunaQueryFailureForCaller(source, "search_procedures");
  expect(caller.cleanupPrimary).toMatchObject({
    _tag: "AnalysisTimeoutError",
    operation: "search_procedures",
    timeoutMs: 23,
  });
  cleanup.resolveCleanup();
  expect(projectAnalysisError(caller)).toMatchObject({
    code: "provider_timeout",
    details: {
      operation: "search_procedures",
      captured_output: capturedOutput,
    },
  });
});

it("keeps same-operation and unfamiliar error variants unchanged", () => {
  const source = new AnalysisTimeoutError("search_strings", 19);
  expect(kunaQueryFailureForCaller(source, "search_strings")).toBe(source);
  const unfamiliar = new AnalysisInputError("producer");
  expect(kunaQueryFailureForCaller(unfamiliar, "search_strings")).toBe(
    unfamiliar,
  );
});
