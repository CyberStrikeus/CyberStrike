import { importReferenceSource as importOwned } from "../../src/application/ReferenceSourceImport.js";
import type { ReferenceSourceImportOptions } from "../../src/application/ReferenceSourceImportTypes.js";
import { readReferenceSource as readOwned } from "../../src/reference/ReferenceSourceReader.js";
import type { ReferenceSourceReaderOptions } from "../../src/reference/ReferenceSourceReaderTypes.js";
import { withArtifactResourceScope } from "../fixtures/artifactInventory.js";

/** Run one reference-source test operation with an awaited resource owner. */
export const importReferenceSource = (options: ReferenceSourceImportOptions) =>
  withArtifactResourceScope((resources) => importOwned(options, resources));

/** Read one reference-source test tree with an awaited resource owner. */
export const readReferenceSource = (
  root: string,
  options: ReferenceSourceReaderOptions = {},
) =>
  withArtifactResourceScope((resources) => readOwned(root, resources, options));
