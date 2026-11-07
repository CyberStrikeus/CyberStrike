import { createHash } from "node:crypto";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ZipArtifactReader } from "../artifacts/ZipArtifactReader.js";
import { streamChunkToBuffer } from "../artifacts/StreamBytes.js";
import type {
  AndroidJniLibraryObservation,
  AndroidJniReport,
  AndroidJniSelection,
  AndroidJniLibraryCheckpoint,
} from "../domain/android/androidJniBindings.js";
import { compileAndroidJniLibrarySelection } from "../domain/android/androidJniBindings.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { inspectAndroidJniLibrary } from "../native/android/AndroidJniLibrary.js";
import {
  JadxInterruption,
  throwIfJadxInterrupted,
} from "./JadxInterruption.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { analysisClientFailureForOperation } from "../providers/AnalysisClientFailure.js";

/** Bounds cover the live library buffer, completed scan work and retained JSON separately. */
export const ANDROID_JNI_LIBRARY_LIMITS = Object.freeze({
  libraryBytes: 64 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  factsBytes: 16 * 1024 * 1024,
  entries: 100_000,
  libraries: 2048,
});
export interface AndroidJniLibraries {
  readonly libraries: readonly AndroidJniLibraryObservation[];
  readonly inventory: AndroidJniReport["library_inventory"];
}

