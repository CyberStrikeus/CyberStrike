import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";

/** Verify caller provenance separately from the resolved artifact identity. */
export const assertJavaScriptApplicationInputPaths = async (
  evidence,
  inputPath,
) => {
  const canonicalPath = await realpath(inputPath);
  assert.equal(
    evidence.parameters.input_path,
    inputPath,
    "JavaScript Evidence must retain the caller's input_path",
  );
  assert.equal(
    evidence.subject?.local_path,
    canonicalPath,
    "JavaScript Evidence subject must identify the resolved artifact",
  );
  assert.equal(
    evidence.normalized_result.input_path,
    canonicalPath,
    "JavaScript analysis result must identify the resolved artifact",
  );
};
