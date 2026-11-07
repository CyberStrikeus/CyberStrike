import type { BigIntStats } from "node:fs";
import { lstat, readlink, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { resolveTreePath } from "../../domain/apple/dyldPaths.js";
import { observedSymlinkTarget } from "../../domain/symlinkTarget.js";
import {
  dylibResolutionInputSchema,
  dylibResolutionResultSchema,
  machoImageSlices,
  traceDylibLoading,
  type DylibResolutionResult,
  type DylibTreeEntry,
  type DylibTreeView,
  type MachoImageFacts,
} from "../../domain/apple/dylibResolution.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import {
  ArtifactReaderFailure,
  type ArtifactReaderTraversal,
} from "../ArtifactReader.js";
import { ArtifactTraversalObservation } from "../ArtifactTraversalObservation.js";
import { DirectoryArtifactReader } from "../DirectoryArtifactReader.js";
import { consumeWithOrderedReads } from "../OrderedReads.js";
import {
  DylibFileAccess,
  classifyDylibReadFailure,
} from "./DylibFileAccess.js";
import { ArtifactResourceScope } from "../ArtifactResourceScope.js";
import { assertArtifactReadActive } from "../ArtifactFileOperation.js";

const OPERATION = "trace_dylib_resolution";
const WINDOWS = process.platform === "win32";
/** Concurrent four-byte magic reads while enumerating bundle roots. */
const MAGIC_READ_CONCURRENCY = 8;

/** Lazily probed, symlink-preserving view of one analyzed directory. */
class FilesystemTreeView implements DylibTreeView {
  readonly #entries = new Map<string, Promise<DylibTreeEntry | undefined>>();
  readonly #images = new Map<string, Promise<MachoImageFacts>>();
  readonly #identities = new Map<string, BigIntStats>();

  constructor(
    private readonly root: string,
    private readonly sourceRoot: string,
    private readonly files: DylibFileAccess,
    private readonly signal?: AbortSignal,
  ) {}

  rootRelativePath(absolutePath: string): string | undefined {
    const roots = isAbsolute(this.sourceRoot)
      ? [this.root, this.sourceRoot]
      : [this.root];
    for (let root of roots) {
      while (root.length > 1 && root.endsWith(sep)) root = root.slice(0, -1);
      if (absolutePath === root) return "";
      const prefix = root === sep ? sep : `${root}${sep}`;
      if (absolutePath.startsWith(prefix))
        return absolutePath.slice(prefix.length).split(sep).join("/");
    }
    return undefined;
  }

  entry(path: string): Promise<DylibTreeEntry | undefined> {
    const cached = this.#entries.get(path);
    if (cached !== undefined) return cached;
    const pending = this.#readEntry(path);
    this.#entries.set(path, pending);
    return pending;
  }

  image(path: string): Promise<MachoImageFacts> {
    const cached = this.#images.get(path);
    if (cached !== undefined) return cached;
    const pending = this.#readImage(path);
    this.#images.set(path, pending);
    return pending;
  }

  /** Identity of the file whose header bytes `image()` parsed. */
  identity(path: string): BigIntStats | undefined {
    return this.#identities.get(path);
  }

  /**
   * Host path of a root-relative dyld path. The resolver passes only plain
   * components, so a path that lands outside the root is a reader defect and
   * is refused before any file is opened.
   */
  hostPath(path: string): string {
    const absolute = join(this.root, path);
    const inside = relative(this.root, absolute);
    if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      throw new ArtifactReaderFailure(
        "path",
        `${path} maps outside the analyzed root`,
      );
    return absolute;
  }

