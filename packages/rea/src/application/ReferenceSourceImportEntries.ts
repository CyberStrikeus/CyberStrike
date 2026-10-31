import { err, ok, type Result } from "../domain/result.js";
import { createHash } from "node:crypto";
import { posix } from "node:path";

import type { JavaScriptPackageType } from "../domain/javascript/javascriptSourceParser.js";
import { logicalPathEscapesRoot } from "../domain/artifactIdentity.js";
import {
  createReferenceSourcePathLookup,
  decodeReferenceSourceModuleUrlPath,
  isPortableAbsoluteReferenceTarget,
  type ReferenceSourcePathLookup,
} from "../domain/referenceSourcePathIdentity.js";
import {
  classifyReferenceSourcePath,
  detectReferenceSourceLanguage,
} from "../domain/referenceSourceClassification.js";
import type { HistoricalSourceGraphInput } from "../domain/referenceSourceGraph.js";
import {
  parseReferenceSourceImports,
  PARSEABLE_REFERENCE_SOURCE_LANGUAGES,
} from "../domain/referenceSourceImportParsing.js";
import type {
  ReferenceSourceEntry,
  ReferenceSourceRead,
} from "../reference/ReferenceSourceReaderTypes.js";
import { typescriptEmittedSourceCandidates } from "./TypeScriptEmittedSourceCandidates.js";

export interface ParsedReferenceSourceEntries {
  readonly entries: HistoricalSourceGraphInput["entries"];
  readonly relationships: HistoricalSourceGraphInput["relationships"];
  readonly parseFailures: HistoricalSourceGraphInput["parse_failures"];
  readonly limitations: string[];
}

/** Preserve the observed reader failure and add entry-specific recovery guidance. */
export const projectReferenceSourceEntryFailure = (
  entry: Extract<ReferenceSourceEntry, { status: "failed" }>,
): string => `${entry.message} ${entryRecoveryGuidance(entry)}`;

const entryRecoveryGuidance = (
  entry: Extract<ReferenceSourceEntry, { status: "failed" }>,
): string => {
  if (entry.code === "cancelled")
    return "This entry was not read because the import was cancelled. Start the import again when ready.";
  if (entry.code === "unsupported")
    return "Exclude this entry or replace it with a regular file.";
  if (entry.kind === "directory")
    return "This directory could not be read. Check its permissions, then try again.";
  if (entry.kind === "symlink")
    return "This symbolic link could not be read safely. Check the link and its permissions, then try again.";
  if (entry.kind === "unknown")
    return "This entry's type could not be determined. Check the parent directory and try again.";
  return "This file could not be read. Check its permissions, then try again.";
};

const hashBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const failedEntry = (
  entry: Extract<ReferenceSourceEntry, { status: "failed" }>,
): HistoricalSourceGraphInput["entries"][number] => {
  const classifications = classifyReferenceSourcePath(entry.path);
  const limitation = projectReferenceSourceEntryFailure(entry);
  const local =
    entry.localDiagnostic === undefined
      ? {}
      : { local_diagnostics: [entry.localDiagnostic] };
  if (entry.kind === "directory")
    return {
      path: entry.path,
      kind: "directory",
      classifications,
      tree_state: "unreadable",
      limitations: [limitation],
      ...local,
    };
  if (entry.kind === "symlink")
    return {
      path: entry.path,
      kind: "symlink",
      target: null,
      target_state: "unreadable",
      classifications,
      limitations: [limitation],
      ...local,
    };
  if (entry.kind === "unknown" || entry.kind === "other")
    return {
      path: entry.path,
      kind: "unknown",
      classifications: ["unknown"],
      limitations: [limitation],
      ...local,
    };
  return {
    path: entry.path,
    kind: "file",
    sha256: null,
    size: entry.size ?? null,
    language: null,
    classifications: entry.kind === "file" ? classifications : ["unknown"],
    content_state: "unreadable",
    limitations: [limitation],
    ...local,
  };
};

