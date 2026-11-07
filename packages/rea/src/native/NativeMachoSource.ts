import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { readFileHandleRange } from "../filesystem/readFileHandleRange.js";
import {
  withArtifactRegularFile,
  assertArtifactReadActive,
  artifactSelectedPathErrno,
} from "../artifacts/ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { hashStableRootArtifactHandle } from "../artifacts/inventory/hashStableRootArtifact.js";

/** A positional reader for one slice of the descriptor bound to the target. */
export interface NativeMachoSource {
  readonly bytes: number;
  readSlice(
    sliceOffset: number,
    sliceSize: number,
    offset: number,
    length: number,
  ): Promise<Uint8Array>;
}

/** Preserve the producer outcome when later identity validation fails. */
export class NativeMachoSourceVerificationFailure extends ArtifactReaderFailure {
  constructor(
    readonly outcome:
      | { readonly kind: "completed"; readonly value: unknown }
      | { readonly kind: "failed"; readonly cause: unknown },
    readonly verificationCause: unknown,
  ) {
    super(
      verificationCause instanceof ArtifactReaderFailure
        ? verificationCause.reason
        : "io",
      verificationCause instanceof Error
        ? verificationCause.message
        : String(verificationCause),
      {
        cause: verificationCause,
        ...(verificationCause instanceof ArtifactReaderFailure &&
        verificationCause.cancellation !== undefined
          ? { cancellation: verificationCause.cancellation }
          : {}),
      },
      verificationCause instanceof ArtifactReaderFailure
        ? verificationCause.details
        : undefined,
    );
  }

  /** Compatibility accessor for a completed callback; failures remain in outcome. */
  get completed(): unknown {
    return this.outcome.kind === "completed" ? this.outcome.value : undefined;
  }
}

/**
 * Bind native command output and bounded slice reads to one selected target.
 * Every callback outcome is checked against the same descriptor and selected
 * path before it can escape, including returned and thrown failures.
 * The supplied scope retains the exact descriptor owner if cleanup fails.
 */
export const withNativeMachoSource = <T>(
  target: Pick<BinaryTarget, "path" | "sha256">,
  resources: ArtifactResourceScope,
  signal: AbortSignal | undefined,
  run: (source: NativeMachoSource) => Promise<T>,
): Promise<T> =>
  withArtifactRegularFile(
    target.path,
    resources,
    signal,
    async ({ handle, initial }) => {
      const verify = async () => {
        const digest = await hashStableRootArtifactHandle(
          target.path,
          handle,
          initial,
          signal,
        ).catch((cause: unknown) => {
          if (artifactSelectedPathErrno(cause) !== undefined)
            throw new ArtifactReaderFailure(
              "integrity",
              `Active Mach-O target changed: ${target.path}`,
              { cause },
            );
          throw cause;
        });
        if (digest.sha256 !== target.sha256)
          throw new ArtifactReaderFailure(
            "integrity",
            `Active Mach-O target digest changed: expected ${target.sha256}, observed ${digest.sha256}`,
          );
      };
      await verify();
      const source: NativeMachoSource = {
        bytes: initial.size,
        async readSlice(sliceOffset, sliceSize, offset, length) {
          if (
            !Number.isSafeInteger(sliceOffset) ||
            !Number.isSafeInteger(sliceSize) ||
            !Number.isSafeInteger(offset) ||
            !Number.isSafeInteger(length) ||
            sliceOffset < 0 ||
            sliceSize < 0 ||
            offset < 0 ||
            length < 0 ||
            sliceOffset > initial.size - sliceSize ||
            offset > sliceSize - length
          )
            throw new ArtifactReaderFailure(
              "format",
              "Mach-O read exceeds the selected slice.",
            );
          const bytes = await readFileHandleRange(
            handle,
            sliceOffset + offset,
            length,
            () => assertArtifactReadActive(signal),
          );
          if (bytes.byteLength !== length)
            throw new ArtifactReaderFailure(
              "integrity",
              "Mach-O source changed during slice read.",
            );
          return bytes;
        },
      };
      let outcome:
        | { readonly kind: "completed"; readonly value: T }
        | { readonly kind: "failed"; readonly cause: unknown };
      try {
        outcome = { kind: "completed", value: await run(source) };
      } catch (cause: unknown) {
        outcome = { kind: "failed", cause };
      }
      try {
        await verify();
      } catch (cause: unknown) {
        throw new NativeMachoSourceVerificationFailure(outcome, cause);
      }
      if (outcome.kind === "failed") throw outcome.cause;
      return outcome.value;
    },
  );
