import { projectCliAnalysisResult } from "../../src/cli/projectCliAnalysisResult.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";
import { z } from "zod";

import { createDirectAnalysis } from "../../src/composition/directAnalysis.js";
import type { AnalysisError } from "../../src/domain/analysisErrorBase.js";
import { type Evidence, parseEvidence } from "../../src/domain/evidence.js";
import type { Result } from "../../src/domain/result.js";
import type { InventoryProjectionEvidenceResult } from "../../src/application/InventoryProjectionEvidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const { runProviderAnalysis } = createDirectAnalysis({});

/** Assert a projection succeeded and return its Evidence for schema parsing. */
export const requireSuccessfulProjection = (
  result: Result<InventoryProjectionEvidenceResult, AnalysisError>,
): Evidence => {
  if (!result.ok) throw result.error;
  return result.value.evidence;
};

/** Write one synthetic ZIP application package from literal entries. */
export const writeApplicationZip = async (
  prefix: string,
  filename: string,
  entries: ReadonlyArray<{
    readonly path: string;
    readonly content: string | Uint8Array;
  }>,
): Promise<string> => {
  const root = await createTestTempDirectory(prefix);
  const path = join(root, filename);
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const entry of entries)
    await writer.add(
      entry.path,
      typeof entry.content === "string"
        ? new TextReader(entry.content)
        : new Uint8ArrayReader(entry.content),
    );
  await writeFile(path, await writer.close());
  return path;
};

/** Build inventory Evidence for a written package through the real pipeline. */
export const inventoryApplicationPackage = async (
  path: string,
): Promise<Evidence> =>
  parseEvidence(
    await runProviderAnalysis(path, "inventory_artifact", {}).then(
      projectCliAnalysisResult,
    ),
  );

/**
 * Project the same inventory Evidence twice and return the schema-parsed
 * result, failing when the two projections are not byte-identical.
 */
export const requireDeterministicProjection = <Schema extends z.ZodType>(
  project: (input: {
    inventory_evidence: readonly Evidence[];
  }) => Result<InventoryProjectionEvidenceResult, AnalysisError>,
  inventory: Evidence,
  schema: Schema,
): z.output<Schema> => {
  const left = requireSuccessfulProjection(
    project({ inventory_evidence: [inventory] }),
  );
  const right = requireSuccessfulProjection(
    project({ inventory_evidence: [inventory] }),
  );
  if (
    JSON.stringify(left.normalized_result) !==
    JSON.stringify(right.normalized_result)
  )
    throw new TypeError("Expected repeated projection to be identical");
  return schema.parse(left.normalized_result);
};

/**
 * Build inventory Evidence from a ZIP that is neither an APK nor an IPA.
 * Both mobile projections must reject it with an AnalysisInputError.
 */
export const createNonApplicationZipInventory = async (
  prefix: string,
): Promise<Evidence> => {
  const root = await createTestTempDirectory(prefix);
  const path = join(root, "fixture.zip");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("one.js", new TextReader("one"));
  await writeFile(path, await writer.close());
  return parseEvidence(
    await runProviderAnalysis(path, "inventory_artifact", {}).then(
      projectCliAnalysisResult,
    ),
  );
};