/** Read each exact ZIP occurrence once from the provider's immutable admitted APK. */
export const readAndroidJniLibraries = async (input: {
  readonly snapshot: string;
  readonly apkSha256: string;
  readonly selection: AndroidJniSelection;
  readonly resources: ArtifactResourceScope;
  readonly signal: AbortSignal;
  readonly interruption: (reason: unknown) => AnalysisError;
  readonly onObservation: (checkpoint: AndroidJniLibraryCheckpoint) => void;
}): Promise<AndroidJniLibraries> =>
  input.resources
    .run(async () => {
      const reader = new ZipArtifactReader(
        input.snapshot,
        "apk",
        ANDROID_JNI_LIBRARY_LIMITS.factsBytes,
      );
      const owner = {
        kind: "reader" as const,
        resource: input.snapshot,
        reader,
      };
      const libraries: AndroidJniLibraryObservation[] = [];
      const inventory: AndroidJniReport["library_inventory"] = {
        status: "complete",
        examined_entries: 0,
        selected_libraries: 0,
        unknowns: [],
      };
      let totalBytes = 0;
      let factsBytes = 0;
      let primary: unknown;
      let failed = false;
      let inProgress: AndroidJniLibraryObservation | undefined;
      const selectLibrary = compileAndroidJniLibrarySelection(input.selection);
      try {
        for await (const entry of reader.entries(input.signal)) {
          throwIfJadxInterrupted(input.signal);
          const source_index = inventory.examined_entries++;
          if (inventory.examined_entries > ANDROID_JNI_LIBRARY_LIMITS.entries) {
            inventory.status = "partial";
            inventory.unknowns.push(
              "APK entry inventory exceeded the bounded entry allowance; remaining libraries are unknown.",
            );
            break;
          }
          const match = /^lib\/([^/]+)\/([^/]+\.so)$/u.exec(entry.path);
          if (match === null || entry.kind === "directory") continue;
          const abi = match[1]!;
          if (!selectLibrary({ abi, path: entry.path })) continue;
          if (libraries.length >= ANDROID_JNI_LIBRARY_LIMITS.libraries) {
            inventory.status = "partial";
            inventory.unknowns.push(
              "Selected native-library occurrence inventory exceeded its retained-state allowance.",
            );
            break;
          }
          const identity = {
            library_id: `jni_library_${createHash("sha256")
              .update(JSON.stringify([input.apkSha256, entry.adapterKey]))
              .digest("hex")}`,
            source_index,
            source_key: entry.adapterKey,
            path: entry.path,
            source_path: entry.sourcePath ?? entry.path,
            abi,
            sha256: null,
            size: null,
            declared_size: entry.declaredSize,
            compressed_size: entry.compressedSize,
          };
          inProgress = {
            ...identity,
            facts: null,
            failure: {
              kind: "incomplete",
              message: "Native-library inspection did not complete",
            },
          };
          let observation: AndroidJniLibraryObservation;
          const limit =
            entry.declaredSize === null ||
            !Number.isSafeInteger(entry.declaredSize) ||
            entry.declaredSize < 0 ||
            entry.declaredSize > ANDROID_JNI_LIBRARY_LIMITS.libraryBytes ||
            entry.declaredSize >
              ANDROID_JNI_LIBRARY_LIMITS.totalBytes - totalBytes;
          if (entry.kind !== "file" || entry.encrypted || limit) {
            observation = {
              ...identity,
              facts: null,
              failure: {
                kind: entry.encrypted
                  ? "encrypted"
                  : entry.kind !== "file"
                    ? "unsupported"
                    : "capacity",
                message: entry.encrypted
                  ? "Selected native library is encrypted."
                  : entry.kind !== "file"
                    ? "Selected native library is not a regular ZIP member."
                    : "Selected native library exceeds the bounded library or cumulative scan-byte allowance.",
              },
            };
          } else {
            totalBytes += entry.declaredSize!;
            try {
              const bytes = Buffer.alloc(entry.declaredSize!);
              let offset = 0;
              const stream = await reader.open(entry, input.signal);
              try {
                for await (const chunk of stream) {
                  throwIfJadxInterrupted(input.signal);
                  const data = streamChunkToBuffer(chunk);
                  if (data.length > bytes.length - offset)
                    throw new ArtifactReaderFailure(
                      "integrity",
                      "Native library exceeds its declared ZIP size",
                    );
                  data.copy(bytes, offset);
                  offset += data.length;
                }
              } finally {
                stream.destroy();
              }
              if (offset !== bytes.length)
                throw new ArtifactReaderFailure(
                  "integrity",
                  "Native library is shorter than its declared ZIP size",
                );
              throwIfJadxInterrupted(input.signal);
              const sha256 = createHash("sha256").update(bytes).digest("hex");
              inProgress = {
                ...identity,
                sha256,
                size: bytes.length,
                facts: null,
                failure: {
                  kind: "incomplete",
                  message: "Native-library parsing did not complete",
                },
              };
              const parsed = await inspectAndroidJniLibrary(bytes, {
                signal: input.signal,
              });
              throwIfJadxInterrupted(input.signal);
              observation = {
                ...identity,
                sha256,
                size: bytes.length,
                facts: parsed.ok ? parsed.value : null,
                failure: parsed.ok ? null : parsed.error,
              };
            } catch (cause: unknown) {
              if (cause instanceof JadxInterruption) throw cause;
              if (
                cause instanceof ArtifactReaderFailure &&
                cause.reason === "cancelled"
              )
                throw input.interruption(input.signal.reason);
              observation = {
                ...identity,
                facts: null,
                failure: {
                  kind:
                    cause instanceof ArtifactReaderFailure
                      ? cause.reason
                      : "io",
                  message:
                    cause instanceof Error ? cause.message : String(cause),
                },
              };
            }
          }
          factsBytes += jsonValueByteLength(
            observation as unknown as JsonValue,
            ANDROID_JNI_LIBRARY_LIMITS.factsBytes,
          );
          if (factsBytes > ANDROID_JNI_LIBRARY_LIMITS.factsBytes) {
            inventory.status = "partial";
            inventory.unknowns.push(
              "Selected native-library facts exceed the retained-facts allowance; remaining occurrences are unknown.",
            );
            break;
          }
          libraries.push(observation);
          inProgress = undefined;
        }
        inventory.selected_libraries = libraries.length;
        throwIfJadxInterrupted(input.signal);
      } catch (cause: unknown) {
        failed = true;
        primary =
          cause instanceof JadxInterruption
            ? input.interruption(cause.reason)
            : cause instanceof ArtifactReaderFailure &&
                cause.reason === "cancelled"
              ? input.interruption(input.signal.reason)
              : cause;
      }
      if (failed) {
        inventory.status = "partial";
        inventory.unknowns.push(
          "Native-library scan did not exhaust APK inventory; unexamined selected occurrences remain unknown.",
        );
      }
      if (inProgress !== undefined) {
        // An interrupted member still has an observed carrier identity; retain
        // its digest only if those bytes actually completed authentication.
        libraries.push(inProgress);
      }
      inventory.selected_libraries = libraries.length;
      const checkpoint: AndroidJniLibraryCheckpoint = {
        scan_state:
          failed || inventory.status !== "complete"
            ? "interrupted"
            : "completed",
        libraries: [...libraries],
        inventory: { ...inventory, unknowns: [...inventory.unknowns] },
      };
      try {
        input.onObservation(checkpoint);
      } catch (cause: unknown) {
        if (!failed) {
          failed = true;
          primary = cause;
        }
      }
      const released = await input.resources.release(owner);
      if (released.kind === "failed") {
        const operation = "inspect_android_jni_bindings";
        const cleanup = new ProviderCleanupError(
          "jadx",
          [owner.resource],
          {
            reason:
              released.cause instanceof Error
                ? released.cause.message
                : String(released.cause),
          },
          { operation, cause: released.cause },
        );
        if (!failed && input.signal.aborted) {
          failed = true;
          primary = input.interruption(input.signal.reason);
        }
        const failure = failed
          ? analysisErrorWithCleanupFailure(
              primary instanceof AnalysisError
                ? primary
                : analysisClientFailureForOperation(primary, "jadx", operation),
              cleanup,
              operation,
            )
          : cleanup;
        released.lease.bindCleanupError(failure);
        throw failure;
      }
      if (failed) throw primary;
      throwIfJadxInterrupted(input.signal);
      return { libraries, inventory };
    })
    .catch((cause: unknown) => {
      // A prior owned close can reject scope admission before this callback runs.
      if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined)
        throw analysisClientFailureForOperation(
          cause,
          "jadx",
          "inspect_android_jni_bindings",
        );
      throw cause;
    });
