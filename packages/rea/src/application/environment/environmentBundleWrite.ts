import { createHash } from "node:crypto";
import { mkdir, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";

import {
  AnalysisInputError,
  AnalysisAccessDeniedError,
} from "../../domain/analysisErrorCore.js";
import { AnalysisCleanupLease } from "../../artifacts/AnalysisCleanupLease.js";
import { ArtifactFileCleanupFailure } from "../../artifacts/ArtifactFileOperation.js";
import { RegularFileCleanupFailure } from "../../filesystem/OwnedRegularFile.js";
import { readFileHandleChunks } from "../../filesystem/readFileHandleChunks.js";
import { streamChunkToBuffer } from "../../artifacts/StreamBytes.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { SafeOutputTree } from "../../artifacts/SafeOutputTree.js";
import { outputDirectoryAdmissionRefusal } from "../../artifacts/SafeOutputTreeAdmission.js";
import { SafeOutputTreeCreationFailure } from "../../artifacts/SafeOutputTreeCreationFailure.js";
import { RegularFileChangedError } from "../../filesystem/RegularFile.js";
import { withRegularFile } from "../RegularFileRead.js";
import {
  ENVIRONMENT_EXPORT_OPERATION,
  type EnvironmentBundlePlan,
} from "./environmentBundle.js";
import type {
  EnvironmentExportInput,
  WrittenBundleFile,
} from "./environmentExport.js";

/**
 * A host failure on one file the bundle writer was reading or writing.
 * Descriptor operations such as `read`, `write` and `fsync` fail without a
 * path, so this names the file and the direction of the failed operation.
 */
export class BundleFileHostFailure extends Error {
  constructor(
    readonly path: string,
    readonly operation: "reading" | "writing",
    cause: Error,
  ) {
    super(`${cause.message}, ${operation} ${path}`, { cause });
  }
}

/** An untyped host system failure, which carries an errno-style code. */
const isHostSystemFailure = (cause: unknown): cause is Error =>
  cause instanceof Error &&
  !(cause instanceof ArtifactReaderFailure) &&
  typeof Reflect.get(cause, "code") === "string";

/** Attribute a pathless host failure to the bundle file being written. */
const writingBundleFile = async <Result>(
  directory: string,
  relative: string,
  write: () => Promise<Result>,
): Promise<Result> => {
  try {
    return await write();
  } catch (cause: unknown) {
    if (isHostSystemFailure(cause) && Reflect.get(cause, "path") === undefined)
      throw new BundleFileHostFailure(
        join(directory, relative),
        "writing",
        cause,
      );
    throw cause;
  }
};

/** Read the admitted tarball, attributing host failures to the source. */
async function* tarballChunks(source: BundleTarball): AsyncIterable<unknown> {
  try {
    yield* readFileHandleChunks(source.handle);
  } catch (cause: unknown) {
    if (isHostSystemFailure(cause))
      throw new BundleFileHostFailure(source.path, "reading", cause);
    throw cause;
  }
}

const writeBytes = async (
  tree: SafeOutputTree,
  directory: string,
  relative: string,
  bytes: Buffer,
): Promise<WrittenBundleFile> => {
  const written = await writingBundleFile(directory, relative, () =>
    tree.write(relative, Readable.from([bytes]), {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }),
  );
  return { path: written.relativePath, bytes: written.bytesWritten };
};

/** The package tarball instance admitted once and retained until its owner closes it. */
export interface BundleTarball {
  readonly path: string;
  readonly handle: FileHandle;
  readonly size: number;
}

/** Read and hash the admitted instance, checking its complete length without retaining its contents. */
export const bundleTarballDigest = async (
  source: BundleTarball,
): Promise<string> => {
  const hash = createHash("sha256");
  let observed = 0;
  for await (const chunk of tarballChunks(source)) {
    const bytes = streamChunkToBuffer(chunk);
    observed += bytes.length;
    if (observed > source.size) throw new RegularFileChangedError(source.path);
    hash.update(bytes);
  }
  if (observed !== source.size) throw new RegularFileChangedError(source.path);
  return hash.digest("hex");
};

/** Hash and copy only the instance retained before destination admission. */
const writeTarball = async (
  tree: SafeOutputTree,
  directory: string,
  relative: string,
  source: BundleTarball,
): Promise<WrittenBundleFile> => {
  const sha256 = await bundleTarballDigest(source);
  const written = await writingBundleFile(directory, relative, () =>
    tree.write(relative, Readable.from(tarballChunks(source)), {
      bytes: source.size,
      sha256,
    }),
  );
  return { path: written.relativePath, bytes: written.bytesWritten };
};

/** The output owner anchors every create and verifies the complete tree before publication. */
const writeBundleFiles = async (
  input: EnvironmentExportInput,
  plan: EnvironmentBundlePlan,
  tarball?: BundleTarball,
): Promise<readonly WrittenBundleFile[]> => {
  const resources = new ArtifactResourceScope();
  let tree: SafeOutputTree | undefined;
  let written: WrittenBundleFile[] | undefined;
  let outcome:
    | {
        readonly kind: "completed";
        readonly files: readonly WrittenBundleFile[];
      }
    | { readonly kind: "failed"; readonly cause: unknown };
  try {
    if (input.exclusiveDestination !== true)
      await mkdir(dirname(input.directory), { recursive: true, mode: 0o700 });
    try {
      tree = await SafeOutputTree.create(input.directory, process.platform, {
        acceptExistingEmpty: input.exclusiveDestination !== true,
      });
    } catch (cause: unknown) {
      if (cause instanceof SafeOutputTreeCreationFailure) tree = cause.tree;
      throw cause;
    }
    written = [];
    for (const file of plan.files)
      written.push(
        await writeBytes(
          tree,
          input.directory,
          file.path,
          Buffer.from(file.content),
        ),
      );
    written.push(
      await writeBytes(
        tree,
        input.directory,
        plan.copies.manifest,
        input.manifest.bytes,
      ),
    );
    written.push(
      await writeBytes(
        tree,
        input.directory,
        plan.copies.evidence,
        input.evidence.bytes,
      ),
    );
    if (plan.copies.tarball !== null && tarball !== undefined)
      written.push(
        await writeTarball(tree, input.directory, plan.copies.tarball, tarball),
      );
    await tree.commit();
    outcome = { kind: "completed", files: written };
  } catch (cause: unknown) {
    outcome = { kind: "failed", cause };
  }
  const owner = tree;
  if (owner !== undefined) {
    const closed = await resources.release({
      kind: "lease",
      resource: input.directory,
      lease: { release: () => owner.closeHandles() },
    });
    if (closed.kind === "failed")
      throw resources.cleanupFailure(outcome, [closed]);
  }
  if (outcome.kind === "failed") {
    if (owner?.published === true && written !== undefined) return written;
    // Only a destination refusal can blame the selected directory.
    throw outputDirectoryAdmissionRefusal(
      ENVIRONMENT_EXPORT_OPERATION,
      "directory",
      outcome.cause,
    );
  }
  return outcome.files;
};

/** A package tarball path that names no readable regular file. */
export const packageTarballRefusal = (
  path: string,
  cause: unknown,
): AnalysisInputError =>
  new AnalysisInputError(
    ENVIRONMENT_EXPORT_OPERATION,
    {
      cause,
      userMessage: `${path} must name a readable regular package tarball.`,
    },
    [
      {
        path: ["package_tarball"],
        reason: "invalid_value",
        message: "The package tarball must be an existing regular file.",
      },
    ],
  );

/** Admit the package tarball once and retain it through `use`; a close it cannot confirm stays bound to its owner. */
export const withBundleTarball = async <Value>(
  path: string,
  use: (tarball: BundleTarball) => Promise<Value>,
): Promise<Value> => {
  const resources = new ArtifactResourceScope();
  let admitted = false;
  try {
    return await withRegularFile(
      path,
      async (handle, state) => {
        admitted = true;
        return use({ path, handle, size: state.size });
      },
      { resources },
    );
  } catch (cause: unknown) {
    if (cause instanceof RegularFileCleanupFailure)
      throw new ArtifactFileCleanupFailure(
        cause,
        AnalysisCleanupLease.forCloseOwner(cause.owner, path),
      );
    if (!admitted && cause instanceof Error && "code" in cause) {
      if (cause.code === "EACCES" || cause.code === "EPERM")
        throw new AnalysisAccessDeniedError(
          ENVIRONMENT_EXPORT_OPERATION,
          path,
          cause.code,
          { cause },
        );
      if (
        ["ENOENT", "ENOTDIR", "ENAMETOOLONG", "EISDIR", "ENOTFILE"].includes(
          String(cause.code),
        )
      )
        throw packageTarballRefusal(path, cause);
    }
    throw cause;
  }
};

/** Retain one tarball instance across planning output writes and final stability verification. */
export const writeEnvironmentBundle = (
  input: EnvironmentExportInput,
  plan: EnvironmentBundlePlan,
): Promise<readonly WrittenBundleFile[]> =>
  plan.packageSource.kind === "tarball"
    ? withBundleTarball(plan.packageSource.path, (tarball) =>
        writeBundleFiles(input, plan, tarball),
      )
    : writeBundleFiles(input, plan);
