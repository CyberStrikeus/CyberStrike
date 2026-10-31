import { describe, expect, it } from "vitest";

import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";
import type { SafeOutputTree } from "./SafeOutputTree.js";
import {
  outputDirectoryAdmissionRefusal,
  SafeOutputTreeDestinationRefusal,
} from "./SafeOutputTreeAdmission.js";
import { SafeOutputTreeCreationFailure } from "./SafeOutputTreeCreationFailure.js";

// Only the failure's type matters here; no tree method is called.
const acquiredTree = {} as SafeOutputTree;
const refuse = (cause: unknown) =>
  outputDirectoryAdmissionRefusal(
    "export_web_scripts",
    "output_directory",
    cause,
  );

describe("output directory admission refusal", () => {
  it.each([
    [
      "a refusal before acquisition",
      new SafeOutputTreeDestinationRefusal(
        "Extraction output root already exists",
      ),
    ],
    [
      "a refusal of an acquired non-empty root",
      new SafeOutputTreeCreationFailure(
        new SafeOutputTreeDestinationRefusal("Output directory is not empty"),
        acquiredTree,
      ),
    ],
  ])("blames the selected directory for %s", (_name, cause) => {
    const refused = refuse(cause);

    expect(refused).toBeInstanceOf(AnalysisInputError);
    expect(refused).toMatchObject({
      operation: "export_web_scripts",
      issues: [
        {
          path: ["output_directory"],
          reason: "invalid_value",
          message: cause.message,
        },
      ],
    });
  });

  it.each([
    [
      "an acquired-tree setup failure",
      new SafeOutputTreeCreationFailure(
        new ArtifactReaderFailure(
          "path",
          "Cannot restrict output root to 0700",
        ),
        acquiredTree,
      ),
    ],
    [
      "a path failure that is not a destination refusal",
      new ArtifactReaderFailure("path", "Output file path changed"),
    ],
    [
      "a refusal whose cleanup is unresolved",
      new ArtifactReaderFailure(
        "path",
        "Extraction output root already exists",
        {
          cause: new SafeOutputTreeDestinationRefusal(
            "Extraction output root already exists",
          ),
          cleanup: { reason: "rollback failed", resources: ["/out"] },
        },
      ),
    ],
  ])("keeps artifact semantics for %s", (_name, cause) => {
    expect(refuse(cause)).toBe(cause);
  });
});
