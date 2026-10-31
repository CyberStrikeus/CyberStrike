import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflate } from "node:zlib";
import { ArtifactReaderFailure } from "../ArtifactReader.js";
import { abortIfNeeded } from "../ArtifactHash.js";

interface MemberStreamOptions {
  readonly sourceBytes: number;
  readonly compressed: boolean;
  readonly header: Buffer | undefined;
  readonly expectedBytes: number | undefined;
  readonly maxBytes: number;
  readonly signal: AbortSignal;
  readonly charge?: (bytes: number) => void;
  readonly complete?: (bytes: number) => Promise<void>;
}

/** Observe a bounded plaintext prefix, then drain the existing stream owner. */
export const readPyInstallerMemberPrefix = async (
  openSource: (signal: AbortSignal) => Promise<Readable>,
  options: Omit<MemberStreamOptions, "header" | "charge" | "complete">,
  length: number,
): Promise<Buffer> => {
  const stopped = new AbortController();
  const prefixComplete = new Error("PyInstaller member prefix observed");
  const signal = AbortSignal.any([options.signal, stopped.signal]);
  const source = await openSource(signal);
  const stream = pyInstallerMemberStream(source, {
    ...options,
    header: undefined,
    signal,
  });
  const prefix = Buffer.alloc(length);
  let copied = 0;
  stream.output.on("data", (chunk: Buffer) => {
    copied += chunk.copy(prefix, copied, 0, length - copied);
    if (copied === length) stopped.abort(prefixComplete);
  });
  try {
    await stream.completion;
  } catch (cause: unknown) {
    // Only our accepted early stop is successful. Native I/O, malformed zlib,
    // declaration failures, and caller cancellation keep their original reason.
    if (
      !(cause instanceof ArtifactReaderFailure) ||
      cause.reason !== "cancelled" ||
      cause.cause !== prefixComplete
    )
      throw cause;
  }
  abortIfNeeded(options.signal);
  return prefix.subarray(0, copied);
};

/** Backpressure bounds plaintext independently of the untrusted declared size. */
export const pyInstallerMemberStream = (
  source: Readable,
  options: MemberStreamOptions,
): { readonly output: Readable; readonly completion: Promise<void> } => {
  let bytes = 0;
  let headerSent = false;
  let completing = false;
  let failure: ArtifactReaderFailure | undefined;
  const prependHeader = (): void => {
    if (!headerSent && options.header !== undefined)
      output.push(options.header);
    headerSent = true;
  };
  const output = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        abortIfNeeded(options.signal);
        bytes += chunk.length;
        if (bytes > options.maxBytes)
          throw new ArtifactReaderFailure(
            "limit",
            "PyInstaller member exceeds its plaintext budget",
          );
        options.charge?.(chunk.length);
        prependHeader();
        callback(null, chunk);
      } catch (cause: unknown) {
        callback(asError(cause));
      }
    },
    flush(callback) {
      completing = true;
      void (async () => {
        abortIfNeeded(options.signal);
        if (
          inflate !== undefined &&
          inflate.bytesWritten !== options.sourceBytes
        )
          throw new ArtifactReaderFailure(
            "integrity",
            "Compressed PyInstaller member did not consume its complete declared source span",
          );
        if (
          options.expectedBytes !== undefined &&
          bytes !== options.expectedBytes
        )
          throw new ArtifactReaderFailure(
            "integrity",
            "PyInstaller member size disagrees with its declaration or previous observation",
          );
        await options.complete?.(bytes);
        abortIfNeeded(options.signal);
        prependHeader();
      })().then(
        () => {
          completing = false;
          try {
            abortIfNeeded(options.signal);
          } catch (cause: unknown) {
            callback(asError(cause));
            return;
          }
          callback();
        },
        (cause: unknown) => {
          completing = false;
          callback(asError(cause));
        },
      );
    },
  });
  // A consumer can retire its reader before attaching its stream error handler.
  output.on("error", () => undefined);
  const onAbort = (): void => {
    // Verification and private-file cleanup own their accepted native I/O.
    if (completing) return;
    // The descriptor source owns cancellation until its native read settles.
    // Retiring it downstream earlier would hide a native I/O rejection.
    if (!source.readableEnded && !source.destroyed) return;
    output.destroy(
      new ArtifactReaderFailure(
        "cancelled",
        "PyInstaller member read cancelled",
        { cause: options.signal.reason },
      ),
    );
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  const onSourceFailure = (cause: unknown): void => {
    failure ??=
      cause instanceof ArtifactReaderFailure
        ? cause
        : new ArtifactReaderFailure(
            "io",
            "PyInstaller member source could not be read",
            { cause },
          );
    output.destroy(failure);
  };
  source.on("error", onSourceFailure);
  const inflate = options.compressed ? createInflate() : undefined;
  inflate?.on("error", (cause: unknown) => {
    failure ??=
      cause instanceof ArtifactReaderFailure
        ? cause
        : new ArtifactReaderFailure(
            "format",
            "Compressed PyInstaller member is not a complete zlib stream",
            { cause },
          );
    output.destroy(failure);
  });
  const completion = (
    inflate === undefined
      ? pipeline(source, output)
      : pipeline(source, inflate, output)
  )
    .catch((cause: unknown) => {
      // Pipeline can reject with the native error that caused a mapped output
      // failure. Completion and output must expose the same boundary reason.
      throw failure ?? cause;
    })
    .finally(() => {
      options.signal.removeEventListener("abort", onAbort);
      source.removeListener("error", onSourceFailure);
    });
  // Preserve rejection for the owning scope without an early unhandled promise.
  void completion.catch(() => undefined);
  if (options.signal.aborted) onAbort();
  return { output, completion };
};

const asError = (cause: unknown): Error =>
  cause instanceof Error
    ? cause
    : new ArtifactReaderFailure("format", "PyInstaller member read failed", {
        cause,
      });
