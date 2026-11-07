import { safeParseUtf8Json } from "../domain/safeJson.js";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, lstat, opendir, readlink } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  AnalysisCancelledError,
  AnalysisAccessDeniedError,
  AnalysisResourceConstraintError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import type { FirmwareRequest } from "../domain/firmware/firmwareAnalysis.js";
import {
  MAX_FIRMWARE_STAGING_BYTES,
  MAX_FIRMWARE_STAGING_ENTRIES,
} from "../domain/firmware/firmwareAnalysis.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { readLinuxResourceLimits } from "../process/LinuxResourceLimits.js";
import { readBoundedFileBytes } from "../process/BoundedFileBytes.js";
import { FIRMWARE_LIMITS } from "./FirmwareRelease.js";
import { firmwareLimitRecovery } from "./FirmwareFailures.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import type { SafeOutputTree } from "../artifacts/SafeOutputTree.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import {
  withArtifactRegularFile,
  assertArtifactReadActive,
  mapArtifactFileFailure,
  artifactSelectedPathErrno,
} from "../artifacts/ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { readArtifactFileChunks } from "../artifacts/readArtifactFileChunks.js";
import { decodeDirectoryEntryName } from "../filesystem/decodeDirectoryEntryName.js";
import { NonRegularFileReadError } from "../filesystem/RegularFile.js";
import { observedSymlinkTarget } from "../domain/symlinkTarget.js";

/** One regular file or unpublished filesystem entry in a private extraction. */
export interface FirmwareEntry {
  readonly relativePath: string;
  readonly path: string;
  readonly size: number;
  readonly kind: "file" | "symlink" | "special";
  readonly linkTarget: string | null;
  readonly linkTargetHex?: string;
}

const throwIfFirmwareInventoryCancelled = (
  signal: AbortSignal | undefined,
  operation: string,
): void => {
  if (signal?.aborted === true)
    throw new AnalysisCancelledError(operation, { cause: signal.reason });
};

/** Own all firmware reads, including rejected admission and final descriptor cleanup. */
export class FirmwareFileAccess {
  readonly #resources = new ArtifactResourceScope();

  /** Retry retained descriptors without closing admission for future operations. */
  retryCleanup(): Promise<void> {
    return this.#resources.retryCleanup();
  }

  /** Wait for admitted operations and retry every retained descriptor. */
  close(): Promise<void> {
    return this.#resources.close();
  }