/** A package directory's legacy `main` entry point, as its manifest declares it. */
type PackageMain =
  | { readonly state: "declared"; readonly main: string }
  | { readonly state: "none" }
  | { readonly state: "unknown" };

interface PackageMetadata {
  readonly main: PackageMain;
  readonly type: JavaScriptPackageType;
}
const UNKNOWN_PACKAGE: PackageMetadata = {
  main: { state: "unknown" },
  type: "unknown",
};

/** Parse each manifest once; both entry selection and loader scope consume its facts. */
const readPackageMetadata = (
  read: ReferenceSourceRead,
  exclusions: HistoricalSourceGraphInput["exclusions"],
  unobservedPath: (path: string) => boolean,
): {
  readonly packages: ReadonlyMap<string, PackageMetadata>;
  readonly pathLookup: ReferenceSourcePathLookup;
} => {
  const packages = new Map<string, PackageMetadata>();
  const manifestPaths: string[] = [];
  for (const exclusion of exclusions) {
    if (posix.basename(exclusion.path) !== "package.json") continue;
    manifestPaths.push(exclusion.path);
    packages.set(posix.dirname(exclusion.path), UNKNOWN_PACKAGE);
  }
  for (const entry of read.entries) {
    if (posix.basename(entry.path) !== "package.json") continue;
    manifestPaths.push(entry.path);
    const directory = posix.dirname(entry.path);
    if (
      packages.has(directory) ||
      entry.status !== "read" ||
      entry.kind !== "file"
    ) {
      packages.set(directory, UNKNOWN_PACKAGE);
      continue;
    }
    try {
      const manifest: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(entry.bytes),
      );
      if (
        typeof manifest !== "object" ||
        manifest === null ||
        Array.isArray(manifest)
      ) {
        packages.set(directory, UNKNOWN_PACKAGE);
        continue;
      }
      const type: unknown = Object.hasOwn(manifest, "type")
        ? Reflect.get(manifest, "type")
        : undefined;
      const main: unknown = Object.hasOwn(manifest, "main")
        ? Reflect.get(manifest, "main")
        : undefined;
      packages.set(directory, {
        type: type === "module" || type === "commonjs" ? type : "unspecified",
        main:
          typeof main === "string" && main !== ""
            ? { state: "declared", main }
            : { state: "none" },
      });
    } catch {
      packages.set(directory, UNKNOWN_PACKAGE);
    }
  }
  // An incomplete directory cannot establish that its manifest is absent.
  const uncertainDirectories = [
    ...(read.rootFailure === undefined ? [] : ["."]),
    ...read.entries
      .filter(
        (entry) => entry.kind === "directory" && entry.status === "failed",
      )
      .map(({ path }) => path),
  ];
  for (const directory of uncertainDirectories) {
    const path = posix.join(directory, "package.json");
    if (!packages.has(directory) && unobservedPath(path)) {
      manifestPaths.push(path);
      packages.set(directory, UNKNOWN_PACKAGE);
    }
  }
  return {
    packages,
    pathLookup: createReferenceSourcePathLookup(manifestPaths),
  };
};

/**
 * Extension slots in probe order. Within a slot, files precede directory
 * indexes. The CommonJS loader tries `X.json` after `X.js` and before any
 * directory index; ESM and TypeScript require an explicit `.json`.
 */
const RESOLUTION_SUFFIXES: readonly (readonly string[])[] = [
  [""],
  [".ts"],
  [".mts"],
  [".cts"],
  [".js"],
  [".mjs"],
  [".cjs"],
  [".tsx"],
  [".jsx"],
];
const REQUIRE_RESOLUTION_SUFFIXES = RESOLUTION_SUFFIXES.map((slot) =>
  slot.includes(".js") ? [...slot, ".json"] : slot,
);
const NODE_REQUIRE_SUFFIXES = ["", ".js", ".json", ".node"] as const;

type InternalSpecifierResolutionMode =
  | "source-import"
  | "source-require"
  | "runtime-require";

