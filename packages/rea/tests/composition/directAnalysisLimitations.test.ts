import { projectCliAnalysisResult } from "../../src/cli/projectCliAnalysisResult.js";
import { expect, it } from "vitest";
import { parseConfig } from "../../src/config/parseConfig.js";
import { runDirectAnalysis } from "../../src/application/DirectAnalysis.js";
import { createAnalysisExecution } from "../../src/application/AnalysisProvider.js";
import { ok } from "../../src/domain/result.js";
import {
  createBinarySessionTargets,
  createTestBinarySession,
} from "../fixtures/binarySession.js";

it("retains provider coverage caveats in a composed CLI result and closes the session", async () => {
  const [path] = await createBinarySessionTargets();
  const limitation = "Companion PDB symbol coverage is unverified.";
  let reads = 0;
  let closed = 0;
  const createSession = () =>
    createTestBinarySession(() => ({
      execute: async (operation) => {
        reads++;
        return ok(
          createAnalysisExecution(
            operation === "current_document" ? "fixture" : [],
            { id: "fixture", name: "Fixture", version: "1" },
            { limitations: [limitation] },
          ),
        );
      },
      close: async () => {
        closed++;
        return ok(null);
      },
    }));
  const output = await runDirectAnalysis(
    {
      readConfiguration: () => parseConfig({}),
      createBinarySession: createSession,
      createManagedBinarySession: createSession,
      createArtifactBinarySession: createSession,
      createNativeDispatchBinarySession: createSession,
      createNativeBinarySession: createSession,
    },
    path,
    "binary_overview",
    {},
  ).then(projectCliAnalysisResult);
  expect(output).toMatchObject({
    limitations: [
      "Derived by an REA composed workflow.",
      `Fixture (fixture 1) current_document, list_procedures, list_segments, list_strings: ${limitation}`,
    ],
    normalized_result: {
      document: "fixture",
      segment_count: 0,
      procedure_count: 0,
      string_count: 0,
    },
  });
  expect(reads).toBe(5);
  expect(closed).toBe(1);
});
