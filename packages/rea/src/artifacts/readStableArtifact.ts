import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { sameRegularFileState } from "../filesystem/RegularFile.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";
import type { ArtifactResourceScope } from "./ArtifactResourceScope.js";
import {
  artifactFileCompletion,
  artifactSelectedPathErrno,
  withArtifactFileHandle,
  assertArtifactReadActive,
} from "./ArtifactFileOperation.js";

/** Exact physical read completed before descriptor finalization. */
export interface StableArtifactSnapshot {
  readonly bytes: Buffer;
  readonly sha256: string;
}

/** Recover only the exact stable-read outcome retained by descriptor finalization. */
export const completedStableArtifact = (
  cause: unknown,
): StableArtifactSnapshot | undefined => {
  const value = artifactFileCompletion(cause)?.value;
  if (
    value === null ||
    typeof value !== "object" ||
    !("bytes" in value) ||
    !Buffer.isBuffer(value.bytes) ||
    !("sha256" in value) ||
    typeof value.sha256 !== "string"
  )
    return undefined;
  return { bytes: value.bytes, sha256: value.sha256 };
};

/** Filesystem boundary for stable reads, including deterministic replacement probes. */
export interface StableArtifactFileSystem {
  lstat(path: string): Promise<BigIntStats>;
  open(path: string, flags: number): Promise<FileHandle>;
}

const FILE_SYSTEM: StableArtifactFileSystem = {
  lstat: (path) => lstat(path, { bigint: true }),
  open,
};

const afterValidation = async <T>(
  path: string,
  stage: string,
  read: () => Promise<T>,
): Promise<T> => {
  try {
    return await read();
  } catch (cause) {
    if (artifactSelectedPathErrno(cause) !== undefined)
      throw new ArtifactReaderFailure(
        "integrity",
        `Artifact changed ${stage}: ${path}`,
        { cause },
      );
    throw cause;
  }
};

/** Read one bounded regular file and reject replacement or in-place changes. */
export const readStableArtifact = async (
  path: string,
  maximumBytes: number,
  signal?: AbortSignal,
  fileSystem: StableArtifactFileSystem = FILE_SYSTEM,
  resourceScope?: ArtifactResourceScope,
): Promise<StableArtifactSnapshot> => {
  assertArtifactReadActive(signal);
  const before = await fileSystem.lstat(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new ArtifactReaderFailure(
      "path",
      `Expected a regular file without a symlink: ${path}`,
    );
  const maximumSize = BigInt(maximumBytes);
  if (before.size > maximumSize)
    throw new ArtifactReaderFailure(
      "limit",
      `Selected artifact exceeds ${String(maximumBytes)} bytes: ${path}`,
      { boundary: "file-size" },
    );
  const file = await afterValidation(path, "before open", () =>
    fileSystem.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ),
  );
  return withArtifactFileHandle(
    path,
    file,
    resourceScope,
    signal,
    async (file) => {
      const initial = await file.stat({ bigint: true });
      if (
        !initial.isFile() ||
        initial.dev !== before.dev ||
        initial.ino !== before.ino
      )
        throw new ArtifactReaderFailure(
          "integrity",
          `Artifact changed before open: ${path}`,
        );
      assertArtifactReadActive(signal);
      // A raced descriptor size must not allocate beyond the selected budget.
      // These private bytes are published only after the exact count and both
      // file identities below validate, so an incomplete read exposes no tail.
      const bytes = Buffer.allocUnsafe(
        Number(initial.size > maximumSize ? maximumSize : initial.size),
      );
      const overflow = Buffer.allocUnsafe(65536);
      const hash = createHash("sha256");
      let count = 0;
      for (;;) {
        assertArtifactReadActive(signal);
        const inside = count < bytes.length;
        const target = inside ? bytes : overflow;
        const offset = inside ? count : 0;
        const wanted = Math.min(65536, target.length - offset);
        const { bytesRead } = await file.read(target, offset, wanted, count);
        // EOF still passes through the original final metadata/cancellation
        // checks. A rejected physical read remains primary over cancellation.
        if (bytesRead === 0) break;
        assertArtifactReadActive(signal);
        if (
          !Number.isSafeInteger(bytesRead) ||
          bytesRead < 0 ||
          bytesRead > wanted
        )
          throw new ArtifactReaderFailure(
            "format",
            `Artifact descriptor returned an invalid byte count: ${path}`,
          );
        count += bytesRead;
        if (count > maximumBytes)
          throw new ArtifactReaderFailure(
            "limit",
            `Selected artifact grew beyond its byte limit: ${path}`,
            { boundary: "file-size" },
          );
        // Read growth into bounded scratch space while preserving physical
        // read failures and byte-budget refusal ahead of final integrity checks.
        hash.update(target.subarray(offset, offset + bytesRead));
      }
      const after = await file.stat({ bigint: true });
      const current = await afterValidation(path, "during read", () =>
        fileSystem.lstat(path),
      );
      if (
        [after, current].some((stat) => !sameRegularFileState(initial, stat)) ||
        BigInt(count) !== initial.size
      )
        throw new ArtifactReaderFailure(
          "integrity",
          `Artifact changed during read: ${path}`,
        );
      assertArtifactReadActive(signal);
      return {
        bytes,
        sha256: hash.digest("hex"),
      };
    },
  );
};