const resolutionSuffixes = (
  mode: InternalSpecifierResolutionMode,
): readonly (readonly string[])[] =>
  mode === "source-require" ? REQUIRE_RESOLUTION_SUFFIXES : RESOLUTION_SUFFIXES;

const nodeRequireFileCandidates = (path: string): string[] =>
  NODE_REQUIRE_SUFFIXES.map((suffix) => `${path}${suffix}`);

const nodeRequireIndexCandidates = (directory: string): string[] =>
  NODE_REQUIRE_SUFFIXES.filter((suffix) => suffix !== "").map((suffix) =>
    posix.join(directory, `index${suffix}`),
  );

/** Inventory facts an internal specifier resolves against. */
interface SpecifierContext {
  readonly lookupPath: ReferenceSourcePathLookup;
  readonly packages: ReadonlyMap<string, PackageMetadata>;
  readonly packageManifestPathLookup: ReferenceSourcePathLookup;
  readonly unobservedPath: (path: string) => boolean;
}

/** Earlier unobserved candidates must not be treated as absent. */
const selectObservedCandidate = (
  candidates: readonly string[],
  context: SpecifierContext,
): Result<string | undefined, undefined> => {
  const selected = context.lookupPath.resolveCandidates(candidates);
  for (const candidate of candidates) {
    const resolved = context.lookupPath.resolve(candidate);
    if (resolved === selected && selected !== undefined) break;
    if (
      (context.lookupPath.has(candidate) && resolved === undefined) ||
      context.unobservedPath(candidate)
    )
      return err(undefined);
  }
  return ok(selected);
};

/** The closest directory observation owns whether an absent child was examined. */
const unobservedReferencePath = (
  read: ReferenceSourceRead,
  exclusions: HistoricalSourceGraphInput["exclusions"],
): ((path: string) => boolean) => {
  const observed = createReferenceSourcePathLookup(
    read.entries.map(({ path }) => path),
  );
  const unavailable = createReferenceSourcePathLookup([
    ...read.entries
      .filter(
        (entry) =>
          entry.kind !== "directory" &&
          (entry.status === "failed" || entry.kind === "symlink"),
      )
      .map(({ path }) => path),
    ...exclusions
      .filter((entry) => entry.entry_kind !== "directory")
      .map(({ path }) => path),
  ]);
  const excludedDirectories = createReferenceSourcePathLookup(
    exclusions
      .filter((entry) => entry.entry_kind === "directory")
      .map(({ path }) => path),
  );
  const directories = new Map(
    read.entries
      .filter((entry) => entry.kind === "directory")
      .map((entry) => [entry.path, entry.status]),
  );
  const directoryLookup = createReferenceSourcePathLookup(directories.keys());
  return (path) => {
    if (unavailable.has(path)) return true;
    if (observed.has(path)) return false;
    for (
      let parent = posix.dirname(path);
      parent !== "." && parent !== "/";
      parent = posix.dirname(parent)
    ) {
      if (excludedDirectories.has(parent)) return true;
      const directory = directoryLookup.resolve(parent);
      if (directory !== undefined)
        return directories.get(directory) === "failed";
      // A canonical collision cannot establish which directory was examined.
      if (directoryLookup.has(parent)) return true;
    }
    return read.rootFailure !== undefined;
  };
};

const packageMainForDirectory = (
  directory: string,
  context: SpecifierContext,
): { readonly directory: string; readonly main: PackageMain } | undefined => {
  const manifestPath = context.packageManifestPathLookup.resolve(
    posix.join(directory, "package.json"),
  );
  if (manifestPath !== undefined) {
    const manifestDirectory = posix.dirname(manifestPath);
    const main = context.packages.get(manifestDirectory)?.main;
    return main === undefined
      ? undefined
      : { directory: manifestDirectory, main };
  }
  return context.packageManifestPathLookup.has(
    posix.join(directory, "package.json"),
  )
    ? { directory, main: { state: "unknown" } }
    : undefined;
};

