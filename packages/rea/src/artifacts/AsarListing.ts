import { setImmediate } from "node:timers/promises";

import { asarNodeSchema } from "./AsarNode.js";
import { ArtifactReaderFailure, type ArtifactEntry } from "./ArtifactReader.js";
import { assertAsarReadActive } from "./AsarFailure.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";

/** Capacity for expanded paths and listing records, independent of packed bytes. */
const MAX_LISTING_BYTES = 64 * 1024 * 1024;
const BLOCK_INTEGRITY_LIMITATION =
  "ASAR block integrity declarations were not validated. Whole-file digest comparison does not establish block integrity or Electron runtime acceptance.";

type AsarListedFacts = Pick<
  ArtifactEntry,
  "declaredIntegrity" | "executable" | "unpacked"
> & { readonly path: string; readonly limitations: readonly string[] };
export type AsarListedEntry = AsarListedFacts &
  (
    | { readonly kind: "directory" | "symlink"; readonly size: number | null }
    | {
        readonly kind: "file";
        readonly size: number;
        readonly packedOffset: number | undefined;
      }
  );

const parseArchiveOffset = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value))
    return undefined;
  const offset = Number(value);
  return Number.isSafeInteger(offset) ? offset : undefined;
};

function* ownChildren(files: Record<string, unknown>) {
  for (const name in files)
    if (Object.hasOwn(files, name)) yield [name, files[name]] as const;
}

/** Decode each node once; admit expanded paths before concatenation and retain no recursive lookup. */
export const readAsarListing = async (
  header: unknown,
  signal?: AbortSignal,
): Promise<AsarListedEntry[]> => {
  const root = asarNodeSchema.parse(header);
  if (root.files === undefined)
    throw new ArtifactReaderFailure("format", "ASAR root has no files table");
  const entries: AsarListedEntry[] = [];
  const pending = [{ parent: "", children: ownChildren(root.files) }];
  let retainedBytes = 0;
  const admitRetainedBytes = (bytes: number): void => {
    retainedBytes += bytes;
    if (retainedBytes > MAX_LISTING_BYTES)
      throw new ArtifactReaderFailure(
        "limit",
        "ASAR expanded listing exceeds its 64 MiB representation budget",
      );
  };
  let examined = 0;
  while (pending.length > 0) {
    if (examined++ % 128 === 0) {
      await setImmediate();
      assertAsarReadActive(signal);
    }
    const frame = pending.at(-1);
    if (frame === undefined) break;
    const next = frame.children.next();
    if (next.done) {
      pending.pop();
      continue;
    }
    const [name, raw] = next.value;
    // A header member is one component, not a host path to normalize. POSIX
    // backslashes remain literal; Windows cannot represent them as components.
    if (
      name.length === 0 ||
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      name.includes("\0") ||
      (process.platform === "win32" && name.includes("\\"))
    )
      throw new ArtifactReaderFailure(
        "path",
        "ASAR header has an unsafe path component",
      );
    const units =
      frame.parent.length + name.length + (frame.parent.length === 0 ? 0 : 1);
    // UTF-16 storage, plus records and traversal bookkeeping. Charge every
    // occurrence even when the engine can share a string prefix.
    admitRetainedBytes(units * 2 + 256);
    const path = frame.parent.length === 0 ? name : `${frame.parent}/${name}`;
    const metadata = asarNodeSchema.parse(raw);
    if (
      metadata.files === undefined &&
      metadata.link === undefined &&
      metadata.size === undefined
    )
      throw new ArtifactReaderFailure(
        "format",
        "ASAR entry has no directory, link or file metadata",
      );
    const declaration = metadata.integrity;
    const supportedIntegrity =
      declaration?.algorithm === "SHA256" &&
      /^[a-f0-9]{64}$/u.test(declaration.hash);
    const limitations: string[] = [];
    if (
      declaration !== undefined &&
      (Object.hasOwn(declaration, "blockSize") ||
        Object.hasOwn(declaration, "blocks"))
    ) {
      // Only declaration presence is observed. Do not interpret or copy an
      // arbitrarily shaped block table, or imply its hashes were checked.
      admitRetainedBytes(BLOCK_INTEGRITY_LIMITATION.length * 2 + 64);
      limitations.push(BLOCK_INTEGRITY_LIMITATION);
    }
    if (declaration !== undefined && !supportedIntegrity) {
      // JSON escaping can expand one source code unit to six characters.
      // Admit its UTF-16 storage and explanatory text before rendering it.
      admitRetainedBytes(
        (declaration.algorithm.length + declaration.hash.length) * 12 + 512,
      );
      const reason =
        declaration.algorithm === "SHA256"
          ? "has an invalid digest representation"
          : "uses an unsupported algorithm";
      limitations.push(
        `ASAR integrity declaration ${reason}; no declaration comparison was performed: ${JSON.stringify({ algorithm: declaration.algorithm, hash: declaration.hash })}.`,
      );
    }
    const facts: AsarListedFacts = {
      path,
      executable: metadata.executable === true,
      unpacked: metadata.unpacked === true,
      declaredIntegrity: supportedIntegrity
        ? { algorithm: "sha256", digest: declaration.hash }
        : null,
      limitations,
    };
    if (metadata.files !== undefined || metadata.link !== undefined)
      entries.push({
        ...facts,
        kind: metadata.files !== undefined ? "directory" : "symlink",
        size: metadata.size ?? null,
      });
    else if (metadata.size !== undefined)
      entries.push({
        ...facts,
        kind: "file",
        size: metadata.size,
        packedOffset: parseArchiveOffset(metadata.offset),
      });
    if (metadata.files !== undefined)
      pending.push({
        parent: path,
        children: ownChildren(metadata.files),
      });
  }
  return entries.sort((left, right) =>
    compareUnicodeCodePoints(left.path, right.path),
  );
};