  /** Read inherited file policy through this same retryable descriptor owner. */
  async fileSizeCeiling(signal?: AbortSignal): Promise<number> {
    return this.#resources.run(async () => {
      assertArtifactReadActive(signal);
      const limits = await readLinuxResourceLimits(
        {
          address_space_bytes: FIRMWARE_LIMITS.addressSpaceBytes,
          cpu_seconds: FIRMWARE_LIMITS.cpuSeconds,
          file_bytes: Number.MAX_SAFE_INTEGER,
        },
        this.#resources,
      );
      assertArtifactReadActive(signal);
      return limits.file_bytes;
    });
  }

  /** Hash one admitted regular file without retaining its bytes in memory. */
  hash(path: string, signal?: AbortSignal): Promise<string> {
    return this.#resources.run(() => this.#hash(path, signal));
  }

  async #hash(path: string, signal?: AbortSignal): Promise<string> {
    return withArtifactRegularFile(
      path,
      this.#resources,
      signal,
      async ({ handle }) => {
        const hash = createHash("sha256");
        for await (const chunk of readArtifactFileChunks(handle, { signal })) {
          assertArtifactReadActive(signal);
          hash.update(chunk);
        }
        assertArtifactReadActive(signal);
        return hash.digest("hex");
      },
    );
  }

  /** Copy and identify the exact bytes consumed by firmware providers. */
  snapshot(request: FirmwareRequest, root: string, signal: AbortSignal) {
    return this.#resources.run(() => this.#snapshot(request, root, signal));
  }

  async #snapshot(request: FirmwareRequest, root: string, signal: AbortSignal) {
    const sourcePath = absoluteCallerPath(request.input.path);
    let sourceAdmitted = false;
    const fullPath = join(root, "firmware.bin");
    const copied = await withArtifactRegularFile(
      sourcePath,
      this.#resources,
      signal,
      async ({ handle, initial: stat }) => {
        sourceAdmitted = true;
        if (stat.size === 0 || stat.size > FIRMWARE_LIMITS.inputBytes)
          throw firmwareInputFailure(request.operation);
        const hash = createHash("sha256");
        let size = 0;
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            size += chunk.length;
            if (size > FIRMWARE_LIMITS.inputBytes) {
              callback(firmwareInputFailure(request.operation));
              return;
            }
            hash.update(chunk);
            callback(null, chunk);
          },
        });
        await pipeline(
          readArtifactFileChunks(handle, { signal }),
          meter,
          createWriteStream(fullPath, { flags: "wx", mode: 0o600 }),
        );
        return { size, sha256: hash.digest("hex") };
      },
      "follow",
    ).catch((cause: unknown) => {
      // Destination writes and reads after admission retain their own failure.
      throw sourceAdmitted
        ? cause
        : firmwareSourceAdmissionFailure(request.operation, sourcePath, cause);
    });
    const { size, sha256 } = copied;
    await chmod(fullPath, 0o400);
    const selected =
      request.operation === "extract_firmware"
        ? request.input.range
        : undefined;
    const offset = selected?.offset ?? 0;
    const length = selected?.length ?? size;
    if (length === 0 || offset > size || length > size - offset)
      throw new AnalysisInputError(request.operation, undefined, [
        {
          path: ["range"],
          reason: "out_of_range",
          message: `Selected range must be within the ${size}-byte firmware file`,
        },
      ]);
    let inputPath = fullPath;
    if (selected !== undefined) {
      inputPath = join(root, "selected.bin");
      await withArtifactRegularFile(
        fullPath,
        this.#resources,
        signal,
        async ({ handle }) => {
          await pipeline(
            readArtifactFileChunks(handle, {
              start: offset,
              end: offset + length - 1,
              signal,
            }),
            createWriteStream(inputPath, { flags: "wx", mode: 0o600 }),
          );
        },
      );
      await chmod(inputPath, 0o400);
    }
    return {
      subject: { path: sourcePath, sha256, format: "file" as const },
      size,
      inputPath,
      selection: {
        offset,
        length,
        sha256:
          selected === undefined ? sha256 : await this.#hash(inputPath, signal),
      },
    };
  }

  /** Own the exact source descriptor consumed by publication through its final close. */
  publish(
    entry: FirmwareEntry,
    sha256: string,
    tree: SafeOutputTree,
    signal: AbortSignal,
  ) {
    return this.#resources.run(() =>
      withArtifactRegularFile(
        entry.path,
        this.#resources,
        signal,
        ({ handle }) =>
          tree.write(
            entry.relativePath,
            // SafeOutputTree awaits destination setup before consuming. Defer
            // the abort-bound descriptor stream until it has a consumer.
            Readable.from(
              (async function* () {
                assertArtifactReadActive(signal);
                yield* readArtifactFileChunks(handle, { signal });
              })(),
            ),
            { sha256, bytes: entry.size },
            signal,
          ),
      ),
    );
  }

  /**
   * Read a complete bounded report; oversized data is never reported as complete.
   * Each refusal records its observed report state, so an absent or empty report
   * is never conflated with an empty scan or a malformed one.
   */
  async report(
    path: string,
    operation: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.#resources.run(() =>
      withArtifactRegularFile(
        path,
        this.#resources,
        signal,
        async ({ handle }) => {
          const bytes = await readBoundedFileBytes(
            handle,
            FIRMWARE_LIMITS.reportBytes,
          );
          if (bytes === undefined)
            throw firmwareReportFailure(
              operation,
              "oversized",
              `Report exceeded ${FIRMWARE_LIMITS.reportBytes} bytes`,
            );
          assertArtifactReadActive(signal);
          if (bytes.length === 0)
            throw firmwareReportFailure(operation, "empty", "Report is empty");
          try {
            const decoded = safeParseUtf8Json(bytes);
            if (!decoded.ok) throw decoded.cause;
            return decoded.value;
          } catch (cause: unknown) {
            throw firmwareReportFailure(
              operation,
              "invalid_json",
              "Tool report is not valid complete JSON",
              cause,
            );
          }
        },
      ).catch((cause: unknown) => {
        throw mapArtifactFileFailure(cause, (primary) =>
          primary instanceof NonRegularFileReadError
            ? firmwareReportFailure(
                operation,
                "not_regular_file",
                "Report is not a regular file",
                primary,
              )
            : primary instanceof Error &&
                "code" in primary &&
                primary.code === "ENOENT"
              ? firmwareReportFailure(
                  operation,
                  "missing",
                  "Report was not created",
                  primary,
                )
              : primary,
        );
      }),
    );
  }
}

