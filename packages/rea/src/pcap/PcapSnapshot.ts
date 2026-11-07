import { regularFileCancellation } from "../filesystem/OwnedRegularFile.js";
import { createHash } from "node:crypto";
import { chmod, open, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import {
  assertRegularFileActive,
  openRegularFile,
  RegularFileAdmissionFailure,
  sameRegularFileState,
} from "../filesystem/RegularFile.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import {
  RuntimeControlUnavailableError,
  runtimeControlCapabilityError,
} from "../process/RuntimeControlUnavailableError.js";
import { privateWorkspaceFailure } from "../process/privateWorkspaceFailure.js";

const OPERATION = "inspect_pcap_capture";
const MAX_CAPTURE_BYTES = 2 * 1024 ** 3;

/** An owned capture copy and every descriptor needed to release it safely. */
export class PcapSnapshot {
  private readonly handles = new Set<OwnedFileHandle>();
  private readonly completionCleanup = new Map<
    OwnedFileHandle,
    AnalysisError
  >();
  readonly path: string;
  readonly configurationPath: string;
  private constructor(private readonly root: PrivateRuntimeRoot) {
    this.path = join(root.path, "capture.pcap");
    this.configurationPath = join(root.path, "configuration");
  }

  static async create(): Promise<PcapSnapshot> {
    try {
      return new PcapSnapshot(
        await PrivateRuntimeRoot.create({ prefix: "rea-pcap-" }),
      );
    } catch (cause) {
      if (cause instanceof RuntimeControlUnavailableError)
        throw runtimeControlCapabilityError("pcap", OPERATION, cause);
      throw privateWorkspaceFailure("pcap", OPERATION, cause, null);
    }
  }

