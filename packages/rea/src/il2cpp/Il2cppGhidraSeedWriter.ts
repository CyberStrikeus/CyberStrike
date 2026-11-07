import { lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type {
  Il2cppSeedWriterPort,
  Il2cppSeedOutput,
  Il2cppSeedReceipt,
} from "../application/il2cpp/Il2cppSeedWriterPort.js";
import { writeTextParts } from "../application/JsonFiles.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { EvidenceFileError } from "../domain/evidenceErrors.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { Il2cppMetadata } from "../domain/il2cpp/il2cppMetadata.js";
import { err, ok, type Result } from "../domain/result.js";
import { ghidraDefaultBase, il2cppGhidraSeeds } from "./Il2cppGhidraSeeds.js";

const OPERATION = "inspect_il2cpp_metadata";
const invalid = (field: string, message: string) =>
  new AnalysisInputError(OPERATION, undefined, [
    { path: [field], reason: "invalid_value", message },
  ]);

/** Atomic create-only publication, with failed cleanup retained for close retry. */
export class Il2cppGhidraSeedWriter implements Il2cppSeedWriterPort {
  readonly #resources = new ArtifactResourceScope();
  readonly #cleanup = AnalysisCleanupLease.forCloseOwner(
    this.#resources,
    "IL2CPP seed output resources",
  );
  #writing = false;
  async check(
    output: Il2cppSeedOutput,
    options?: ExecutionOptions,
  ): Promise<Result<void, AnalysisError>> {
    if (options?.signal?.aborted)
      return err(
        new AnalysisCancelledError(OPERATION, { cause: options.signal.reason }),
      );
    if (!isAbsolute(output.path))
      return err(
        invalid(
          "ghidra_seeds",
          "Seed output needs an absolute filesystem path.",
        ),
      );
    if (
      output.base !== undefined &&
      !/^0x[0-9a-fA-F]{1,16}$/u.test(output.base)
    )
      return err(
        invalid("seed_base", "Seed base must be a 64-bit hexadecimal address."),
      );
    try {
      await lstat(output.path);
      return err(
        invalid(
          "ghidra_seeds",
          `--ghidra-seeds ${output.path} already exists; seed files are created, never replaced.`,
        ),
      );
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
        return ok(undefined);
      if (cause instanceof Error && "code" in cause && cause.code === "ENOTDIR")
        return err(
          invalid(
            "ghidra_seeds",
            `--ghidra-seeds ${output.path} has a parent path component that is not a directory; choose an output path inside an existing directory.`,
          ),
        );
      return err(
        new EvidenceFileError("write", "io", { path: output.path, cause }),
      );
    }
  }
  async write(
    report: Il2cppMetadata,
    output: Il2cppSeedOutput,
    options?: ExecutionOptions,
  ): Promise<Result<Il2cppSeedReceipt, AnalysisError>> {
    if (this.#writing || this.#resources.hasPending || this.#cleanup.released)
      return err(
        new AnalysisResourceConstraintError(
          OPERATION,
          "capacity",
          "Seed output is busy, closed, or awaiting owned cleanup.",
          { maximum_concurrent_seed_exports: 1 },
        ),
      );
    this.#writing = true;
    try {
      return await this.#resources.run(() =>
        this.#write(report, output, options),
      );
    } finally {
      this.#writing = false;
    }
  }
  async #write(
    report: Il2cppMetadata,
    output: Il2cppSeedOutput,
    options: ExecutionOptions | undefined,
  ): Promise<Result<Il2cppSeedReceipt, AnalysisError>> {
    const ready = await this.check(output, options);
    if (!ready.ok) return ready;
    if (report.binary === null)
      return err(invalid("binary_path", "Ghidra seeds need binary_path."));
    let seeds;
    try {
      seeds = il2cppGhidraSeeds(
        report,
        output.base === undefined
          ? ghidraDefaultBase(report.binary)
          : BigInt(output.base),
      );
    } catch (cause) {
      if (cause instanceof AnalysisError) return err(cause);
      throw cause;
    }
    const written = await writeTextParts(
      [seeds.text],
      output.path,
      false,
      this.#resources,
      options?.signal === undefined
        ? undefined
        : { signal: options.signal, operation: OPERATION },
    );
    if (!written.ok) {
      if (written.error.cleanupIncomplete)
        this.#cleanup.bindCleanupError(written.error);
      return written;
    }
    return ok({
      ...written.value,
      functions: seeds.functions,
      folded: seeds.folded,
      no_body: seeds.no_body,
      unknown: seeds.unknown,
      generic_instances: seeds.generic_instances,
    });
  }
  async close(): Promise<void> {
    try {
      await this.#cleanup.release();
    } catch (cause) {
      if (
        !(cause instanceof ArtifactReaderFailure) ||
        cause.cleanup === undefined
      )
        throw cause;
      const error = new ProviderCleanupError(
        "il2cpp-metadata",
        cause.cleanup.resources,
        { reason: cause.cleanup.reason },
        { cause, operation: OPERATION },
      );
      this.#cleanup.bindCleanupError(error);
      throw error;
    }
  }
}
