import type { ArtifactOccurrence } from "../domain/artifactGraph.js";
import type { ArtifactReader } from "./ArtifactReader.js";
import {
  ARTIFACT_FORMATS,
  type ArtifactReaderConstruction,
} from "./artifactFormats.js";

export type { ArtifactReaderConstruction } from "./artifactFormats.js";

/** Formats with an artifact entry reader; availability policy belongs to the caller. */
export type ArtifactReaderFormat = {
  [Id in keyof typeof ARTIFACT_FORMATS]: (typeof ARTIFACT_FORMATS)[Id] extends {
    readonly createReader: (
      path: string,
      options: ArtifactReaderConstruction,
    ) => ArtifactReader;
  }
    ? Id
    : never;
}[keyof typeof ARTIFACT_FORMATS];

export function createArtifactReader(
  path: string,
  format: ArtifactReaderFormat,
  options: ArtifactReaderConstruction,
): ArtifactReader;
export function createArtifactReader(
  path: string,
  format: ArtifactOccurrence["artifact_format"],
  options: ArtifactReaderConstruction,
): ArtifactReader | undefined;
/** Construct a reader without acquiring or transferring its source ownership. */
export function createArtifactReader(
  path: string,
  format: ArtifactOccurrence["artifact_format"],
  options: ArtifactReaderConstruction,
): ArtifactReader | undefined {
  const descriptor = ARTIFACT_FORMATS[format];
  return "createReader" in descriptor
    ? descriptor.createReader(path, options)
    : undefined;
}
