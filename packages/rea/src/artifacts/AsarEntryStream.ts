import type { FileHandleChunkStream } from "../filesystem/readFileHandleChunks.js";
import { Readable } from "node:stream";

import { ArtifactReaderFailure } from "./ArtifactReader.js";
import {
  assertAsarReadActive,
  asarCancellationFailure,
  asarFailure,
} from "./AsarFailure.js";

/** Close an ASAR file handle before honoring cancellation of an empty member. */
export const closeAsarHandle = async (
  close: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> => {
  await close();
  assertAsarReadActive(signal);
};

/** Validate and contextualize bytes read from one ASAR member source. */
export const readValidatedAsarEntry = (
  source: FileHandleChunkStream,
  expectedBytes: number | undefined,
  entryPath: string,
  archivePath: string,
  signal?: AbortSignal,
): Readable => {
  const expectedExtent =
    expectedBytes === undefined ? undefined : BigInt(expectedBytes);
  const completionFailure = (): ArtifactReaderFailure | undefined => {
    const coverage = source.readCoverage();
    if (coverage.kind !== "complete")
      return new ArtifactReaderFailure(
        "integrity",
        `ASAR entry read coverage is incomplete: ${entryPath}`,
      );
    if (expectedExtent !== undefined && coverage.bytes !== expectedExtent)
      return new ArtifactReaderFailure(
        "integrity",
        `ASAR entry size disagrees with its header: ${entryPath}`,
      );
    if (signal?.aborted) return asarCancellationFailure(signal.reason);
    return undefined;
  };
  const output = Readable.from(
    (async function* () {
      const iterator = source[Symbol.asyncIterator]();
      try {
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          const chunk: unknown = next.value;
          if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array))
            throw new ArtifactReaderFailure(
              "format",
              `ASAR entry did not return bytes: ${entryPath}`,
            );
          const coverage = source.readCoverage();
          if (expectedExtent !== undefined && coverage.bytes > expectedExtent)
            throw new ArtifactReaderFailure(
              "integrity",
              `ASAR entry exceeded its declared size: ${entryPath}`,
            );
          if (coverage.kind === "complete" && signal?.aborted) {
            const failure = completionFailure();
            if (failure !== undefined) throw failure;
          }
          yield chunk;
        }
        const failure = completionFailure();
        if (failure !== undefined) throw failure;
      } catch (cause: unknown) {
        throw asarFailure(archivePath, `read ${entryPath}`, cause);
      } finally {
        try {
          await iterator.return?.();
        } catch {
          // Preserve the read failure; source destruction below owns cleanup.
        }
        if (!source.destroyed) source.destroy();
      }
    })(),
  );
  const onSourceError = (cause: unknown): void => {
    const completedCancellation =
      cause instanceof ArtifactReaderFailure &&
      cause.reason === "cancelled" &&
      source.readCoverage().kind === "complete"
        ? completionFailure()
        : undefined;
    output.destroy(
      completedCancellation ??
        asarFailure(archivePath, `read ${entryPath}`, cause),
    );
  };
  source.on("error", onSourceError);
  source.once("close", () => source.removeListener("error", onSourceError));
  const onAbort = (): void => {
    if (
      source.readCoverage().kind === "complete" &&
      !output.destroyed &&
      (source.errored === null ||
        (source.errored instanceof ArtifactReaderFailure &&
          source.errored.reason === "cancelled"))
    ) {
      const failure = completionFailure();
      if (failure !== undefined) output.destroy(failure);
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  output.once("close", () => {
    signal?.removeEventListener("abort", onAbort);
    if (!source.destroyed) source.destroy();
  });
  if (signal?.aborted) onAbort();
  return output;
};