/** Apply a package main, retaining an existing index as the fallback target. */
const selectPackageMain = (
  directory: string,
  indexFallback: string | undefined,
  context: SpecifierContext,
  mode: InternalSpecifierResolutionMode,
): { to: string; resolution: "internal" | "unresolved" } => {
  const packageSelection = packageMainForDirectory(directory, context);
  const packageDirectory = packageSelection?.directory ?? directory;
  const manifest = packageSelection?.main;
  if (manifest === undefined || manifest.state === "none")
    return indexFallback === undefined
      ? { to: directory, resolution: "unresolved" }
      : { to: indexFallback, resolution: "internal" };
  if (manifest.state === "unknown")
    return { to: packageDirectory, resolution: "unresolved" };
  // Node resolves `main` with path.resolve: an absolute main leaves the
  // package, and a trailing separator does not make the entry a directory.
  if (posix.isAbsolute(manifest.main))
    return { to: posix.normalize(manifest.main), resolution: "unresolved" };
  // Joining "." strips the trailing separator run with path semantics; a
  // lookbehind regex kept separators behind line terminators (main "lib\n/").
  const target = posix.join(posix.join(packageDirectory, manifest.main), ".");
  // Node would load a declared entry outside the imported root.
  if (logicalPathEscapesRoot(target))
    return { to: target, resolution: "unresolved" };
  const slots = resolutionSuffixes(mode);
  const candidates =
    mode === "runtime-require"
      ? [
          ...nodeRequireFileCandidates(target),
          ...nodeRequireIndexCandidates(target),
        ]
      : [
          ...slots.flatMap((slot) =>
            slot.map((suffix) => `${target}${suffix}`),
          ),
          ...slots
            .flat()
            .filter((suffix) => suffix !== "")
            .map((suffix) => posix.join(target, `index${suffix}`)),
        ];
  const selection = selectObservedCandidate(candidates, context);
  if (!selection.ok) return { to: packageDirectory, resolution: "unresolved" };
  const selected = selection.value;
  return selected === undefined
    ? indexFallback === undefined
      ? { to: packageDirectory, resolution: "unresolved" }
      : { to: indexFallback, resolution: "internal" }
    : { to: selected, resolution: "internal" };
};

/** Parse URL syntax before inventory lookup; require filenames remain literal. */
const importLookupPath = (
  fromPath: string,
  specifier: string,
): Result<{ readonly path: string; readonly directory: boolean }, string> => {
  // A private origin is only a logical pathname base, never a filesystem access.
  let source: URL;
  try {
    source = new URL(
      fromPath.split("/").map(encodeURIComponent).join("/"),
      "file:///rea-reference/",
    );
  } catch (cause: unknown) {
    if (!(cause instanceof URIError)) throw cause;
    return err("The source path cannot be represented as a module URL.");
  }
  const target = URL.parse(specifier, source);
  if (target === null || target.protocol !== "file:" || target.host !== "")
    return err(
      "The module URL cannot be resolved within the source inventory.",
    );
  if (!target.pathname.startsWith("/rea-reference/"))
    return err("The module URL escapes the selected source inventory.");
  const decoded = decodeReferenceSourceModuleUrlPath(
    target.pathname.slice("/rea-reference/".length),
  );
  return decoded.ok
    ? ok({ path: decoded.value, directory: target.pathname.endsWith("/") })
    : decoded;
};