/** Observed state of a producer report that cannot supply analysis Evidence. */
type FirmwareReportState =
  | "missing"
  | "empty"
  | "oversized"
  | "invalid_json"
  | "not_regular_file";

const firmwareReportFailure = (
  operation: string,
  state: FirmwareReportState,
  reason: string,
  cause?: unknown,
) =>
  new AnalysisOutputError(operation, reason, {
    cause,
    diagnostics: { report_state: state },
  });

/** Attribute only failures observed while admitting the caller-selected source. */
const firmwareSourceAdmissionFailure = (
  operation: string,
  path: string,
  cause: unknown,
): unknown =>
  mapArtifactFileFailure(cause, (primary) => {
    if (primary instanceof NonRegularFileReadError)
      return firmwareInputFailure(operation, primary);
    if (
      primary instanceof Error &&
      "code" in primary &&
      (primary.code === "EACCES" || primary.code === "EPERM")
    )
      return new AnalysisAccessDeniedError(operation, path, primary.code, {
        cause: primary,
      });
    if (artifactSelectedPathErrno(primary) !== undefined)
      return new AnalysisInputError(operation, { cause: primary }, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: "Firmware source must resolve to an accessible regular file",
        },
      ]);
    return primary;
  });

const firmwareInputFailure = (operation: string, cause?: unknown) => {
  const message = `Firmware must be a nonempty regular file no larger than ${String(FIRMWARE_LIMITS.inputBytes)} bytes. Select a stable copy within this allowance. ${firmwareLimitRecovery(`The firmware input allowance is ${String(FIRMWARE_LIMITS.inputBytes)} bytes`)}`;
  return new AnalysisInputError(operation, { cause, userMessage: message }, [
    {
      path: ["path"],
      reason: "out_of_range",
      message,
    },
  ]);
};

