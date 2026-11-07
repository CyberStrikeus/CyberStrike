import { assertArtifactReadActive } from "../artifacts/ArtifactFileOperation.js";
import type { BigIntStats } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, sep } from "node:path";

import { isPathWithinRoot } from "../domain/localPath.js";

const FRAMEWORK_NAME = "Electron Framework.framework";
const BINARY_NAME = "Electron Framework";
const MAX_SYMLINK_HOPS = 32;

/** Filesystem facts owned by path admission and consumed unchanged by the reader. */
export interface ElectronFusePathNode {
  readonly path: string;
  readonly metadata: BigIntStats;
}
export interface ResolvedElectronFuseFile {
  readonly path: string;
  readonly metadata: BigIntStats;
  readonly nodes: readonly ElectronFusePathNode[];
}
export interface ResolvedElectronFuseTarget {
  readonly selectedPath: string;
  readonly file: ResolvedElectronFuseFile;
}

/** A selected path is not an admitted Electron bundle or regular file. */
export class ElectronFusePathFailure extends Error {
  constructor(
    readonly reason: "invalid_value" | "invalid_format",
    message: string,
  ) {
    super(message);
    this.name = "ElectronFusePathFailure";
  }
}

type WalkResult =
  | ({ readonly kind: "file" } & ResolvedElectronFuseFile)
  | { readonly kind: "absent" | "escapes" | "not-file" | "loop" };

/**
 * Admit a regular executable, a macOS app bundle, or an Electron Framework
 * binary reached through `Versions/Current` without leaving the framework.
 */
export const resolveElectronFuseTarget = async (
  selectedPath: string,
  signal?: AbortSignal,
): Promise<ResolvedElectronFuseTarget> => {
  assertArtifactReadActive(signal);
  const metadata = await lstat(selectedPath, { bigint: true });
  let file: ResolvedElectronFuseFile;
  if (metadata.isSymbolicLink())
    file = await resolveFrameworkSymlink(selectedPath, signal);
  else if (metadata.isFile())
    file =
      frameworkRootOf(selectedPath) === null
        ? { path: selectedPath, metadata, nodes: [] }
        : await resolveFrameworkSymlink(selectedPath, signal);
  else if (metadata.isDirectory()) {
    file = await resolveBundleBinary(selectedPath, signal);
    file = {
      ...file,
      nodes: [{ path: selectedPath, metadata }, ...file.nodes],
    };
  } else
    throw new ElectronFusePathFailure(
      "invalid_format",
      `Expected a regular file or Electron app bundle: ${selectedPath}`,
    );
  return { selectedPath, file };
};

const resolveFrameworkSymlink = async (
  selectedPath: string,
  signal?: AbortSignal,
): Promise<ResolvedElectronFuseFile> => {
  const root = frameworkRootOf(selectedPath);
  if (root === null)
    throw new ElectronFusePathFailure(
      "invalid_format",
      `Expected a regular file without a symlink: ${selectedPath}`,
    );
  const nodes = await requireFrameworkRoot(root, selectedPath);
  const relativePath = relativeInside(root, selectedPath);
  if (relativePath === null)
    throw new ElectronFusePathFailure(
      "invalid_value",
      `Framework symlink escapes ${FRAMEWORK_NAME}: ${selectedPath}`,
    );
  return requireFile(
    await resolveInside(root, relativePath, signal),
    selectedPath,
    nodes,
  );
};

const resolveBundleBinary = async (
  selectedPath: string,
  signal?: AbortSignal,
): Promise<ResolvedElectronFuseFile> => {
  const directory = await resolveDirectorySuffix(selectedPath, signal);
  const name = basename(directory.path);
  let file: ResolvedElectronFuseFile;
  if (name === FRAMEWORK_NAME)
    file = await resolveKnownBinary(directory.path, selectedPath, signal);
  else if (name.endsWith(".app"))
    file = await resolveKnownBinary(
      appendPath(directory.path, "Contents", "Frameworks", FRAMEWORK_NAME),
      selectedPath,
      signal,
    );
  else
    throw new ElectronFusePathFailure(
      "invalid_format",
      `Expected an Electron .app bundle, ${FRAMEWORK_NAME} directory, or executable file: ${selectedPath}`,
    );
  return { ...file, nodes: [...directory.nodes, ...file.nodes] };
};

