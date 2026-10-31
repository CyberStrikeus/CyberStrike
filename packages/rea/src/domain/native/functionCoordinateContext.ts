import { z } from "zod";

import { digestCanonicalValue } from "../canonicalDigest.js";
import { digestSchema } from "../digests.js";
import {
  committedProvidersEqual,
  type AnalysisProfileCommitment,
} from "../analysisProfile.js";
import type { JsonValue } from "../jsonValue.js";
import {
  machoTargetSelectionSchema,
  sameMachoTargetSelection,
  type MachoTargetSelection,
} from "../apple/machoTargetSelection.js";

/** Provider-owned native image selection and deterministic loader mapping. */
const functionCoordinateContextSchema = z.strictObject({
  kind: z.literal("native-function-coordinate-context-v1"),
  selected_image: machoTargetSelectionSchema.nullable(),
  mapping_sha256: digestSchema,
});

/** The provider selects only inputs affecting its executable coordinates. */
export const createFunctionCoordinateContext = (
  mapping: Readonly<Record<string, JsonValue>>,
  selectedImage: MachoTargetSelection | null = null,
) =>
  functionCoordinateContextSchema.parse({
    kind: "native-function-coordinate-context-v1",
    selected_image: selectedImage,
    mapping_sha256: digestCanonicalValue(
      mapping,
      "Native function coordinate mapping",
    ),
  });

/** Missing or malformed commitments cannot establish coordinate applicability. */
export const functionCoordinateContextsEqual = (
  left: AnalysisProfileCommitment | null,
  right: AnalysisProfileCommitment | null,
): boolean => {
  if (
    left === null ||
    right === null ||
    !committedProvidersEqual(left.provider, right.provider)
  )
    return false;
  const leftContext = functionCoordinateContextSchema.safeParse(
    left.parameters.function_coordinate_context,
  );
  const rightContext = functionCoordinateContextSchema.safeParse(
    right.parameters.function_coordinate_context,
  );
  return (
    leftContext.success &&
    rightContext.success &&
    leftContext.data.mapping_sha256 === rightContext.data.mapping_sha256 &&
    (leftContext.data.selected_image === null
      ? rightContext.data.selected_image === null
      : sameMachoTargetSelection(
          leftContext.data.selected_image,
          rightContext.data.selected_image ?? undefined,
        ))
  );
};