/** Inventory private output without following links, enforcing aggregate staging budgets. */
export const inventoryFirmwareOutput = async (
  root: string,
  maxBytes: number,
  maxEntries: number,
  operation: string,
  signal?: AbortSignal,
): Promise<FirmwareEntry[]> => {
  const entries: FirmwareEntry[] = [];
  const pending = [root];
  let bytes = 0;
  let count = 0;
  while (pending.length > 0) {
    throwIfFirmwareInventoryCancelled(signal, operation);
    const directory = pending.pop();
    if (directory === undefined) break;
    const directoryStat = await lstat(directory).catch((cause: unknown) => {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
        return undefined;
      throw cause;
    });
    if (
      directoryStat === undefined ||
      !directoryStat.isDirectory() ||
      directoryStat.isSymbolicLink()
    )
      continue;
    const handle = await opendir(directory, {
      encoding: "buffer" as BufferEncoding,
    }).catch((cause: unknown) => {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
        return undefined;
      throw cause;
    });
    if (handle === undefined) continue;
    const names: string[] = [];
    for await (const entry of handle) {
      throwIfFirmwareInventoryCancelled(signal, operation);
      count++;
      if (count > maxEntries)
        throw firmwareStagingLimit(operation, "max_output_files", maxEntries);
      const decoded = decodeDirectoryEntryName(entry.name);
      if (decoded.kind === "unrepresentable")
        throw new AnalysisOutputError(
          operation,
          "Extracted filename cannot be represented losslessly as UTF-8",
          {
            diagnostics: {
              directory: relative(root, directory),
              raw_name_hex: decoded.rawHex,
            },
          },
        );
      names.push(decoded.name);
    }
    for (const name of names.sort()) {
      const path = join(directory, name);
      const stat = await lstat(path).catch((cause: unknown) => {
        if (
          cause instanceof Error &&
          "code" in cause &&
          cause.code === "ENOENT"
        )
          return undefined;
        throw cause;
      });
      if (stat === undefined) continue;
      if (stat.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (stat.isFile()) bytes += stat.size;
      if (bytes > maxBytes)
        throw firmwareStagingLimit(operation, "max_output_bytes", maxBytes);
      const linkTarget = stat.isSymbolicLink()
        ? observedSymlinkTarget(await readlink(path, { encoding: "buffer" }))
        : undefined;
      entries.push({
        path,
        relativePath: relative(root, path).split(sep).join("/"),
        size: stat.size,
        kind: stat.isSymbolicLink()
          ? "symlink"
          : stat.isFile()
            ? "file"
            : "special",
        linkTarget: linkTarget?.text ?? null,
        ...(linkTarget === undefined ? {} : { linkTargetHex: linkTarget.hex }),
      });
    }
  }
  return entries.sort((a, b) =>
    compareUnicodeCodePoints(a.relativePath, b.relativePath),
  );
};

/**
 * Recovery for one staging budget refusal. At the schema ceiling a larger
 * selection is impossible, so that case must not recommend raising the value.
 */
export const firmwareStagingBudgetRemediation = (
  budget: "max_output_files" | "max_output_bytes",
  selectedLimit: number,
): string => {
  const maximum =
    budget === "max_output_files"
      ? MAX_FIRMWARE_STAGING_ENTRIES
      : MAX_FIRMWARE_STAGING_BYTES;
  const description =
    budget === "max_output_files"
      ? "staging entry budget, which counts extracted directories and links"
      : "staging file-byte budget, checked during extraction";
  if (selectedLimit < maximum)
    return `The ${description} was exceeded (${budget}=${String(selectedLimit)}; supported maximum ${String(maximum)}). Increase ${budget} up to ${String(maximum)} if the larger extraction is required, or select a materially narrower firmware byte range. analysis_timeout_ms does not raise this staging allowance.`;
  return `The ${description} reached its supported maximum (${budget}=${String(selectedLimit)}; maximum ${String(maximum)}). Raising ${budget} further is not supported. Select a smaller firmware byte range or analyze a smaller image. analysis_timeout_ms does not raise this staging allowance.`;
};

/** The same selected aggregate budget is enforced during and after extraction. */
const firmwareStagingLimit = (
  operation: string,
  field: "max_output_files" | "max_output_bytes",
  maximum: number,
) =>
  new AnalysisResourceConstraintError(
    operation,
    "capacity",
    `Firmware staging exceeded ${field} (${maximum})`,
    { [field]: maximum },
    {
      retryable: false,
      remediationAction: firmwareStagingBudgetRemediation(field, maximum),
    },
  );

/** Bind producer paths to the selected input or private extraction tree. */
export const firmwareLogicalPath = (
  path: string,
  inputPath: string,
  outputRoot: string,
): string => {
  if (path === inputPath) return "$input";
  const rel = relative(outputRoot, path);
  if (
    !isAbsolute(path) ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  )
    throw new AnalysisOutputError(
      "extract_firmware",
      `Provider reported a path outside its owned output: ${path}`,
    );
  return rel === "" ? "$output" : `$output/${rel.split(sep).join("/")}`;
};
