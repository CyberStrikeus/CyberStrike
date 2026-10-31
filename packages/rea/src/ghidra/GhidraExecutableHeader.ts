import { createHash } from "node:crypto";
import type { GhidraExecutableHeaderProbe } from "./GhidraInstallation.js";
import type { GhidraInstallationFileOptions } from "./GhidraInstallationProperties.js";
import { err, ok, type Result } from "../domain/result.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import { withArtifactRegularFile } from "../artifacts/ArtifactFileOperation.js";
import { readStableFilePrefix } from "../filesystem/readStableFileBytes.js";
import { ghidraFileFailure } from "./GhidraFileArtifacts.js";

/** Only this prefix is examined; the remainder is never retained or read. */
export const GHIDRA_EXECUTABLE_HEADER_BYTES = 4096;

/** Retain complete prefix observations independently of final descriptor cleanup. */
export const readGhidraExecutableHeader = async (
  path: string,
  options: GhidraInstallationFileOptions,
): Promise<Result<GhidraExecutableHeaderProbe, AnalysisError>> => {
  let completedHeader: GhidraExecutableHeaderProbe | undefined;
  try {
    return ok(
      await options.resourceOwner.run(() =>
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
          async ({ handle: file }) => {
            const observed = await readStableFilePrefix(
              file,
              path,
              GHIDRA_EXECUTABLE_HEADER_BYTES,
              {
                symlinks: "follow",
                ...(options.signal === undefined
                  ? {}
                  : { signal: options.signal }),
              },
            );
            if (observed.size > BigInt(Number.MAX_SAFE_INTEGER))
              throw new AnalysisResourceConstraintError(
                "ghidra:installation",
                "file-size",
                "Executable extent cannot be represented exactly by the header parser",
                {
                  maximum_bytes: Number.MAX_SAFE_INTEGER,
                  observed_bytes: observed.size.toString(),
                },
                {
                  diagnostics: { path, stage: "native_decompiler_header" },
                  retryable: false,
                },
              );
            completedHeader = {
              bytes: observed.bytes,
              size: Number(observed.size),
            };
            return completedHeader;
          },
          "follow",
        ),
      ),
    );
  } catch (cause: unknown) {
    return err(
      ghidraFileFailure(cause, "ghidra:installation", {
        path,
        stage: "native_decompiler_header",
        ...(completedHeader === undefined
          ? {}
          : {
              completed_header: {
                file_bytes: completedHeader.size,
                examined_bytes: completedHeader.bytes.length,
                prefix_sha256: createHash("sha256")
                  .update(completedHeader.bytes)
                  .digest("hex"),
              },
            }),
      }),
    );
  }
};