  private own(handle: OwnedFileHandle): OwnedFileHandle {
    this.handles.add(handle);
    return handle;
  }
  private async release(handle: OwnedFileHandle): Promise<void> {
    await handle.close();
    this.handles.delete(handle);
    this.completionCleanup.get(handle)?.resolveCleanup();
    this.completionCleanup.delete(handle);
  }
  private async releaseCompleted(
    handle: OwnedFileHandle,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await this.release(handle);
    } catch (cleanupCause) {
      const cleanup = new ProviderCleanupError(
        "pcap",
        [this.path],
        { reason: "Owned snapshot descriptor close failed" },
        { operation: OPERATION, cause: cleanupCause },
      );
      this.completionCleanup.set(handle, cleanup);
      if (signal?.aborted !== true) throw cleanup;
      const cancelled = new AnalysisCancelledError(OPERATION, {
        cause: signal.reason,
        cleanup: {
          reason: "Owned snapshot descriptor close could not be confirmed",
          resources: [this.path],
        },
      });
      cancelled
        .retainSecondaryFailure(cleanup)
        .bindCleanupDependencies([cleanup]);
      throw cancelled;
    }
  }

  async capture(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ bytes: number; sha256: string }> {
    const sourceRead = async <T>(read: () => Promise<T>): Promise<T> => {
      try {
        return await read();
      } catch (cause) {
        const cancellation = regularFileCancellation(cause);
        if (cancellation !== undefined) throw cause;
        if (cause instanceof AnalysisError) throw cause;
        if (
          cause instanceof Error &&
          "code" in cause &&
          (cause.code === "EACCES" || cause.code === "EPERM")
        )
          throw new AnalysisAccessDeniedError(OPERATION, path, cause.code, {
            cause,
          });
        throw new AnalysisInputError(OPERATION, { cause }, [
          {
            path: ["path"],
            reason: "invalid_value",
            message: `Cannot read selected capture ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
          },
        ]);
      }
    };
    try {
      assertRegularFileActive(signal);
      await mkdir(this.configurationPath, { mode: 0o700 });
      const source = await sourceRead(async () => {
        try {
          const { handle } = await openRegularFile(path, {
            symlinks: "follow",
            signal,
          });
          return this.own(new OwnedFileHandle(handle));
        } catch (cause) {
          if (cause instanceof RegularFileAdmissionFailure) {
            this.own(cause.owner);
            throw cause.cause;
          }
          throw cause;
        }
      });
      const before = await sourceRead(() =>
        source.handle.stat({ bigint: true }),
      );
      if (before.size > BigInt(MAX_CAPTURE_BYTES))
        throw new AnalysisResourceConstraintError(
          OPERATION,
          "file-size",
          "Capture exceeds the owned-snapshot disk budget",
          { max_capture_bytes: MAX_CAPTURE_BYTES },
          fixedAllowanceOptions(
            "the owned capture snapshot allowance",
            "input",
          ),
        );
      const destination = this.own(
        new OwnedFileHandle(await open(this.path, "wx", 0o600)),
      );
      const buffer = Buffer.alloc(64 * 1024);
      const hash = createHash("sha256");
      let copied = 0;
      while (copied <= Number(before.size)) {
        assertRegularFileActive(signal);
        const { bytesRead } = await sourceRead(() =>
          source.handle.read(
            buffer,
            0,
            Math.min(buffer.length, Number(before.size) - copied + 1),
            copied,
          ),
        );
        assertRegularFileActive(signal);
        if (bytesRead === 0) break;
        copied += bytesRead;
        if (BigInt(copied) > before.size)
          throw new AnalysisArtifactChangedError(
            OPERATION,
            path,
            "Capture grew during acquisition",
          );
        const chunk = buffer.subarray(0, bytesRead);
        await destination.handle.writeFile(chunk);
        hash.update(chunk);
      }
      const after = await sourceRead(() =>
        source.handle.stat({ bigint: true }),
      );
      const selected = await stat(path, { bigint: true }).catch(
        (cause: unknown) => {
          if (
            cause instanceof Error &&
            "code" in cause &&
            (cause.code === "EACCES" || cause.code === "EPERM")
          )
            throw new AnalysisAccessDeniedError(OPERATION, path, cause.code, {
              cause,
            });
          throw new AnalysisArtifactChangedError(
            OPERATION,
            path,
            "Selected path became unavailable during acquisition",
            { cause },
          );
        },
      );
      if (
        BigInt(copied) !== before.size ||
        !sameRegularFileState(before, after) ||
        !sameRegularFileState(before, selected)
      )
        throw new AnalysisArtifactChangedError(
          OPERATION,
          path,
          "Capture identity or contents changed during acquisition",
        );
      await this.releaseCompleted(source, signal);
      await this.releaseCompleted(destination, signal);
      await chmod(this.path, 0o400);
      assertRegularFileActive(signal);
      return { bytes: copied, sha256: hash.digest("hex") };
    } catch (cause) {
      if (cause instanceof RegularFileAdmissionFailure) this.own(cause.owner);
      const primary =
        cause instanceof RegularFileAdmissionFailure ? cause.cause : cause;
      const cancellation = regularFileCancellation(primary);
      if (cancellation !== undefined)
        throw new AnalysisCancelledError(OPERATION, {
          cause: cancellation.reason,
        });
      if (cause instanceof AnalysisError) throw cause;
      throw privateWorkspaceFailure("pcap", OPERATION, primary, this.root.path);
    }
  }

  /** Recheck byte identity after both tools; a read-only mode alone is not proof. */
  async verify(
    expected: { bytes: number; sha256: string },
    selectedPath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      const { handle } = await openRegularFile(this.path, {
        symlinks: "reject",
        signal,
      });
      const file = this.own(new OwnedFileHandle(handle));
      const before = await file.handle.stat({ bigint: true });
      const buffer = Buffer.alloc(64 * 1024);
      const hash = createHash("sha256");
      let bytes = 0;
      while (bytes <= expected.bytes) {
        assertRegularFileActive(signal);
        const read = await file.handle.read(
          buffer,
          0,
          Math.min(buffer.length, expected.bytes - bytes + 1),
          bytes,
        );
        if (read.bytesRead === 0) break;
        bytes += read.bytesRead;
        hash.update(buffer.subarray(0, read.bytesRead));
      }
      const after = await file.handle.stat({ bigint: true });
      const selected = await stat(this.path, { bigint: true });
      if (
        bytes !== expected.bytes ||
        hash.digest("hex") !== expected.sha256 ||
        !sameRegularFileState(before, after) ||
        !sameRegularFileState(before, selected)
      )
        throw new AnalysisArtifactChangedError(
          OPERATION,
          selectedPath,
          "Owned packet snapshot changed during tool analysis.",
        );
      await this.releaseCompleted(file, signal);
      assertRegularFileActive(signal);
    } catch (cause) {
      if (cause instanceof RegularFileAdmissionFailure) this.own(cause.owner);
      const primary =
        cause instanceof RegularFileAdmissionFailure ? cause.cause : cause;
      const cancellation = regularFileCancellation(primary);
      if (cancellation !== undefined)
        throw new AnalysisCancelledError(OPERATION, {
          cause: cancellation.reason,
        });
      if (cause instanceof AnalysisError) throw cause;
      throw new AnalysisArtifactChangedError(
        OPERATION,
        selectedPath,
        "Cannot establish the owned packet snapshot's post-analysis identity.",
        { cause },
      );
    }
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.handles].map((handle) => this.release(handle)),
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, "Capture descriptor cleanup failed");
    await this.root.close();
  }
}