  async #readImage(path: string): Promise<MachoImageFacts> {
    const { facts, identity } = await this.files.image(this.hostPath(path));
    this.#identities.set(path, identity);
    return facts;
  }

  async #readEntry(path: string): Promise<DylibTreeEntry | undefined> {
    assertArtifactReadActive(this.signal);
    // A dyld path component is a POSIX name. Windows reads `\` as a separator
    // and `:` as a stream delimiter, so no file in this tree has that name.
    if (WINDOWS && /[\\:]/u.test(path)) return undefined;
    const absolute = this.hostPath(path);
    try {
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        const observed = observedSymlinkTarget(
          await readlink(absolute, { encoding: "buffer" }),
        );
        if (observed.text === null)
          return { kind: "symlink", target: null, targetHex: observed.hex };
        const target = observed.text;
        // Windows link text separates components with `\`.
        return {
          kind: "symlink",
          target: WINDOWS ? target.replaceAll("\\", "/") : target,
        };
      }
      if (metadata.isDirectory()) return { kind: "directory" };
      return metadata.isFile() ? { kind: "file" } : undefined;
    } catch (cause: unknown) {
      if (missing(cause)) return undefined;
      throw cause;
    }
  }
}

/** Resolve dyld load paths for the active Mach-O or every executable in its bundle. */
export const traceDylibResolution = async (options: {
  readonly rootPath: string;
  readonly targetPath: string;
  readonly targetSha256: string;
  readonly enumerateRoots: boolean;
  readonly parameters: unknown;
  readonly resourceScope?: ArtifactResourceScope;
  readonly signal?: AbortSignal;
}): Promise<DylibResolutionResult> => {
  const parsed = dylibResolutionInputSchema.safeParse(options.parameters);
  if (!parsed.success)
    throw analysisInputErrorFromIssues(
      OPERATION,
      parsed.error.issues,
      options.parameters,
      { cause: parsed.error },
    );
  const resources = options.resourceScope ?? new ArtifactResourceScope();
  return await resources.run(async () => {
    // Canonicalization is inside the translated region: a revoked permission
    // keeps its reason and path.
    let root = options.rootPath;
    try {
      assertArtifactReadActive(options.signal);
      root = await realpath(options.rootPath);
      assertArtifactReadActive(options.signal);
      const files = new DylibFileAccess(resources, root, options.signal);
      const target = relative(root, await realpath(options.targetPath))
        .split(sep)
        .join("/");
      assertArtifactReadActive(options.signal);
      const view = new FilesystemTreeView(
        root,
        options.rootPath,
        files,
        options.signal,
      );
      const {
        roots: requested,
        unclassified,
        traversal,
      } = parsed.data.roots !== undefined
        ? { roots: parsed.data.roots, unclassified: [], traversal: undefined }
        : options.enumerateRoots
          ? await executableRoots(root, view, files, resources, options.signal)
          : { roots: [target], unclassified: [], traversal: undefined };
      const roots = await requireMachoRoots(
        view,
        requested,
        parsed.data.roots !== undefined,
      );
      const trace = await traceDylibLoading(view, {
        roots,
        unclassified,
        ...(traversal === undefined ? {} : { rootEnumeration: traversal }),
        ...(parsed.data.architecture === undefined
          ? {}
          : { architecture: parsed.data.architecture }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      // Each digest must describe the same file whose headers were parsed.
      const digests = new Map<string, string>();
      for (const { path } of trace.images)
        digests.set(
          path,
          await files.sha256(view.hostPath(path), view.identity(path)),
        );
      const targetDigest =
        digests.get(target) ??
        (await files.sha256(join(root, target), undefined));
      if (targetDigest !== options.targetSha256)
        throw new ArtifactReaderFailure(
          "integrity",
          `Active target digest changed: expected ${options.targetSha256}, observed ${targetDigest}`,
        );
      assertArtifactReadActive(options.signal);
      return dylibResolutionResultSchema.parse({
        ...trace,
        root_path: options.rootPath,
        target_sha256: options.targetSha256,
        images: trace.images.map((image) => ({
          ...image,
          sha256: digests.get(image.path),
        })),
      });
    } catch (cause: unknown) {
      throw classifyDylibReadFailure(root, cause);
    }
  });
};

/**
 * Every Mach-O in the bundle with an executable slice is its own process root.
 * Mach-O files that do not parse are returned separately: whether they are
 * executables is unknown, so they make coverage partial instead of vanishing.
 */
const executableRoots = async (
  root: string,
  view: FilesystemTreeView,
  files: DylibFileAccess,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<{
  readonly roots: string[];
  readonly unclassified: string[];
  readonly traversal: ArtifactReaderTraversal;
}> => {
  const roots: string[] = [];
  const unclassified: string[] = [];
  const traversal = new ArtifactTraversalObservation();
  let symlinks = 0;
  let firstSymlink: string | undefined;
  // Bundles hold tens of thousands of files and few Mach-O images, so the
  // magic reads overlap the walk while results are classified in walk order.
  const reader = new DirectoryArtifactReader(root);
  let outcome:
    | { readonly kind: "completed" }
    | { readonly kind: "failed"; readonly cause: unknown } = {
    kind: "completed",
  };
  try {
    await consumeWithOrderedReads(
      reader.entries(signal, traversal),
      MAGIC_READ_CONCURRENCY,
      (entry) => {
        // The ordered-read owner skips consume() when read() returns undefined.
        // Discovery facts for skipped entries belong at this selection boundary.
        if (entry.kind === "symlink") {
          symlinks += 1;
          firstSymlink ??= entry.path;
        }
        return entry.kind === "file"
          ? files.startsWithMachoMagic(entry)
          : undefined;
      },
      async (entry, macho) => {
        if (!macho) return;
        const facts = await view.image(entry.path);
        if (facts.status === "malformed" || facts.status === "unsupported")
          unclassified.push(entry.path);
        else if (
          facts.status === "parsed" &&
          machoImageSlices(facts).some(
            ({ file_type: type }) => type === "execute",
          )
        )
          roots.push(entry.path);
      },
    );
  } catch (cause: unknown) {
    outcome = { kind: "failed", cause };
  }
  const released = await resources.release({
    kind: "reader",
    reader,
    resource: `executable-root reader for ${root}`,
  });
  if (released.kind === "failed")
    throw resources.cleanupFailure(outcome, [released]);
  if (outcome.kind === "failed") throw outcome.cause;
  assertArtifactReadActive(signal);
  if (symlinks > 0)
    traversal.onCoverage({
      status: "unknown",
      limitations: [
        `Executable-root discovery did not follow ${symlinks} symlink(s); their root roles and possible descendants are unknown. First path: ${JSON.stringify(firstSymlink)}.`,
      ],
    });
  return {
    roots: roots.sort(compare),
    unclassified: unclassified.sort(compare),
    traversal: traversal.snapshot(),
  };
};

const compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * Resolve each root segment by segment, as dependency candidates are, so a
 * symlink in an intermediate directory cannot lead outside the analyzed root.
 * A root the caller selected that fails is an input error on that root; a
 * root REA derived itself keeps reporting an artifact failure.
 */
const requireMachoRoots = async (
  view: FilesystemTreeView,
  roots: readonly string[],
  callerSelected: boolean,
): Promise<string[]> => {
  const resolved: string[] = [];
  for (const [index, path] of roots.entries()) {
    const reject = (
      reason: "path" | "format",
      message: string,
    ): AnalysisInputError | ArtifactReaderFailure =>
      callerSelected
        ? new AnalysisInputError(OPERATION, undefined, [
            { path: ["roots", index], reason: "invalid_value", message },
          ])
        : new ArtifactReaderFailure(reason, message);
    const lookup = await resolveTreePath(view, path);
    if (lookup.kind === "escapes")
      throw reject("path", `Root ${path} resolves outside the analyzed root`);
    if (lookup.kind === "undetermined")
      throw reject(
        "path",
        `Root ${path} crosses symlink ${lookup.path} with non-UTF-8 target bytes ${lookup.targetHex}`,
      );
    if (lookup.kind !== "file")
      throw reject(
        "path",
        `Root ${path} is not a regular file in the analyzed root`,
      );
    if ((await view.image(lookup.path)).status === "not-mach-o")
      throw reject("format", `Root ${path} is not a Mach-O image`);
    if (!resolved.includes(lookup.path)) resolved.push(lookup.path);
  }
  return resolved;
};

const missing = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause.code === "ENOENT" || cause.code === "ENOTDIR");
