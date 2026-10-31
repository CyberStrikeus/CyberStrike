import { symlinkTargetIdentity } from "../../domain/process/symlinkTarget.js";
import type {
  FilesystemCheckpoint,
  ProcessFilesystemSnapshot,
} from "../../domain/process/processCapture.js";
import { sep } from "node:path";

const unobservedAbsenceReason = (
  path: string,
  phase: "before" | "after",
  snapshot: ProcessFilesystemSnapshot,
): string | undefined => {
  const alias = path.slice(0, path.indexOf(":"));
  if (!snapshot.completeRoots.includes(alias))
    return `The ${phase} snapshot did not exhaust path enumeration under ${alias}; absence remains unknown.`;
  const rootPath = `${alias}:.`;
  if (path === rootPath) return undefined;
  if (snapshot.coverage.unobserved_subtrees === undefined)
    return `The ${phase} snapshot has no subtree coverage facts; descendant absence remains unknown.`;
  for (const subtree of snapshot.coverage.unobserved_subtrees) {
    const below =
      subtree.path === rootPath
        ? path.startsWith(`${alias}:`)
        : path.startsWith(`${subtree.path}${sep}`);
    if (below || (subtree.reason === "observer_owned" && path === subtree.path))
      return `The ${phase} snapshot did not observe the subtree at ${subtree.path} (${subtree.reason}); descendant absence remains unknown.`;
  }
  return undefined;
};

/** Classify effects only from observed path absence, metadata, and content hashes. */
export const classifyFilesystemEffects = (
  before: ProcessFilesystemSnapshot,
  after: ProcessFilesystemSnapshot,
): FilesystemCheckpoint["effects"] => {
  const beforeByPath = new Map(before.files.map((file) => [file.path, file]));
  const afterByPath = new Map(after.files.map((file) => [file.path, file]));
  return [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])]
    .sort()
    .map((path) => {
      const beforeFile = beforeByPath.get(path) ?? null;
      const afterFile = afterByPath.get(path) ?? null;
      const reason =
        beforeFile === null
          ? unobservedAbsenceReason(path, "before", before)
          : afterFile === null
            ? unobservedAbsenceReason(path, "after", after)
            : undefined;
      if (reason !== undefined)
        return {
          path,
          status: "unknown",
          before: beforeFile,
          after: afterFile,
          reason,
        } as const;
      if (beforeFile === null) {
        if (afterFile === null)
          throw new TypeError(`Filesystem effect ${path} has no file state`);
        return {
          path,
          status: "created",
          before: null,
          after: afterFile,
        } as const;
      }
      if (afterFile === null)
        return {
          path,
          status: "deleted",
          before: beforeFile,
          after: null,
        } as const;
      const metadataChanged =
        beforeFile.type !== afterFile.type ||
        beforeFile.mode !== afterFile.mode ||
        beforeFile.size !== afterFile.size;
      const beforeTarget =
        beforeFile.type === "symlink"
          ? symlinkTargetIdentity(beforeFile)
          : null;
      const afterTarget =
        afterFile.type === "symlink" ? symlinkTargetIdentity(afterFile) : null;
      // Different decoded spellings prove different bytes even when an old
      // capture cannot recover either target's complete byte identity.
      const targetTextChanged =
        beforeFile.type === "symlink" &&
        afterFile.type === "symlink" &&
        beforeFile.symlink_target !== null &&
        afterFile.symlink_target !== null &&
        beforeFile.symlink_target !== afterFile.symlink_target;
      if (
        !metadataChanged &&
        !targetTextChanged &&
        beforeFile.type === "symlink" &&
        afterFile.type === "symlink" &&
        (beforeTarget === null || afterTarget === null)
      )
        return {
          path,
          status: "unknown",
          before: beforeFile,
          after: afterFile,
          reason: "A legacy symlink target has no unambiguous byte identity.",
        } as const;
      if (
        !metadataChanged &&
        beforeFile.type === "file" &&
        afterFile.type === "file" &&
        (beforeFile.sha256 === null || afterFile.sha256 === null)
      )
        return {
          path,
          status: "unknown",
          before: beforeFile,
          after: afterFile,
          reason:
            "A file content hash is unavailable in at least one snapshot; matching metadata does not establish unchanged contents.",
        } as const;
      return {
        path,
        status:
          metadataChanged ||
          targetTextChanged ||
          beforeTarget !== afterTarget ||
          beforeFile.sha256 !== afterFile.sha256
            ? "modified"
            : "unchanged",
        before: beforeFile,
        after: afterFile,
      } as const;
    });
};