/** Reduce directory suffixes only when doing so preserves filesystem selection. */
const resolveDirectorySuffix = async (
  selectedPath: string,
  signal?: AbortSignal,
): Promise<{
  readonly path: string;
  readonly nodes: readonly ElectronFusePathNode[];
}> => {
  let path = selectedPath;
  const pending: string[] = [];
  const nodes: ElectronFusePathNode[] = [];
  while (true) {
    assertArtifactReadActive(signal);
    const name = basename(path);
    // lstat("link/") follows a link; inspect the named component itself.
    if (name !== "") while (path.endsWith(sep)) path = path.slice(0, -1);
    if (name === "." || name === "..") {
      pending.push(name);
      path = dirname(path);
      continue;
    }
    const component = pending.pop();
    if (component === undefined) return { path, nodes };
    if (component === ".") continue;
    const metadata = await lstat(path, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new ElectronFusePathFailure(
        "invalid_value",
        `A bundle path ending in '..' requires a real directory before each parent segment: ${selectedPath}`,
      );
    nodes.push({ path, metadata });
    path = dirname(path);
  }
};

/** `root` is the framework directory for both an `.app` and a framework selection. */
const resolveKnownBinary = async (
  root: string,
  bundle: string,
  signal: AbortSignal | undefined,
): Promise<ResolvedElectronFuseFile> => {
  const nodes = await requireFrameworkRoot(root, bundle);
  for (const candidate of [
    BINARY_NAME,
    `Versions/Current/${BINARY_NAME}`,
    `Versions/A/${BINARY_NAME}`,
  ]) {
    const selected = await resolveInside(root, candidate, signal);
    if (selected.kind === "file") return requireFile(selected, bundle, nodes);
    if (selected.kind !== "absent")
      throw pathWalkFailure(selected.kind, bundle);
  }
  throw new ElectronFusePathFailure(
    "invalid_value",
    `Electron Framework binary was not found inside ${bundle}.`,
  );
};

const resolveInside = async (
  root: string,
  relativePath: string,
  signal?: AbortSignal,
): Promise<WalkResult> => {
  const pending = relativePath.split("/").filter((segment) => segment !== "");
  const resolved: string[] = [];
  const nodes: ElectronFusePathNode[] = [];
  let fileMetadata: BigIntStats | undefined;
  let hops = 0;
  let last: "file" | "directory" | undefined;
  while (pending.length > 0) {
    assertArtifactReadActive(signal);
    const segment = pending.shift() ?? "";
    if (segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) return { kind: "escapes" };
      resolved.pop();
      last = "directory";
      continue;
    }
    const absolute = appendPath(root, ...resolved, segment);
    if (!isPathWithinRoot(root, absolute)) return { kind: "escapes" };
    let metadata;
    try {
      metadata = await lstat(absolute, { bigint: true });
    } catch (cause: unknown) {
      if (isMissing(cause)) return { kind: "absent" };
      throw cause;
    }
    if (metadata.isSymbolicLink()) {
      nodes.push({ path: absolute, metadata });
      hops += 1;
      if (hops > MAX_SYMLINK_HOPS) return { kind: "loop" };
      const rawTarget = await readlink(absolute, { encoding: "buffer" });
      let target: string;
      try {
        // A replacement character can alias a different, valid sibling name.
        // Preserve a literal UTF-8 BOM too: it is part of a filesystem name.
        target = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(rawTarget);
      } catch {
        throw new ElectronFusePathFailure(
          "invalid_value",
          `Framework symlink target is not valid UTF-8 (raw target bytes: ${rawTarget.toString("hex")}): ${absolute}`,
        );
      }
      // Lexical only: another alias of this root (/tmp vs /private/tmp)
      // is still an escape. Later hops stay lstat- and containment-checked.
      const absoluteTarget = isAbsolute(target);
      const relativeTarget = absoluteTarget
        ? relativeInside(root, target)
        : target;
      if (relativeTarget === null) return { kind: "escapes" };
      if (absoluteTarget) resolved.length = 0;
      pending.unshift(...symlinkTargetSegments(relativeTarget));
      continue;
    }
    if (metadata.isDirectory()) {
      nodes.push({ path: absolute, metadata });
      resolved.push(segment);
      last = "directory";
      continue;
    }
    if (!metadata.isFile() || pending.length > 0) return { kind: "not-file" };
    resolved.push(segment);
    fileMetadata = metadata;
    last = "file";
  }
  if (last !== "file" || fileMetadata === undefined)
    return { kind: "not-file" };
  const path = appendPath(root, ...resolved);
  return isPathWithinRoot(root, path)
    ? { kind: "file", path, metadata: fileMetadata, nodes }
    : { kind: "escapes" };
};