const resolveInternalSpecifier = (
  fromPath: string,
  specifier: string,
  context: SpecifierContext,
  mode: InternalSpecifierResolutionMode,
): {
  to: string;
  resolution: "internal" | "unresolved";
  limitation?: string;
} => {
  if (posix.isAbsolute(specifier))
    return { to: specifier, resolution: "unresolved" };
  const imported =
    mode === "source-import"
      ? importLookupPath(fromPath, specifier)
      : undefined;
  if (imported !== undefined && !imported.ok)
    return {
      to: specifier,
      resolution: "unresolved",
      limitation: imported.error,
    };
  const normalizedPath =
    imported?.ok === true
      ? imported.value.path
      : posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  const normalized = normalizedPath.replace(/(?<=.)\/+$/u, "") || ".";
  if (logicalPathEscapesRoot(normalized))
    return { to: normalized, resolution: "unresolved" };
  // Preserve directory intent before normalization removes terminal dot segments.
  const directoryReference =
    imported?.ok === true
      ? imported.value.directory
      : specifier.endsWith("/") ||
        [".", ".."].includes(posix.basename(specifier));
  // A directory resolves only to an index with an extension; neither Node nor
  // TypeScript selects an extensionless `index` file.
  const slots = resolutionSuffixes(mode);
  const candidates =
    mode === "runtime-require"
      ? [
          ...(directoryReference ? [] : nodeRequireFileCandidates(normalized)),
          ...nodeRequireIndexCandidates(normalized),
        ]
      : slots.flatMap((slot) => [
          ...(directoryReference
            ? []
            : slot.map((suffix) => `${normalized}${suffix}`)),
          ...slot
            .filter((suffix) => suffix !== "")
            .map((suffix) => posix.join(normalized, `index${suffix}`)),
        ]);
  // Retain present runtime files first; substitute only a missing counterpart.
  // Counterparts cover explicit filenames, not directory/index resolution.
  if (!directoryReference)
    candidates.push(
      ...typescriptEmittedSourceCandidates(fromPath, normalized).map(
        ({ path }) => path,
      ),
    );
  const selection = selectObservedCandidate(candidates, context);
  if (!selection.ok) {
    // Node consults a known package main before probing directory indexes.
    // Incomplete index coverage cannot invalidate that observed declaration.
    if (
      mode === "runtime-require" &&
      packageMainForDirectory(normalized, context)?.main.state === "declared"
    ) {
      const files = directoryReference
        ? ok(undefined)
        : selectObservedCandidate(
            nodeRequireFileCandidates(normalized),
            context,
          );
      if (files.ok && files.value === undefined)
        return selectPackageMain(normalized, undefined, context, mode);
    }
    return { to: normalized, resolution: "unresolved" };
  }
  const match = selection.value;
  if (match === undefined)
    return packageMainForDirectory(normalized, context) !== undefined
      ? selectPackageMain(normalized, undefined, context, mode)
      : { to: normalized, resolution: "unresolved" };
  // posix.normalize preserves the specifier's trailing slash while
  // dirname(match) never carries one; derive the directory identity with path
  // semantics (joining "." collapses trailing slashes, including ones a regex
  // would keep behind a line terminator) so a trailing-slash reference still
  // reaches package-main selection the same way the plain spelling does.
  const directory = posix.join(normalized, ".");
  const resolvedThroughIndex =
    posix.basename(match).startsWith("index.") &&
    posix.dirname(match).normalize("NFC") === directory.normalize("NFC");
  return resolvedThroughIndex
    ? selectPackageMain(posix.dirname(match), match, context, mode)
    : { to: match, resolution: "internal" };
};

type ReadFile = Extract<ReferenceSourceEntry, { status: "read"; kind: "file" }>;

/** The nearest inventoried manifest owns package type, even when it omits type. */
const packageTypeForFile = (
  path: string,
  context: SpecifierContext,
): JavaScriptPackageType => {
  let directory = posix.dirname(path);
  while (true) {
    const manifest = packageMainForDirectory(directory, context);
    if (manifest !== undefined)
      return context.packages.get(manifest.directory)?.type ?? "unknown";
    if (
      directory === "." ||
      directory === "/" ||
      posix.basename(directory) === "node_modules"
    )
      return "unknown";
    directory = posix.dirname(directory);
  }
};

