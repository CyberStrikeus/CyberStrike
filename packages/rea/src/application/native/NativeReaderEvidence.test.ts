import { describe, expect, it } from "vitest";
import {
  createAnalysisExecution,
  type AnalysisOperationPort,
} from "../AnalysisProvider.js";
import { createAnalysisExecutionEvidence } from "../../domain/analysisObservation.js";
import { AnalysisCapabilityUnavailableError } from "../../domain/analysisErrorCore.js";
import { err, ok } from "../../domain/result.js";
import { readNativeCallRoutes } from "./NativeCallRoutes.js";
import { traceNativeValues } from "./NativeValueTrace.js";
import { inspectNativeDispatch } from "./NativeDispatchMetadataInspection.js";

import { createAnalysisProfile } from "../../domain/analysisProfile.js";
import { createEvidence } from "../../domain/evidence.js";

const provider = { id: "fixture", name: "Fixture", version: "1" };
const subject = {
  path: "/fixture",
  sha256: "a".repeat(64),
  format: "elf" as const,
  architecture: "x86_64" as const,
};
const source = createEvidence(subject, provider, {
  operation: "list_names",
  parameters: {},
  result: [{ address: "0x1000", value: "entry" }],
});
const observation = createAnalysisExecution(
  { malformed: "provider facts" },
  provider,
  {
    subject,
    analysisProfile: createAnalysisProfile(provider, { language: "x86:LE:64" }),
    sourceEvidence: [source],
    rawResult: { output: "original output" },
    limitations: ["partial provider coverage"],
    locations: [],
  },
);

describe("native reader validation Evidence", () => {
  it.each(["references", "callees", "dossier", "binary", "symbols"] as const)(
    "retains the original %s observation on a typed validation failure",
    async (reader) => {
      let operation = "";
      let input: unknown;
      const analysis: AnalysisOperationPort = {
        execute: async (name, parameters) => {
          if (
            reader === "symbols" &&
            name === "inspect_native_dispatch_metadata"
          )
            return err(
              new AnalysisCapabilityUnavailableError(
                "fixture",
                name,
                "unsupported",
              ),
            );
          operation = name;
          input = parameters;
          return ok(
            reader === "callees" && name === "procedure_references"
              ? createAnalysisExecution(
                  {
                    reference_kinds_available: false,
                    references: [],
                    unresolved_calls: [],
                  },
                  provider,
                )
              : observation,
          );
        },
      };
      const result =
        reader === "references" || reader === "callees"
          ? (await readNativeCallRoutes(analysis, "0x1000")).outcome
          : reader === "dossier"
            ? await traceNativeValues(analysis, { procedure: "0x1000" })
            : await inspectNativeDispatch(analysis, 10);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error._tag).toBe("AnalysisOutputError");
      expect(result.error.partialObservation).toEqual(
        createAnalysisExecutionEvidence(
          operation,
          input,
          observation,
          "observed",
        ),
      );
    },
  );
});
