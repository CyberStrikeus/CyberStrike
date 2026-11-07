import { expect, it } from "vitest";
import { createAnalysisExecution } from "./AnalysisProvider.js";
import { executeFunctionAnalysisEvidence } from "./FunctionAnalysisEvidence.js";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import { createEvidence, parseEvidence } from "../domain/evidence.js";
import { createAnalysisProfile } from "../domain/analysisProfile.js";
import { ghidraFunctionDossier } from "../domain/ghidraValues.fixture.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { err, ok } from "../domain/result.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";

const provider = {
  id: "dossier-fixture",
  name: "Synthetic dossier",
  version: "1",
};
const target: BinaryTarget = {
  path: "/selected/application.elf",
  sha256: "a".repeat(64),
  kind: "executable",
  format: "elf",
  architecture: "x86_64",
  availableArchitectures: ["x86_64"],
};
const parameters = { procedure: "fixture_main" };

it("does not start function work when admission is already cancelled", async () => {
  const reason = { request: "cancelled before provider admission" };
  let calls = 0;
  const analysis = {
    execute: async () => {
      calls++;
      return ok(createAnalysisExecution(ghidraFunctionDossier(), provider));
    },
  };
  const result = await executeFunctionAnalysisEvidence(
    analysis,
    parameters,
    target,
    { signal: AbortSignal.abort(reason) },
  );
  if (result.ok) throw new Error("Expected pre-admission cancellation");
  expect(result.error).toMatchObject({ _tag: "AnalysisCancelledError" });
  expect(result.error.cause).toBe(reason);
  expect(calls).toBe(0);
});

it.each(["selected-target", "no-subject", "provider-subject"] as const)(
  "retains the completed dossier and its %s binding after cancellation",
  async (binding) => {
    const dossier = ghidraFunctionDossier();
    const reason = { request: "cancelled after provider observation" };
    const analysisProfile = createAnalysisProfile(provider, {
      language: "x86:LE:64",
    });
    const relationshipCoverage = {
      status: "partial" as const,
      limitations: ["Indirect callers remain unknown"],
      limited_directions: ["callers"] as ["callers"],
    };
    const subject = {
      ...target,
      path: "/observed/provider.elf",
      sha256: "b".repeat(64),
    };
    const source = createEvidence(
      undefined,
      provider,
      {
        operation: "health",
        parameters: { facet: "historical-report" },
        result: { original: "unknown" },
      },
      { immutable: true },
    );
    for (const aborted of [false, true]) {
      const controller = new AbortController();
      const execution = createAnalysisExecution(dossier, provider, {
        ...(binding === "selected-target"
          ? {}
          : { subject: binding === "no-subject" ? null : subject }),
        analysisProfile,
        relationshipCoverage,
        rawResult: { provider_text: "preserved" },
        limitations: ["Synthetic provider observation"],
        locations: [{ kind: "address", address: "0x401000" }],
        sourceEvidence: [source],
      });
      const result = await executeFunctionAnalysisEvidence(
        {
          execute: async () => {
            if (aborted) controller.abort(reason);
            return ok(execution);
          },
        },
        parameters,
        target,
        { signal: controller.signal },
      );
      expect(result.sourceEvidence).toEqual([source]);
      if (aborted) {
        if (result.ok) throw new Error("Expected late cancellation");
        expect(result.error).toMatchObject({ _tag: "AnalysisCancelledError" });
        expect(result.error.cause).toBe(reason);
      } else if (!result.ok) throw result.error;
      const evidence = parseEvidence(
        result.ok ? result.value : result.error.partialObservation,
      );
      expect(evidence.operation).toBe("analyze_function");
      expect(evidence.parameters).toEqual(parameters);
      expect(evidence.normalized_result).toEqual(dossier);
      expect(evidence.raw_result).toEqual({ provider_text: "preserved" });
      expect(evidence.provider).toEqual(provider);
      expect(evidence.analysis_profile).toEqual(analysisProfile);
      expect(evidence.relationship_coverage).toEqual(relationshipCoverage);
      expect(evidence.evidence_links).toEqual([source.evidence_id]);
      expect(evidence.limitations).toContain("Synthetic provider observation");
      expect(evidence.locations).toContainEqual({
        kind: "address",
        address: "0x401000",
      });
      if (binding === "no-subject") expect(evidence.subject).toBeNull();
      else
        expect(evidence.subject?.local_path).toBe(
          binding === "selected-target" ? target.path : subject.path,
        );
    }
  },
);

it.each(["provider-failure", "invalid-dossier"] as const)(
  "keeps %s primary if cancellation arrives before result consumption",
  async (kind) => {
    const controller = new AbortController();
    const failure = new AnalysisOutputError(
      "analyze_function",
      "Provider failure",
    );
    const result = await executeFunctionAnalysisEvidence(
      {
        execute: async () => {
          controller.abort({ request: "unrelated late cancellation" });
          return kind === "provider-failure"
            ? err(failure)
            : ok(
                createAnalysisExecution({ procedure: "incomplete" }, provider),
              );
        },
      },
      parameters,
      target,
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected the producer/output failure");
    if (kind === "provider-failure") expect(result.error).toBe(failure);
    else
      expect(result.error).toMatchObject({
        _tag: "AnalysisOutputError",
        operation: "analyze_function",
      });
    if (kind === "provider-failure")
      expect(result.error.partialObservation).toBeUndefined();
    else {
      const retained = parseEvidence(result.error.partialObservation);
      expect(retained.normalized_result).toEqual({ procedure: "incomplete" });
      expect(retained.subject?.local_path).toBe(target.path);
    }
  },
);

it("retains malformed dossier facts and source links through public error projection", async () => {
  const source = createEvidence(undefined, provider, {
    operation: "health",
    parameters: {},
    result: "retained source",
  });
  const malformed = { procedure: "incomplete", partial: ["caller fact"] };
  const result = await executeFunctionAnalysisEvidence(
    {
      execute: async () =>
        ok(
          createAnalysisExecution(malformed, provider, {
            subject: null,
            rawResult: { text: "original provider output" },
            limitations: ["Incomplete provider response"],
            locations: [{ kind: "address", address: "0x401000" }],
            sourceEvidence: [source],
          }),
        ),
    },
    parameters,
    target,
  );
  if (result.ok) throw new Error("Expected invalid dossier failure");
  expect(result.sourceEvidence).toEqual([source]);
  const projected = projectAnalysisError(result.error);
  const retained = parseEvidence(projected.details?.partial_observation);
  expect(retained.normalized_result).toEqual(malformed);
  expect(retained.raw_result).toEqual({ text: "original provider output" });
  expect(retained.subject).toBeNull();
  expect(retained.evidence_links).toEqual([source.evidence_id]);
  expect(retained.locations).toEqual([
    { kind: "address", address: "0x401000" },
  ]);
  expect(retained.limitations).toContain("Incomplete provider response");
});