const appendFile = (
  entry: ReadFile,
  context: SpecifierContext,
  output: ParsedReferenceSourceEntries,
): void => {
  const language = detectReferenceSourceLanguage(entry.path);
  const parsed =
    language === null || !PARSEABLE_REFERENCE_SOURCE_LANGUAGES.has(language)
      ? undefined
      : parseReferenceSourceImports(
          entry.path,
          entry.bytes,
          language,
          packageTypeForFile(entry.path, context),
        );
  output.entries.push({
    path: entry.path,
    kind: "file",
    sha256: hashBytes(entry.bytes),
    size: entry.size,
    language,
    classifications: classifyReferenceSourcePath(entry.path),
    content_state: "hashed",
    limitations: [...(parsed?.limitations ?? [])],
  });
  if (parsed === undefined) return;
  output.limitations.push(...parsed.limitations);
  for (const relationship of parsed.relationships) {
    const { resolutionStrategy, resolutionBasePath, ...graphRelationship } =
      relationship;
    if (graphRelationship.resolution !== "internal") {
      output.relationships.push(graphRelationship);
      continue;
    }
    const mode: InternalSpecifierResolutionMode =
      resolutionStrategy === "runtime-require"
        ? "runtime-require"
        : graphRelationship.kind === "requires"
          ? "source-require"
          : "source-import";
    const resolved = resolveInternalSpecifier(
      resolutionBasePath ?? graphRelationship.from_path,
      graphRelationship.to,
      context,
      mode,
    );
    if (resolved.limitation !== undefined) {
      const limitation = `${entry.path}: ${JSON.stringify(graphRelationship.to)}: ${resolved.limitation}`;
      output.limitations.push(limitation);
      output.entries.at(-1)?.limitations.push(limitation);
    }
    output.relationships.push({
      ...graphRelationship,
      ...(mode === "source-import" && /[?%#]/u.test(graphRelationship.to)
        ? { source_specifier: graphRelationship.to }
        : {}),
      to: resolved.to,
      resolution: resolved.resolution,
    });
  }
  output.parseFailures.push(...parsed.parse_failures);
};

const appendReadEntry = (
  entry: Extract<ReferenceSourceEntry, { status: "read" }>,
  context: SpecifierContext,
  output: ParsedReferenceSourceEntries,
): void => {
  if (entry.kind === "file") {
    appendFile(entry, context, output);
    return;
  }
  const classifications = classifyReferenceSourcePath(entry.path);
  if (entry.kind === "directory") {
    output.entries.push({
      path: entry.path,
      kind: "directory",
      classifications,
      tree_state: "enumerated",
      limitations: [],
    });
    return;
  }
  output.entries.push({
    path: entry.path,
    kind: "symlink",
    // The reader resolves inventory identities from its root; the persisted
    // graph represents relative symlink targets from the link's directory.
    target:
      entry.targetState === "internal" ||
      (entry.targetState === "missing" &&
        !isPortableAbsoluteReferenceTarget(entry.target))
        ? posix.relative(posix.dirname(entry.path), entry.target) || "."
        : entry.target,
    target_state: entry.targetState,
    classifications,
    limitations: [],
  });
};

/** Convert bounded reader observations into graph entries and parsed edges. */
export const parseReferenceSourceEntries = (
  read: ReferenceSourceRead,
  exclusions: HistoricalSourceGraphInput["exclusions"],
  signal?: AbortSignal,
): ParsedReferenceSourceEntries => {
  const output: ParsedReferenceSourceEntries = {
    entries: [],
    relationships: [],
    parseFailures: [],
    limitations: [...read.limitations],
  };
  if (read.rootFailure !== undefined)
    output.limitations.push(
      `Reference root enumeration is incomplete: ${read.rootFailure.message}`,
    );
  const unobservedPath = unobservedReferencePath(read, exclusions);
  const packageInventory = readPackageMetadata(
    read,
    exclusions,
    unobservedPath,
  );
  const context: SpecifierContext = {
    lookupPath: createReferenceSourcePathLookup(
      read.entries
        .filter((entry) => entry.status === "read" && entry.kind === "file")
        .map((entry) => entry.path),
    ),
    unobservedPath,
    packages: packageInventory.packages,
    packageManifestPathLookup: packageInventory.pathLookup,
  };
  for (const entry of read.entries) {
    if (signal?.aborted === true) break;
    if (entry.status === "failed") output.entries.push(failedEntry(entry));
    else appendReadEntry(entry, context, output);
  }
  return output;
};
