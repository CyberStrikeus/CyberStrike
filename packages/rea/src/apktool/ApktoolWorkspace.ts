import { readArtifactFileChunks } from "../artifacts/readArtifactFileChunks.js";
import {
  ArtifactReaderFailure,
  type ArtifactTraversalOptions,
} from "../artifacts/ArtifactReader.js";
import { createHash } from "node:crypto";
import { chmod, open } from "node:fs/promises";
import { join } from "node:path";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { DirectoryArtifactReader } from "../artifacts/DirectoryArtifactReader.js";
import {
  assertArtifactReadActive,
  artifactSelectedPathErrno,
  mapArtifactFileFailure,
  withArtifactFileHandle,
  withArtifactRegularFile,
} from "../artifacts/ArtifactFileOperation.js";
import {
  AnalysisInputError,
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisProtocolError,
} from "../domain/analysisErrorCore.js";
import {
  NonRegularFileReadError,
  sameRegularFileState,
} from "../filesystem/RegularFile.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import type { ApktoolCommandCleanup } from "./ApktoolCommandCleanup.js";

/** One decode's descriptors and root; removal follows confirmed child cleanup. */
export class ApktoolWorkspace {
  readonly #files = new ArtifactResourceScope();
  #snapshot:
    | { readonly path: string; readonly bytes: number; readonly sha256: string }
    | undefined;

  constructor(
    readonly root: PrivateRuntimeRoot,
    readonly commands: ApktoolCommandCleanup,
    readonly removeWorkspace?: (path: string) => Promise<void>,
  ) {}

  get snapshot() {
    return this.#snapshot;
  }

  get path(): string {
    return this.root.path;
  }

  async close(): Promise<void> {
    await this.#files.close();
    if (this.commands.pendingFor(this.path))
      throw new Error(
        "The decode workspace remains owned until its Apktool command stops",
      );
    if (this.removeWorkspace !== undefined)
      await this.removeWorkspace(this.path);
    await this.root.close();
  }

  /** Stream one admitted input into a separately owned immutable snapshot. */
  async snapshotInput(path: string, operation: string, signal?: AbortSignal) {
    let admitted = false;
    try {
      return await withArtifactRegularFile(
        path,
        this.#files,
        signal,
        async ({ handle: source, initial }) => {
          admitted = true;
          const output = join(this.path, "input.apk");
          const file = await open(output, "wx", 0o600);
          await withArtifactFileHandle(
            output,
            file,
            this.#files,
            signal,
            async (destination) => {
              let copied = 0;
              const hash = createHash("sha256");
              for await (const value of readArtifactFileChunks(source, {
                start: 0,
                end: initial.size,
                signal,
              })) {
                assertArtifactReadActive(signal);
                if (!Buffer.isBuffer(value))
                  throw new AnalysisProtocolError(
                    "APK snapshot stream returned non-byte data",
                  );
                copied += value.length;
                if (copied > initial.size)
                  throw new AnalysisArtifactChangedError(
                    operation,
                    path,
                    "APK size exceeded the observed size during snapshot copying",
                  );
                hash.update(value);
                let offset = 0;
                while (offset < value.length) {
                  assertArtifactReadActive(signal);
                  const written = await destination.write(
                    value,
                    offset,
                    value.length - offset,
                  );
                  if (written.bytesWritten === 0)
                    throw new AnalysisProtocolError(
                      "APK snapshot write made no progress",
                    );
                  offset += written.bytesWritten;
                }
              }
              const final = await source.stat();
              if (
                copied !== initial.size ||
                !sameRegularFileState(initial, final)
              )
                throw new AnalysisArtifactChangedError(
                  operation,
                  path,
                  "APK size or file state changed during snapshot copying",
                );
              this.#snapshot = {
                path,
                bytes: copied,
                sha256: hash.digest("hex"),
              };
            },
          );
          await chmod(output, 0o400);
          return this.#snapshot!;
        },
        "follow",
      );
    } catch (cause) {
      throw mapArtifactFileFailure(cause, (physical) => {
        if (admitted) return physical;
        if (
          physical instanceof Error &&
          "code" in physical &&
          (physical.code === "EACCES" || physical.code === "EPERM")
        )
          return new AnalysisAccessDeniedError(operation, path, physical.code, {
            cause: physical,
          });
        if (
          physical instanceof NonRegularFileReadError ||
          artifactSelectedPathErrno(physical) !== undefined
        )
          return new AnalysisInputError(operation, { cause: physical }, [
            {
              path: ["path"],
              reason: "invalid_value",
              message: "APK input must resolve to an accessible regular file",
            },
          ]);
        return physical;
      });
    }
  }

  /** Reject non-regular output before reading; every failed close retains its owner. */
  async readText(
    path: string,
    budget: number,
    signal?: AbortSignal,
  ): Promise<{
    text: string | null;
    truncated: boolean;
    /** Raw bytes represented by the retained prefix, before UTF-8 decoding. */
    sourceBytes: number;
  }> {
    let admitted = false;
    try {
      return await withArtifactRegularFile(
        path,
        this.#files,
        signal,
        async ({ handle: file, initial }) => {
          admitted = true;
          const bytes = Buffer.alloc(budget + 1);
          let length = 0;
          while (length < bytes.length) {
            assertArtifactReadActive(signal);
            const result = await file.read(
              bytes,
              length,
              bytes.length - length,
              null,
            );
            if (result.bytesRead === 0) break;
            length += result.bytesRead;
          }
          const final = await file.stat();
          if (!sameRegularFileState(initial, final))
            throw new AnalysisProtocolError(
              `Apktool output changed while being read: ${path}`,
            );
          const truncated = length > budget;
          const sourceBytes = Math.min(length, budget);
          try {
            return {
              text: new TextDecoder("utf-8", { fatal: true }).decode(
                bytes.subarray(0, sourceBytes),
                { stream: truncated },
              ),
              truncated,
              sourceBytes,
            };
          } catch (cause) {
            throw new AnalysisProtocolError(
              `apktool produced invalid UTF-8 in ${path}`,
              { cause },
            );
          }
        },
      );
    } catch (cause) {
      if (
        !admitted &&
        cause instanceof Error &&
        "code" in cause &&
        cause.code === "ENOENT"
      )
        return { text: null, truncated: false, sourceBytes: 0 };
      throw cause;
    }
  }

  async *entries(
    path: string,
    signal?: AbortSignal,
    maximumEntries?: number,
    onOmission?: ArtifactTraversalOptions["onOmission"],
  ) {
    const reader = new DirectoryArtifactReader(path);
    const owner = { kind: "reader" as const, resource: path, reader };
    this.#files.retain(owner);
    let failed: { cause: unknown } | undefined;
    try {
      yield* reader.entries(signal, {
        ...(maximumEntries === undefined ? {} : { maximumEntries }),
        ...(onOmission === undefined ? {} : { onOmission }),
      });
    } catch (cause) {
      failed = { cause };
      throw cause;
    } finally {
      const released = await this.#files.release(owner);
      if (released.kind === "failed")
        throw failed === undefined
          ? released.cause
          : ArtifactReaderFailure.withCleanup(
              failed.cause,
              ArtifactReaderFailure.cleanupObservation(released.cause, path),
            );
    }
  }
}