/** Validate the app-parent chain equally for app, framework, and binary selection. */
const requireFrameworkRoot = async (
  root: string,
  selectedPath: string,
): Promise<readonly ElectronFusePathNode[]> => {
  const frameworks = dirname(root);
  const contents = dirname(frameworks);
  const app = dirname(contents);
  if (
    basename(frameworks) === "Frameworks" &&
    basename(contents) === "Contents" &&
    basename(app).endsWith(".app")
  )
    return requireRealDirectories(
      dirname(app),
      [basename(app), "Contents", "Frameworks", FRAMEWORK_NAME],
      selectedPath,
    );
  else
    return requireRealDirectories(
      dirname(root),
      [basename(root)],
      selectedPath,
    );
};

/**
 * Each named directory below `anchor` must be a real directory, so the
 * framework root cannot redirect the walk outside the selected bundle.
 */
const requireRealDirectories = async (
  anchor: string,
  segments: readonly string[],
  selectedPath: string,
): Promise<readonly ElectronFusePathNode[]> => {
  let current = anchor;
  const nodes: ElectronFusePathNode[] = [];
  for (const segment of segments) {
    current = appendPath(current, segment);
    let metadata;
    try {
      metadata = await lstat(current, { bigint: true });
    } catch (cause: unknown) {
      if (isMissing(cause))
        throw new ElectronFusePathFailure(
          "invalid_value",
          `Electron Framework binary was not found inside ${selectedPath}.`,
        );
      throw cause;
    }
    nodes.push({ path: current, metadata });
    if (metadata.isSymbolicLink())
      throw pathWalkFailure("escapes", selectedPath);
    if (!metadata.isDirectory())
      throw pathWalkFailure("not-file", selectedPath);
  }
  return nodes;
};

const requireFile = (
  walk: WalkResult,
  selectedPath: string,
  nodes: readonly ElectronFusePathNode[],
): ResolvedElectronFuseFile => {
  if (walk.kind === "file")
    return {
      path: walk.path,
      metadata: walk.metadata,
      nodes: [...nodes, ...walk.nodes],
    };
  if (walk.kind === "absent")
    throw new ElectronFusePathFailure(
      "invalid_value",
      `Electron Framework symlink target was not found: ${selectedPath}`,
    );
  throw pathWalkFailure(walk.kind, selectedPath);
};

const pathWalkFailure = (
  kind: "escapes" | "not-file" | "loop",
  path: string,
): ElectronFusePathFailure =>
  new ElectronFusePathFailure(
    "invalid_value",
    kind === "escapes"
      ? `Framework symlink escapes ${FRAMEWORK_NAME}: ${path}`
      : kind === "loop"
        ? `Framework symlink hop limit exceeded: ${path}`
        : `Electron Framework path is not a regular file: ${path}`,
  );

const frameworkRootOf = (path: string): string | null => {
  let current = dirname(path);
  while (basename(current) !== FRAMEWORK_NAME) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
};

const relativeInside = (root: string, path: string): string | null => {
  // Keep dot segments until resolveInside has followed preceding symlinks.
  // Lexical normalization would select a different file for link/../ paths.
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!path.startsWith(prefix)) return null;
  const value = path.slice(prefix.length);
  return value === "" ? null : value.split(sep).join("/");
};

/** Append known components without normalizing a caller-selected parent path. */
const appendPath = (parent: string, ...segments: readonly string[]): string =>
  `${parent}${parent.endsWith(sep) ? "" : sep}${segments.join(sep)}`;

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  ["ENOENT", "ENOTDIR"].includes(String(cause.code));

/** Preserve a link target's terminal separator as a directory requirement. */
const symlinkTargetSegments = (target: string): readonly string[] => {
  const separator = process.platform === "win32" ? /[\\/]/u : /\//u;
  const parts = target.split(separator).filter((part) => part !== "");
  if (separator.test(target.slice(-1))) parts.push(".");
  return parts;
};
