import { createHash } from "node:crypto";
import type { RetainedResourceScope } from "../application/AnalysisProvider.js";
import {
  artifactFileCompletion,
  mapArtifactFileFailure,
  ArtifactFileCleanupFailure,
  artifactFilePrimaryFacts,
  withArtifactRegularFile,
} from "../artifacts/ArtifactFileOperation.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import {
  RegularFileCapacityError,
  readStableFileBytes,
} from "../filesystem/readStableFileBytes.js";
import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import { fixedProducerInputAllowance } from "../domain/fixedAllowanceRemediation.js";
import { NonRegularFileReadError } from "../filesystem/RegularFile.js";
import { ghidraApplicationProperties } from "./GhidraInstallationPolicy.js";
import { ghidraFileFailure } from "./GhidraFileArtifacts.js";

/** Metadata admission budget, not a Java Properties format limit. */
export const MAX_GHIDRA_INSTALLATION_PROPERTIES_BYTES = 1024 * 1024;
export interface GhidraInstallationFileOptions {
  readonly resourceOwner: RetainedResourceScope;
  readonly signal?: AbortSignal;
}

/** Preserve Java's Latin-1 byte mapping and follow the caller's selected symlinks. */
export const readGhidraInstallationProperties = async (
  path: string,
  options: GhidraInstallationFileOptions,
): Promise<string | undefined> => {
  try {
    return await options.resourceOwner.run(() =>
      withArtifactRegularFile(
        path,
        {
          retain: (resource) =>
            options.resourceOwner.retain(
              { close: () => resource.lease.release() },
              resource.resource,
            ),
        },
        options.signal,
        async ({ handle: file }) =>
          (
            await readStableFileBytes(
              file,
              path,
              MAX_GHIDRA_INSTALLATION_PROPERTIES_BYTES,
              {
                symlinks: "follow",
                ...(options.signal === undefined
                  ? {}
                  : { signal: options.signal }),
              },
            )
          ).toString("latin1"),
        "follow",
      ),
    );
  } catch (cause: unknown) {
    const { cause: physical } = artifactFilePrimaryFacts(cause);
    if (
      !(cause instanceof ArtifactFileCleanupFailure) &&
      physical instanceof Error &&
      "code" in physical &&
      "syscall" in physical &&
      physical.syscall === "open" &&
      (physical.code === "ENOENT" || physical.code === "ENOTDIR")
    )
      return undefined;
    const completed = artifactFileCompletion(cause)?.value;
    const diagnostics = {
      path,
      stage: "installation_properties",
      ...(physical instanceof NonRegularFileReadError
        ? { system_code: physical.code }
        : {}),
      ...(typeof completed !== "string"
        ? {}
        : {
            completed_properties: {
              bytes: Buffer.byteLength(completed, "latin1"),
              sha256: createHash("sha256")
                .update(completed, "latin1")
                .digest("hex"),
              properties: jsonValueSchema.parse(
                ghidraApplicationProperties(completed),
              ),
            },
          }),
    };
    const qualified = mapArtifactFileFailure(cause, (primary) =>
      primary instanceof RegularFileCapacityError
        ? new AnalysisResourceConstraintError(
            "ghidra:installation",
            "file-size",
            primary.message,
            {
              maximum_bytes: primary.maximumBytes,
              observed_bytes: primary.observedBytes.toString(),
            },
            {
              cause: primary,
              diagnostics,
              ...fixedProducerInputAllowance(
                MAX_GHIDRA_INSTALLATION_PROPERTIES_BYTES,
                "The Ghidra installation-properties read allowance",
              ),
            },
          )
        : primary,
    );
    throw ghidraFileFailure(qualified, "ghidra:installation", diagnostics);
  }
};
