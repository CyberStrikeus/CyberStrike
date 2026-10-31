import type { JavaScriptJsonDocuments } from "./JavaScriptJsonDocuments.js";
import { isBuiltin } from "node:module";
import { posix, win32 } from "node:path";
import { ELECTRON_MODULE } from "../../domain/javascript/javascriptElectronMemberWrites.js";

import {
  normalizeJoinedLogicalPath,
  logicalPathEscapesRoot,
} from "../../domain/artifactIdentity.js";
import type {
  JavaScriptArtifactFile,
  JavaScriptUnanalyzedArtifactLookup,
} from "../../domain/javascript/javascriptArtifactFiles.js";
import {
  admitsCanonicalPathSyntax,
  hasScheme,
  htmlUrlText,
  looksExternal,
  percentDecodeUrlPath,
  stripQueryAndFragment,
} from "../../domain/artifactPathSyntax.js";
import {
  classifyPackageImportSpecifier,
  classifyPackageImportTargetString,
  lookupExactPackageImport,
} from "../../domain/javascript/javascriptPackageImportAliases.js";
import {
  typescriptEmittedSourceCandidates,
  type TypeScriptEmittedSourceCandidate,
} from "../TypeScriptEmittedSourceCandidates.js";
import {
  isRelativeJavaScriptModuleSpecifier,
  decodeJavaScriptModuleUrlPath,
} from "../../domain/javascript/javascriptModuleSpecifier.js";
import { selectPackageSubpathPattern } from "../../domain/javascript/javascriptPackageSubpathPatterns.js";
import type { JavaScriptModuleResolutionMode } from "../../domain/javascript/javascriptModuleResolutionMode.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";

type ArtifactPathResolutionContext =
  | "package-entrypoint"
  | "filesystem-expression"
  | "module-specifier"
  | "html-reference"
  | "url-reference";

type UnresolvedArtifactPathStatus =
  | "not-found"
  | "unavailable"
  | "external"
  | "rejected";

interface ArtifactPathResolutionBase {
  readonly declared_path: string;
  readonly runtime_path_base?: "application-root";
  readonly runtime_path_base_proven?: true;
  readonly resolution_context: ArtifactPathResolutionContext;
  readonly limitations: readonly string[];
  readonly conditional_resolutions?: readonly ConditionalModuleResolution[];
  readonly candidate_path?: string;
  /** An external module can run code whose imports were not inventoried. */
  readonly unexamined_module_imports?: true;
}

export interface ConditionalModuleResolution {
  readonly mode: "import" | "require";
  readonly resolution_status: UnresolvedArtifactPathStatus | "resolved";
  readonly resolved_path: string | null;
  readonly candidate_path?: string;
  readonly limitations: readonly string[];
}

/** Explicit outcome of artifact-confined path resolution. */
export type ArtifactPathResolution = ArtifactPathResolutionBase &
  (
    | {
        readonly resolved_path: string;
        readonly resolution_status: "resolved";
      }
    | {
        readonly resolved_path: null;
        readonly resolution_status: UnresolvedArtifactPathStatus;
      }
  );

/** Values needed to resolve a declaration without filesystem access. */
export interface ResolveArtifactPathInput {
  readonly jsonDocuments: JavaScriptJsonDocuments;
  readonly declaredPath: string;
  readonly sourcePath: string;
  readonly context: ArtifactPathResolutionContext;
  readonly files: ReadonlyMap<string, JavaScriptArtifactFile>;
  /** Directory identities retained by the complete artifact inventory. */
  readonly directoryPaths?: ReadonlySet<string> | undefined;
  /** Inventoried files outside the JavaScript projection: present, never read. */
  readonly unanalyzedFiles?: JavaScriptUnanalyzedArtifactLookup | undefined;
  readonly htmlBaseHref?: string | null;
  /** Import/require semantics; runtime resource paths omit this provenance. */
  readonly moduleKind?: JavaScriptModuleResolutionMode;
  /** Runtime paths retain their loader owner independently of source imports. */
  readonly runtimePathKind?:
    | "exact-file"
    | "application-file"
    | "node-entrypoint"
    | "url-resource";
  /** Logical root of an inventoried nested application container. */
  readonly applicationRootPath?: string | null;
  readonly applicationRootIsProven?: boolean;
}

/** Preserve an explicitly retained loader mode on graph relationships. */
export const moduleResolutionModeProperties = (
  mode: JavaScriptModuleResolutionMode | undefined,
): Readonly<Record<string, JavaScriptModuleResolutionMode>> =>
  mode === undefined ? {} : { resolution_mode: mode };

const EXTENSIONS = [
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".json",
  ".html",
  ".node",
];

// A private URL namespace for logical artifact paths, including root packages.
// Encode inventory segments so filename punctuation remains literal in the base.
const PACKAGE_ARTIFACT_ROOT_URL = new URL("file:///rea-artifact/");
const encodePackageMetadataUrl = (path: string): URL =>
  new URL(
    path.split("/").map(encodeURIComponent).join("/"),
    PACKAGE_ARTIFACT_ROOT_URL,
  );
// URL identity cannot represent lone UTF-16 surrogates. Use request-local
// opaque segments only for structural admission, never inventory lookup. A
// target cannot spell these identities after URL's tab/newline preprocessing.
const packageMetadataUrl = (
  path: string,
  relativeTarget: string,
): Result<
  URL,
  {
    readonly structuralUrl: URL;
    readonly structuralSegments: ReadonlySet<string>;
    readonly limitation: string;
  }
> => {
  try {
    return ok(encodePackageMetadataUrl(path));
  } catch (cause: unknown) {
    if (!(cause instanceof URIError)) throw cause;
    const reserved = new Set(
      `${path}\n${relativeTarget.replace(/[\t\n\r]/gu, "")}`.match(
        /rea-opaque-\d+/gu,
      ) ?? [],
    );
    const structuralSegments = new Set<string>();
    let nextIdentity = 0;
    const structuralPath = path
      .split("/")
      .map((segment) => {
        try {
          return encodeURIComponent(segment);
        } catch (segmentCause: unknown) {
          if (!(segmentCause instanceof URIError)) throw segmentCause;
          let identity: string;
          do identity = `rea-opaque-${nextIdentity++}`;
          while (reserved.has(identity));
          reserved.add(identity);
          structuralSegments.add(identity);
          return identity;
        }
      })
      .join("/");
    return err({
      structuralUrl: new URL(structuralPath, PACKAGE_ARTIFACT_ROOT_URL),
      structuralSegments,
      limitation: `Package metadata path ${JSON.stringify(path)} contains an unpaired UTF-16 surrogate and cannot be represented as a URL.`,
    });
  }
};

interface PackageFileTarget {
  readonly value: string;
  /** Normalized URL retained until loader-specific validation and file lookup. */
  readonly url: URL;
  /** Structural validation remains possible when the inventory base has no URL identity. */
  readonly lookupLimitation?: string;
}

type CandidateResolution = {
  readonly limitations: readonly string[];
  readonly candidatePath?: string;
  readonly conditionalResolutions?: readonly ConditionalModuleResolution[];
  readonly unexaminedModuleImports?: true;
} & (
  | { readonly resolvedPath: string; readonly status: "resolved" }
  | {
      readonly resolvedPath: null;
      readonly status: UnresolvedArtifactPathStatus;
      /** A truthy package main failed, so Node must not try ancestor packages. */
      readonly stopsAncestorLookup?: true;
    }
);

/** Resolve one declaration while preserving its original input identity. */
export const resolveArtifactPathByContext = (
  input: ResolveArtifactPathInput,
): ArtifactPathResolution => {
  const resolution = resolvePath(input);
  const facts = {
    declared_path: input.declaredPath,
    ...(input.runtimePathKind === "application-file"
      ? { runtime_path_base: "application-root" as const }
      : {}),
    ...(input.runtimePathKind === "application-file" &&
    input.applicationRootIsProven === true &&
    input.applicationRootPath !== null
      ? { runtime_path_base_proven: true as const }
      : {}),
    resolution_context: input.context,
    limitations: resolution.limitations,
    ...(resolution.unexaminedModuleImports === true
      ? { unexamined_module_imports: true as const }
      : {}),
    ...(resolution.candidatePath === undefined
      ? {}
      : { candidate_path: resolution.candidatePath }),
    ...(resolution.conditionalResolutions === undefined
      ? {}
      : { conditional_resolutions: resolution.conditionalResolutions }),
  };
  return resolution.status === "resolved"
    ? {
        ...facts,
        resolved_path: resolution.resolvedPath,
        resolution_status: resolution.status,
      }
    : { ...facts, resolved_path: null, resolution_status: resolution.status };
};

/** Project retained conditional identities without flattening them into display text. */
export const artifactPathResolutionProperties = (
  resolution: ArtifactPathResolution | undefined,
): Readonly<Record<string, JsonValue>> => ({
  ...(resolution?.runtime_path_base_proven === undefined
    ? {}
    : { runtime_path_base_proven: resolution.runtime_path_base_proven }),
  ...(resolution?.runtime_path_base === undefined
    ? {}
    : { runtime_path_base: resolution.runtime_path_base }),
  ...(resolution?.candidate_path === undefined
    ? {}
    : { candidate_path: resolution.candidate_path }),
  ...(resolution?.conditional_resolutions === undefined
    ? {}
    : {
        conditional_resolutions: resolution.conditional_resolutions.map(
          (branch) => ({
            mode: branch.mode,
            resolution_status: branch.resolution_status,
            resolved_path: branch.resolved_path,
            limitations: [...branch.limitations],
            ...(branch.candidate_path === undefined
              ? {}
              : { candidate_path: branch.candidate_path }),
          }),
        ),
      }),
});

const conditionalResolution = (
  mode: "import" | "require",
  result: CandidateResolution,
): ConditionalModuleResolution => ({
  mode,
  resolution_status: result.status,
  resolved_path: result.resolvedPath,
  limitations: result.limitations,
  ...(result.candidatePath === undefined
    ? {}
    : { candidate_path: result.candidatePath }),
});

/** Host path admission is shared by top-level and metadata-derived inputs. */
const resolveRuntimeHostPath = (
  input: ResolveArtifactPathInput,
): CandidateResolution | null => {
  if (
    (input.runtimePathKind !== undefined || isNodeFilesystemLookup(input)) &&
    input.runtimePathKind !== "url-resource" &&
    (posix.isAbsolute(input.declaredPath) ||
      win32.isAbsolute(input.declaredPath) ||
      (input.context === "module-specifier" &&
        input.moduleKind !== "require" &&
        /^file:/iu.test(input.declaredPath)))
  ) {
    const esm =
      input.context === "module-specifier" && input.moduleKind === "import";
    if (esm) {
      const normalized = URL.parse(
        htmlUrlText(input.declaredPath),
        PACKAGE_ARTIFACT_ROOT_URL,
      );
      if (normalized === null)
        return unresolvedCandidate("rejected", [
          "The module URL cannot be parsed.",
        ]);
      const admitted = decodeModuleUrlPath(normalized.pathname);
      if (typeof admitted !== "string") return admitted;
    }
    // Host syntax is not a canonical logical path. In particular, Windows
    // separators and drive letters must not be reclassified as invalid/URLs.
    return input.declaredPath.includes("\0") ||
      (!esm && fileUrlPath(input.declaredPath) === null)
      ? unresolvedCandidate("rejected", [
          "NUL or unsafe file URL path syntax is not admitted in a runtime path.",
        ])
      : unresolvedCandidate("unavailable", [
          "An absolute runtime host path has no established mapping to the selected logical artifact root.",
        ]);
  }
  return null;
};

const resolvePath = (input: ResolveArtifactPathInput): CandidateResolution => {
  const hostPath = resolveRuntimeHostPath(input);
  if (hostPath !== null) return hostPath;
  if (input.runtimePathKind === "node-entrypoint")
    return resolveNodeRuntimeEntrypoint(input);
  if (input.moduleKind === "compiler-dependent") {
    const imported = resolvePath({ ...input, moduleKind: "import" });
    const required = resolvePath({ ...input, moduleKind: "require" });
    const sameOutcome =
      imported.status === required.status &&
      imported.resolvedPath === required.resolvedPath &&
      imported.candidatePath === required.candidatePath;
    const limitation =
      "Static TypeScript loader mode is compiler-dependent without retained compiler options. " +
      (sameOutcome
        ? "Node import and require resolution agree on this outcome."
        : "Node import and require resolution disagree; neither branch is an established target.");
    return sameOutcome
      ? {
          ...imported,
          ...(imported.unexaminedModuleImports === true ||
          required.unexaminedModuleImports === true
            ? { unexaminedModuleImports: true as const }
            : {}),
          limitations: [
            ...new Set([
              ...imported.limitations,
              ...required.limitations,
              limitation,
            ]),
          ],
        }
      : {
          resolvedPath: null,
          status: "unavailable",
          limitations: [limitation],
          conditionalResolutions: [
            conditionalResolution("import", imported),
            conditionalResolution("require", required),
          ],
        };
  }
  if (input.runtimePathKind === "url-resource")
    return resolveExactUrlResource(input);
  if (
    (input.runtimePathKind === "exact-file" ||
      input.runtimePathKind === "application-file") &&
    isRuntimePathDeclaration(input)
  )
    return resolveRuntimeEntrypoint(input);
  // Package import keys are literal lookup identities, not artifact paths.
  // The selected target is admitted separately by resolveExportTarget.
  if (
    input.context === "module-specifier" &&
    input.declaredPath.startsWith("#")
  )
    return resolvePackageImportAlias(input, input.declaredPath);
  const candidate = contextualCandidate(input);
  if (typeof candidate !== "string") return candidate;
  const confined = confineCandidate(candidate);
  if (typeof confined !== "string") return confined;
  if (input.context === "html-reference" || input.context === "url-reference")
    return (
      resolveFileCandidates(input, [confined]) ??
      unresolvedCandidate("not-found", [
        `The exact ${input.context === "html-reference" ? "HTML" : "URL"} resource ${confined} was not found among the selected application files.`,
      ])
    );
  const isModuleUrlPath =
    input.context === "module-specifier" &&
    (isRelativeJavaScriptModuleSpecifier(input.declaredPath) ||
      input.declaredPath.startsWith("/") ||
      fileUrlPath(input.declaredPath) !== undefined);
  const emittedSourceCandidates =
    isModuleUrlPath && input.moduleKind !== undefined
      ? typescriptEmittedSourceCandidates(input.sourcePath, confined)
      : [];
  if (isModuleUrlPath && input.moduleKind === "import")
    return (
      resolveRuntimeSourceCandidates(
        input,
        confined,
        emittedSourceCandidates,
      ) ?? notFoundCandidate()
    );
  return resolveCandidate(input, confined, new Set(), emittedSourceCandidates);
};

const resolveExactUrlResource = (
  input: ResolveArtifactPathInput,
): CandidateResolution => {
  // Electron loadURL requires a protocol. A scheme-less string is not relative
  // to the calling script; filesystem paths belong to loadFile.
  if (!hasScheme(input.declaredPath))
    return unresolvedCandidate("unavailable", [
      "Electron loadURL requires a URL protocol; relative filesystem paths belong to loadFile.",
    ]);
  if (!/^file:/iu.test(input.declaredPath))
    return unresolvedCandidate("external", [
      "Only file URLs can be mapped to selected local application artifacts.",
    ]);
  const urlContextCandidate = contextualCandidate(input);
  if (typeof urlContextCandidate !== "string") return urlContextCandidate;
  const confined = confineCandidate(urlContextCandidate);
  if (typeof confined !== "string") return confined;
  return (
    resolveFileCandidates(input, [confined]) ?? {
      resolvedPath: null,
      status: "not-found",
      candidatePath: confined,
      limitations: [
        `The exact URL resource ${confined} was not found among the selected application files.`,
      ],
    }
  );
};

const isRuntimePathDeclaration = (input: ResolveArtifactPathInput): boolean =>
  input.context === "filesystem-expression" ||
  (input.context === "module-specifier" &&
    (isRelativeJavaScriptModuleSpecifier(input.declaredPath) ||
      input.declaredPath.startsWith("/") ||
      fileUrlPath(input.declaredPath) !== undefined));

const resolveNodeRuntimeEntrypoint = (
  input: ResolveArtifactPathInput,
): CandidateResolution => {
  const windowsPath = unknownWindowsRuntimePath(input.declaredPath);
  if (windowsPath !== null) return windowsPath;
  const runtimeInput = { ...input, moduleKind: "require" as const };
  if (input.context === "package-entrypoint" && input.declaredPath === "")
    return resolveNodePackageMain(
      runtimeInput,
      posix.dirname(input.sourcePath),
      undefined,
    );
  if (
    runtimeInput.context !== "package-entrypoint" &&
    !isRuntimePathDeclaration(runtimeInput)
  ) {
    const { runtimePathKind: _runtimePathKind, ...moduleInput } = runtimeInput;
    return resolvePath(moduleInput);
  }
  const candidate = contextualCandidate(runtimeInput);
  if (typeof candidate !== "string") return candidate;
  const confined = confineCandidate(candidate);
  if (typeof confined !== "string") return confined;
  // Node entrypoints use runtime file/directory probes. They do not originate
  // in emitted TypeScript import syntax and cannot select a source substitute.
  const resolution =
    input.context === "package-entrypoint"
      ? resolveNodePackageMain(
          runtimeInput,
          posix.dirname(input.sourcePath),
          confined,
        )
      : resolveCandidate(runtimeInput, confined, new Set());
  // Retain the normalized declaration when Node's owned probes are exhausted.
  return resolution.status === "not-found" &&
    resolution.candidatePath === undefined
    ? { ...resolution, candidatePath: confined }
    : resolution;
};

const resolveRuntimeEntrypoint = (
  input: ResolveArtifactPathInput,
): CandidateResolution => {
  if (input.runtimePathKind === "application-file") {
    const windowsPath = unknownWindowsRuntimePath(input.declaredPath);
    if (windowsPath !== null) return windowsPath;
  }
  const rejected = rejectDeclaration(
    input.declaredPath,
    declaresLiteralPercent(input),
  );
  if (rejected !== null) return rejected;
  if (hasScheme(input.declaredPath) || looksExternal(input.declaredPath))
    return unresolvedCandidate("external", [
      "Electron runtime entrypoints must identify local paths, not external URLs.",
    ]);
  if (
    input.runtimePathKind === "application-file" &&
    input.applicationRootPath === null
  )
    return unresolvedCandidate("unavailable", [
      "Inventoried package metadata does not establish one application root for this source; the loadFile base is unknown.",
    ]);
  const candidate = confineCandidate(
    input.runtimePathKind === "application-file"
      ? posix.join(input.applicationRootPath ?? "", input.declaredPath)
      : relativeCandidate(input.sourcePath, input.declaredPath),
  );
  if (typeof candidate !== "string") return candidate;
  return (
    resolveFileCandidates(input, [candidate]) ?? {
      resolvedPath: null,
      status: "not-found",
      candidatePath: candidate,
      limitations: [
        `The declared Electron runtime entrypoint ${candidate} was not found as an exact file among the selected application files; extension and directory fallback were not attempted.`,
      ],
    }
  );
};

/** Host filesystem spellings need target-platform context before admission. */
const unknownWindowsRuntimePath = (
  declared: string,
): CandidateResolution | null =>
  !declared.includes("\0") &&
  (declared.includes("\\") || /^[a-z]:/iu.test(declared))
    ? unresolvedCandidate("unavailable", [
        "Windows-relative runtime paths require target-platform and drive context that the selected logical artifact inventory does not establish.",
      ])
    : null;

const resolveRuntimeSourceCandidates = (
  input: ResolveArtifactPathInput,
  exactPath: string,
  sourceCandidates: readonly TypeScriptEmittedSourceCandidate[],
): CandidateResolution | null => {
  const exactCandidate: TypeScriptEmittedSourceCandidate = {
    path: exactPath,
    kind: "implementation",
  };
  for (const candidate of [exactCandidate, ...sourceCandidates]) {
    const selected = findFileCandidate(input, candidate.path);
    if (selected === null) continue;
    return candidate.kind === "declaration"
      ? {
          resolvedPath: null,
          status: "unavailable",
          candidatePath: candidate.path,
          limitations: [
            "Only a TypeScript declaration fallback was found; it does not establish the requested runtime module.",
          ],
        }
      : selected;
  }
  return null;
};

const rejectDeclaration = (
  declared: string,
  literalPercent = false,
  allowEmptyPath = false,
): CandidateResolution | null => {
  if (declared.length === 0 && !allowEmptyPath)
    return unresolvedCandidate("rejected", ["The declared path is empty."]);
  if (declared.includes("\0") || declared.includes("\\"))
    return unresolvedCandidate("rejected", [
      "NUL and backslash path syntax are not admitted for canonical artifact paths.",
    ]);
  if (!literalPercent && !admitsCanonicalPathSyntax(declared))
    return unresolvedCandidate("rejected", [
      "Encoded dot or separator bytes are rejected before artifact path resolution.",
    ]);
  return null;
};

/**
 * Filesystem expressions, exact runtime paths, and CommonJS requests retain
 * literal filename bytes. URL-to-path conversion belongs to the producer;
 * these consumers must not decode or reject the resulting percent spelling.
 * Root confinement still applies to the joined candidate.
 */
const declaresLiteralPercent = (input: ResolveArtifactPathInput): boolean =>
  input.context === "filesystem-expression" ||
  (input.runtimePathKind === "exact-file" &&
    isRuntimePathDeclaration(input) &&
    !looksExternal(input.declaredPath)) ||
  (input.moduleKind === "require" &&
    (input.context === "module-specifier" ||
      input.context === "package-entrypoint"));

const contextualCandidate = (
  input: ResolveArtifactPathInput,
): string | CandidateResolution => {
  const { context } = input;
  if (context === "html-reference") return htmlCandidate(input);
  // URL suffixes are evidence, not pathname bytes. Admit only the path while
  // retaining the complete declaration on the resolution result.
  let declared =
    context === "url-reference"
      ? stripQueryAndFragment(input.declaredPath)
      : input.declaredPath;
  if (context === "url-reference" && declared.length === 0)
    return input.runtimePathKind === "url-resource"
      ? unresolvedCandidate("unavailable", [
          "A suffix-only runtime URL requires the window's current document URL; the calling script does not establish that base.",
        ])
      : unresolvedCandidate("rejected", [
          "The URL reference contains no pathname, and its base document is not established by this analysis.",
        ]);
  if (context === "module-specifier" && /^file:/iu.test(declared)) {
    const fileUrl = fileUrlPath(declared);
    if (fileUrl === null)
      return unresolvedCandidate("rejected", [
        "The file URL path contains syntax that cannot identify a canonical artifact path.",
      ]);
    if (fileUrl !== undefined)
      return input.moduleKind === "require"
        ? unresolvedCandidate("external", [
            "Node CommonJS require specifiers do not resolve file URLs as local artifacts.",
          ])
        : fileUrl;
    return unresolvedCandidate("external", [
      "File URL authorities or invalid file URL forms cannot be mapped to artifact-local paths.",
    ]);
  }
  if (
    context === "module-specifier" &&
    input.moduleKind === "require" &&
    declared.includes("\\") &&
    (!hasScheme(declared) || /^[a-z]:/iu.test(declared))
  ) {
    const windowsPath = unknownWindowsRuntimePath(declared);
    if (windowsPath !== null) return windowsPath;
  }
  const hasUrlPathSemantics =
    context === "module-specifier" && input.moduleKind === "import";
  if (hasUrlPathSemantics) {
    declared = htmlUrlText(declared);
    if (isRelativeJavaScriptModuleSpecifier(input.declaredPath))
      declared = declared.replaceAll("\\", "/");
  }
  const rejected = rejectDeclaration(
    declared,
    declaresLiteralPercent(input) || hasUrlPathSemantics,
  );
  if (rejected !== null) return rejected;
  if (context === "module-specifier") {
    if (hasScheme(declared))
      return unresolvedCandidate("external", [
        "URL and Node builtin schemes are outside static artifact module resolution.",
      ]);
    if (
      !isRelativeJavaScriptModuleSpecifier(input.declaredPath) &&
      !input.declaredPath.startsWith("/")
    )
      return bareModuleCandidate(input);
    if (input.moduleKind !== "require") {
      if (hasUrlPathSemantics) {
        // URL normalization can leave and then re-enter the synthetic namespace.
        // Preserve the shared URL owner's above-root markers before that loss.
        if (
          applyUrlReference(
            urlDirectoryState(posix.dirname(input.sourcePath)),
            stripQueryAndFragment(declared),
            true,
          ).escapes > 0
        )
          return unresolvedCandidate("rejected", [
            "The module URL escapes the selected logical artifact root.",
          ]);
        const sourceUrl = packageMetadataUrl(input.sourcePath, declared);
        const base = sourceUrl.ok
          ? sourceUrl.value
          : sourceUrl.error.structuralUrl;
        const normalized = URL.parse(declared, base);
        if (normalized === null)
          return unresolvedCandidate("rejected", [
            "The module URL cannot be parsed.",
          ]);
        if (!normalized.pathname.startsWith(PACKAGE_ARTIFACT_ROOT_URL.pathname))
          return unresolvedCandidate("rejected", [
            "The module URL escapes the selected logical artifact root.",
          ]);
        // Node validates the complete normalized file URL, including encoded
        // separator bytes inherited from an inventoried source directory.
        const decoded = decodeModuleUrlPath(
          normalized.pathname.slice(PACKAGE_ARTIFACT_ROOT_URL.pathname.length),
        );
        if (typeof decoded !== "string") return decoded;
        if (
          !sourceUrl.ok &&
          decoded
            .split("/")
            .some((segment) => sourceUrl.error.structuralSegments.has(segment))
        )
          return unresolvedCandidate("unavailable", [
            sourceUrl.error.limitation,
          ]);
        const candidate = urlRelativeCandidate("", `/${decoded}`);
        return typeof candidate === "string"
          ? exactUrlPathCandidate(decoded, candidate, "module URL")
          : candidate;
      }
      const decoded = decodeModuleUrlPath(stripQueryAndFragment(declared));
      if (typeof decoded !== "string") return decoded;
      declared = decoded;
    }
  } else if (context !== "package-entrypoint" && looksExternal(declared))
    // Package main is a filesystem declaration. Scheme-like filename bytes
    // remain literal; URI classification belongs to module and URL owners.
    return unresolvedCandidate("external", [
      "URL schemes and protocol-relative URLs are outside this local artifact path context.",
    ]);
  if (context === "url-reference") {
    // A file base gives raw drive-letter segments special meaning, including
    // after dot segments reach the root. Parse before percent decoding so an
    // encoded drive-like filename stays literal. The synthetic base establishes
    // only this ambiguity; it does not establish the source's runtime scheme.
    const sourceUrlPath = input.sourcePath
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const fileReference = URL.parse(declared, `file:///${sourceUrlPath}`);
    if (fileReference === null)
      return unresolvedCandidate("rejected", [
        "The URL reference cannot be parsed as a URL.",
      ]);
    if (/^\/[A-Za-z]:(?:\/|$)/u.test(fileReference.pathname))
      return unresolvedCandidate("unavailable", [
        "Drive-letter URL paths cannot be mapped without the source URL scheme and filesystem root.",
      ]);
    const decoded = percentDecodeUrlPath(declared);
    if (decoded === null)
      return unresolvedCandidate("rejected", [
        "The URL reference path percent-decodes to NUL or to bytes that are not UTF-8.",
      ]);
    const candidate = urlRelativeCandidate(
      posix.dirname(input.sourcePath),
      decoded,
    );
    return typeof candidate === "string"
      ? exactUrlPathCandidate(decoded, candidate, "URL")
      : candidate;
  }
  if (context === "module-specifier" && input.moduleKind === "import") {
    const candidate = urlRelativeCandidate(
      posix.dirname(input.sourcePath),
      declared,
    );
    return typeof candidate === "string"
      ? exactUrlPathCandidate(declared, candidate, "module URL")
      : candidate;
  }
  return relativeCandidate(input.sourcePath, declared);
};

const decodeModuleUrlPath = (
  declared: string,
): string | CandidateResolution => {
  const decoded = decodeJavaScriptModuleUrlPath(declared);
  return decoded.ok
    ? decoded.value
    : unresolvedCandidate("rejected", [decoded.error]);
};

const relativeCandidate = (sourcePath: string, declared: string): string =>
  declared.startsWith("/")
    ? declared.slice(1)
    : posix.join(posix.dirname(sourcePath), declared);

/**
 * A URL path during reference resolution. Above-root `..` markers are kept
 * apart from segments, so a later `..` cannot cancel an escape, while empty
 * segments stay removable until the final path is formed.
 */
interface UrlPathState {
  readonly escapes: number;
  readonly segments: readonly string[];
}

const urlDirectoryState = (directory: string): UrlPathState => ({
  escapes: 0,
  segments: directory === "" || directory === "." ? [] : directory.split("/"),
});

/**
 * Apply URL dot segments: `..` removes the previous segment even when it is
 * empty, so `assets//../app.js` names `assets/app.js`. A final `.` or `..`
 * leaves directory form, as the URL parser does.
 */
const applyUrlReference = (
  base: UrlPathState,
  reference: string,
  encodedDotSegments = false,
): UrlPathState => {
  const absolute = reference.startsWith("/");
  const segments = absolute ? [] : [...base.segments];
  let escapes = absolute ? 0 : base.escapes;
  const parts = (absolute ? reference.slice(1) : reference).split("/");
  for (const [index, part] of parts.entries()) {
    const dot = encodedDotSegments ? part.replace(/%2e/giu, ".") : part;
    if (dot !== "." && dot !== "..") {
      segments.push(part);
      continue;
    }
    if (dot === "..")
      if (segments.length > 0) segments.pop();
      else escapes += 1;
    if (index === parts.length - 1) segments.push("");
  }
  return { escapes, segments };
};

/** A relative reference replaces the base URL's final path segment. */
const urlBaseDirectory = (base: UrlPathState): UrlPathState => ({
  escapes: base.escapes,
  segments: base.segments.slice(0, -1),
});

/**
 * Form the artifact candidate. A remaining empty segment cannot name a
 * canonical artifact file; a trailing one is directory form. Confinement
 * rejects a candidate that keeps an above-root marker.
 */
const urlPathCandidate = (path: UrlPathState): string | CandidateResolution => {
  const segments =
    path.segments.at(-1) === "" ? path.segments.slice(0, -1) : path.segments;
  if (segments.includes(""))
    return unresolvedCandidate("unavailable", [
      "Repeated URL path separators cannot be mapped to an exact canonical artifact file.",
    ]);
  return [
    ...Array.from({ length: path.escapes }, () => ".."),
    ...segments,
  ].join("/");
};

/** Resolve a URL path reference against a canonical directory. */
const urlRelativeCandidate = (
  directory: string,
  reference: string,
): string | CandidateResolution =>
  urlPathCandidate(applyUrlReference(urlDirectoryState(directory), reference));

const bareModuleCandidate = (
  input: ResolveArtifactPathInput,
): CandidateResolution => {
  const request = parseBarePackageRequest(input.declaredPath, input.moduleKind);
  if (request === null || isBuiltin(input.declaredPath))
    return unresolvedCandidate("external", [
      "The bare specifier is a Node builtin or invalid package name.",
    ]);
  if (
    input.moduleKind === "import" &&
    (request.packageName.startsWith(".") || request.packageName.includes("%"))
  )
    return unresolvedCandidate("rejected", [
      "ES module package names cannot start with a dot or contain percent signs.",
    ]);
  const self = packageSelfCandidate(input, request);
  if (self !== null) return self;
  // ESM constructs a package.json URL; its parsed identity is not a literal
  // dependency directory. Self resolution above still uses the exact name.
  let dependencyDirectory = posix.join("node_modules", request.packageName);
  if (input.moduleKind === "import") {
    const metadataUrl = new URL(
      `./node_modules/${request.packageName}/package.json`,
      PACKAGE_ARTIFACT_ROOT_URL,
    );
    if (!metadataUrl.pathname.endsWith("/package.json"))
      return unresolvedCandidate("external", [
        `ESM package name ${JSON.stringify(request.packageName)} produces a dependency URL whose pathname does not name package.json; no literal or suffix-stripped package directory was searched.`,
      ]);
    const decoded = decodeModuleUrlPath(
      metadataUrl.pathname.slice(PACKAGE_ARTIFACT_ROOT_URL.pathname.length),
    );
    if (typeof decoded !== "string") return decoded;
    const confined = confineCandidate(decoded);
    if (typeof confined !== "string") return confined;
    dependencyDirectory = posix.dirname(confined);
  }
  let nearestNotFound: CandidateResolution | null = null;
  for (const directory of packageLookupDirectories(input)) {
    const candidate = posix.join(directory, dependencyDirectory);
    const metadata = readPackageMetadata(input, candidate);
    const continueCommonJsLookup =
      input.moduleKind === "require" &&
      (metadata.kind === "absent" ||
        (metadata.kind === "available" &&
          (!request.dependencyExportsEligible ||
            metadata.exports === undefined)));
    const packageResolution =
      metadata.kind !== "absent" || hasContainerDirectory(input, candidate)
        ? resolvePackageDependency(input, candidate, request, metadata)
        : request.packageSubpath === "." && input.moduleKind !== "import"
          ? resolveFileCandidates(
              input,
              fileCandidates(candidate, input.moduleKind),
            )
          : null;
    if (packageResolution !== null) {
      if (
        continueCommonJsLookup &&
        packageResolution.status === "not-found" &&
        packageResolution.stopsAncestorLookup !== true
      ) {
        nearestNotFound ??= packageResolution;
      } else return packageResolution;
    }
  }
  if (nearestNotFound !== null)
    return {
      ...nearestNotFound,
      ...(ELECTRON_MODULE.test(input.declaredPath)
        ? {}
        : { unexaminedModuleImports: true as const }),
    };
  return {
    ...unresolvedCandidate("external", [
      "No matching bare package was inventoried in an enclosing node_modules directory.",
    ]),
    ...(ELECTRON_MODULE.test(input.declaredPath)
      ? {}
      : { unexaminedModuleImports: true as const }),
  };
};

function* packageLookupDirectories(
  input: ResolveArtifactPathInput,
): Generator<string> {
  let directory = posix.dirname(input.sourcePath);
  while (true) {
    if (
      input.moduleKind !== "require" ||
      posix.basename(directory) !== "node_modules"
    )
      yield directory;
    if (directory === "." || directory === "") return;
    directory = posix.dirname(directory);
  }
}

/**
 * Nearest same-container package.json, stopping at a `node_modules` directory
 * so a nested package cannot inherit an ancestor's map.
 */
const enclosingPackageMetadata = (
  input: ResolveArtifactPathInput,
):
  | Extract<PackageMetadata, { readonly kind: "available" | "unavailable" }>
  | { readonly kind: "none" } => {
  let directory = posix.dirname(input.sourcePath);
  while (posix.basename(directory) !== "node_modules") {
    const metadata = readPackageMetadata(input, directory);
    if (metadata.kind !== "absent") return metadata;
    if (directory === "." || directory === "") break;
    directory = posix.dirname(directory);
  }
  return { kind: "none" };
};

/**
 * Resolve an exact `#alias` against the importer's enclosing `imports` map.
 * Selected relative targets are exact files; patterns, recursive aliases, and
 * external-package targets stay unresolved without falling through.
 */
const resolvePackageImportAlias = (
  input: ResolveArtifactPathInput,
  specifier: string,
): CandidateResolution => {
  const classified = classifyPackageImportSpecifier(specifier);
  if (classified.kind === "invalid")
    return unresolvedCandidate("rejected", [
      `The package import specifier ${JSON.stringify(specifier)} is invalid; "#" and specifiers that end with "/" are not valid import aliases.`,
    ]);
  const metadata = enclosingPackageMetadata(input);
  if (metadata.kind === "none")
    return unresolvedCandidate("external", [
      `No enclosing package.json defines package import alias ${specifier}; package import maps do not cross package scopes.`,
    ]);
  if (metadata.kind === "unavailable")
    return unresolvedCandidate("unavailable", [metadata.limitation]);
  const lookup = lookupExactPackageImport(metadata.imports, specifier);
  if (lookup.kind === "undefined-map")
    return unresolvedCandidate("external", [
      `Package metadata ${metadata.path} does not define package import alias ${specifier}.`,
    ]);
  if (lookup.kind === "missing-key")
    return unresolvedCandidate("external", [
      `Package metadata ${metadata.path} does not define package import alias ${specifier}; it declares ${lookup.declared.join(", ") || "no imports keys"}.`,
    ]);
  if (lookup.kind === "pattern-unresolved")
    return unresolvedCandidate("unavailable", [
      `Wildcard package import aliases remain unresolved; package metadata ${metadata.path} has no exact imports key ${specifier}.`,
    ]);
  const selected = selectExportTarget(
    lookup.target,
    packageExportConditions(input.moduleKind),
    metadata.path,
    "imports",
  );
  if (selected.kind === "invalid" || selected.kind === "invalid-config")
    return unresolvedCandidate("rejected", [
      `Package metadata ${metadata.path}: ${selected.limitation}`,
    ]);
  if (selected.kind === "unmatched")
    return unresolvedCandidate("external", [
      `Package metadata ${metadata.path} declares no imports target for alias ${specifier} under the active conditions; it declares ${selected.declared.join(", ") || "no conditions"}.`,
    ]);
  if (selected.kind === "blocked")
    return unresolvedCandidate("external", [
      `Package metadata ${metadata.path} blocks import alias ${specifier} with ${selected.cause === "null" ? "an explicit null imports target" : "an empty imports target array"}.`,
    ]);
  if (selected.kind === "non-relative") {
    const target = classifyPackageImportTargetString(selected.value);
    // Unsupported lookup may still reach a selected module and another launch
    // owner. Only a known builtin establishes that no local imports follow.
    return unresolvedCandidate(
      isBuiltin(selected.value) || ELECTRON_MODULE.test(selected.value)
        ? "external"
        : "unavailable",
      [
        target.kind === "recursive"
          ? `Recursive package import aliases remain unresolved; package metadata ${metadata.path} maps ${specifier} to ${JSON.stringify(target.target)}.`
          : `External-package import targets remain unresolved; package metadata ${metadata.path} maps ${specifier} to ${JSON.stringify(target.target)}.`,
      ],
    );
  }
  return resolveExportTarget(input, metadata.path, selected, "imports");
};

/** Self references use the nearest package scope before dependency lookup. */
const packageSelfCandidate = (
  input: ResolveArtifactPathInput,
  request: BarePackageRequest,
): CandidateResolution | null => {
  if (input.moduleKind === undefined || !input.files.has(input.sourcePath))
    return null;
  const metadata = enclosingPackageMetadata(input);
  if (metadata.kind === "none") return null;
  if (metadata.kind === "unavailable")
    return unresolvedCandidate("unavailable", [metadata.limitation]);
  if (metadata.name === undefined || metadata.exports === undefined)
    return null;
  let subpath: string;
  if (input.moduleKind === "import") {
    if (metadata.name !== request.packageName) return null;
    subpath = request.packageSubpath;
  } else if (input.declaredPath === metadata.name) {
    subpath = ".";
  } else if (input.declaredPath.startsWith(`${metadata.name}/`)) {
    subpath = `.${input.declaredPath.slice(metadata.name.length)}`;
  } else return null;
  // Self resolution does not apply the CommonJS dependency-name matcher.
  return resolvePackageExports(input, metadata.path, subpath, metadata.exports);
};

/** Resolve an installed dependency using one parsed request and its metadata. */
const resolvePackageDependency = (
  input: ResolveArtifactPathInput,
  directory: string,
  request: BarePackageRequest,
  metadata: PackageMetadata,
): CandidateResolution => {
  const subpath = request.packageSubpath;
  if (request.dependencyExportsEligible && metadata.kind === "unavailable")
    return unresolvedCandidate("unavailable", [metadata.limitation]);
  const rawExports =
    request.dependencyExportsEligible && metadata.kind === "available"
      ? metadata.exports
      : undefined;
  if (rawExports === undefined) {
    if (subpath === ".")
      return (
        (input.moduleKind === "import"
          ? null
          : resolveFileCandidates(
              input,
              fileCandidates(directory, input.moduleKind),
            )) ?? resolveDirectory(input, directory, metadata, new Set())
      );
    if (input.moduleKind === "import")
      return resolveLegacyEsmSubpath(input, directory, subpath);
    const candidate = confineCandidate(`${directory}/${subpath.slice(2)}`);
    return typeof candidate === "string"
      ? resolveCandidate(input, candidate, new Set())
      : candidate;
  }
  return resolvePackageExports(
    input,
    posix.join(directory, "package.json"),
    subpath,
    rawExports,
  );
};

/** Legacy ESM package subpaths are exact URLs, never extension or directory lookups. */
const resolveLegacyEsmSubpath = (
  input: ResolveArtifactPathInput,
  directory: string,
  subpath: string,
): CandidateResolution => {
  const subpathPath = stripQueryAndFragment(htmlUrlText(subpath));
  const declarationRejection = rejectDeclaration(subpathPath, true);
  if (declarationRejection !== null) return declarationRejection;
  let depth = directory === "." ? 0 : directory.split("/").length;
  for (const segment of subpathPath.split("/")) {
    if (segment === "..") {
      if (depth === 0)
        return unresolvedCandidate("rejected", [
          "The resolved candidate escapes the canonical artifact root.",
        ]);
      depth--;
    } else if (segment !== ".") depth++;
  }
  const metadataUrl = packageMetadataUrl(
    posix.join(directory, "package.json"),
    subpath,
  );
  const url = new URL(
    subpath,
    metadataUrl.ok ? metadataUrl.value : metadataUrl.error.structuralUrl,
  );
  if (!url.pathname.startsWith(PACKAGE_ARTIFACT_ROOT_URL.pathname))
    return unresolvedCandidate("rejected", [
      "The resolved candidate escapes the canonical artifact root.",
    ]);
  const encodedPath = url.pathname.slice(
    PACKAGE_ARTIFACT_ROOT_URL.pathname.length,
  );
  const rejected = rejectDeclaration(encodedPath, true);
  if (rejected !== null) return rejected;
  const decoded = decodeModuleUrlPath(encodedPath);
  if (typeof decoded !== "string") return decoded;
  const candidate = confineCandidate(decoded);
  if (typeof candidate !== "string") return candidate;
  if (urlPathIsDirectory(url.pathname))
    return unresolvedCandidate("rejected", [
      `ESM package subpath ${JSON.stringify(input.declaredPath)} has URL directory form; directory imports are unsupported and no exact-file, package main or index lookup was attempted.`,
    ]);
  const unrepresentableBase = metadataUrl.ok ? undefined : metadataUrl.error;
  if (
    unrepresentableBase !== undefined &&
    url.pathname
      .split("/")
      .some((segment) => unrepresentableBase.structuralSegments.has(segment))
  )
    return unresolvedCandidate("unavailable", [unrepresentableBase.limitation]);
  const file = resolveFileCandidates(input, [candidate]);
  if (file !== null) return file;
  if (hasContainerDirectory(input, candidate))
    return unresolvedCandidate("rejected", [
      `ESM package subpath ${candidate} names a directory; directory imports are unsupported and package main or index lookup was not attempted.`,
    ]);
  return exactPackageTargetNotFound(candidate, "ESM subpath");
};

const resolvePackageExports = (
  input: ResolveArtifactPathInput,
  packagePath: string,
  subpath: string,
  rawExports: string | object,
): CandidateResolution => {
  const exported = selectPackageExport(
    rawExports,
    subpath,
    input.moduleKind,
    packagePath,
  );
  if (exported.status === "rejected")
    return unresolvedCandidate("rejected", [
      `Package metadata ${packagePath}: ${exported.limitation}`,
    ]);
  if (exported.status === "unmatched")
    return unresolvedCandidate("external", [
      `Directory package metadata ${packagePath} declares no exports target ${subpath === "." ? "for the active conditions" : `for subpath ${subpath}`}; exports encapsulation permits no file or index lookup. It declares ${exported.declared.join(", ") || "a root target only"}.`,
    ]);
  if (exported.status === "blocked")
    return unresolvedCandidate("external", [
      `Directory package metadata ${packagePath} blocks subpath ${subpath} with ${exported.cause === "null" ? "an explicit null exports target" : "an empty exports target array"}.`,
    ]);
  if (exported.status === "pattern-unresolved")
    return unresolvedCandidate("unavailable", [
      `Package metadata ${packagePath} selects wildcard exports key ${JSON.stringify(exported.pattern)} for subpath ${subpath}; wildcard target expansion remains unresolved.`,
    ]);
  return resolveExportTarget(input, packagePath, exported);
};

/** An exports or import target is a URL naming one exact file for both Node loaders. */
const resolveExportTarget = (
  input: ResolveArtifactPathInput,
  packagePath: string,
  target: PackageFileTarget,
  mapKind: "exports" | "imports" = "exports",
): CandidateResolution => {
  const withTargetSource = (
    outcome: CandidateResolution,
  ): CandidateResolution => ({
    ...outcome,
    limitations: outcome.limitations.map(
      (reason) =>
        `Package metadata ${packagePath}, ${mapKind} target ${JSON.stringify(target.value)}: ${reason}`,
    ),
  });
  // Node's CommonJS finalizer checks the serialized URL, including suffixes;
  // its ESM finalizer checks only the pathname. Neither error retries arrays.
  if (input.moduleKind === "require" && /%(?:2f|5c)/iu.test(target.url.href))
    return withTargetSource(
      unresolvedCandidate("rejected", [
        "The selected package URL contains encoded separator bytes.",
      ]),
    );
  const encodedPath = target.url.pathname.slice(
    PACKAGE_ARTIFACT_ROOT_URL.pathname.length,
  );
  // Package targets are URLs for both loaders, so their percent bytes encode.
  const rejected = rejectDeclaration(encodedPath, true);
  if (rejected !== null) return withTargetSource(rejected);
  const decoded = decodeModuleUrlPath(encodedPath);
  if (typeof decoded !== "string") return withTargetSource(decoded);
  const candidate = confineCandidate(decoded);
  if (typeof candidate !== "string") return withTargetSource(candidate);
  if (target.lookupLimitation !== undefined)
    return withTargetSource(
      unresolvedCandidate("unavailable", [target.lookupLimitation]),
    );
  return (
    resolveFileCandidates(input, [candidate]) ??
    withTargetSource(exactPackageTargetNotFound(candidate, mapKind))
  );
};

/** Derived package identity and dependency policy; input retains the raw request. */
interface BarePackageRequest {
  readonly packageName: string;
  readonly packageSubpath: string;
  readonly dependencyExportsEligible: boolean;
}

const parseBarePackageRequest = (
  specifier: string,
  moduleKind: ResolveArtifactPathInput["moduleKind"],
): BarePackageRequest | null => {
  const segments = specifier.split("/");
  let packageName = segments[0] ?? "";
  if (packageName === "" || packageName === "@") return null;
  if (specifier.startsWith("@")) {
    const packageSegment = segments[1];
    if (packageSegment !== undefined && packageSegment !== "") {
      packageName = `${packageName}/${packageSegment}`;
    } else if (moduleKind !== "require") {
      if (packageSegment === undefined) return null;
      packageName = `${packageName}/`;
    }
  }
  // Node's CommonJS exports matcher excludes percent-containing package names.
  // Compare the captured name so a scoped name cannot fall back to its scope.
  const dependencyExportsEligible =
    moduleKind !== "require" ||
    /^((?:@[^/\\%]+\/)?[^./\\%][^/\\%]*)(\/.*)?$/.exec(specifier)?.[1] ===
      packageName;
  return {
    packageName,
    packageSubpath: `.${specifier.slice(packageName.length)}`,
    dependencyExportsEligible,
  };
};

const hasContainerDirectory = (
  input: ResolveArtifactPathInput,
  candidate: string,
): boolean => {
  if (input.directoryPaths?.has(candidate) === true) return true;
  if (
    [...indexCandidates(candidate), posix.join(candidate, "package.json")].some(
      (path) => {
        const file = input.files.get(path);
        return (
          file !== undefined &&
          admitsRuntimeContainer(input, path, file.container_sha256)
        );
      },
    )
  )
    return true;
  // Inventory has files rather than directory entries. An admitted descendant
  // establishes a package directory even without package.json.
  const prefix = `${candidate}/`;
  for (const [path, file] of input.files)
    if (
      path.startsWith(prefix) &&
      admitsRuntimeContainer(input, path, file.container_sha256)
    )
      return true;
  const container = crossesRuntimeArchiveBoundary(input, `${candidate}/`)
    ? undefined
    : input.files.get(input.sourcePath)?.container_sha256;
  return input.unanalyzedFiles?.hasDirectory(candidate, container) ?? false;
};

const htmlCandidate = (
  input: ResolveArtifactPathInput,
): string | CandidateResolution => {
  const declared = stripQueryAndFragment(htmlUrlText(input.declaredPath));
  // HTML owns URL-text normalization and pathname admission. A nonempty URL
  // reference may have no pathname; suffix bytes remain declaration evidence.
  // HTML references are URL text, so percent bytes still encode.
  const rejected = rejectDeclaration(
    declared,
    false,
    input.declaredPath !== "",
  );
  if (rejected !== null) return rejected;
  if (looksExternal(declared))
    return unresolvedCandidate("external", [
      "External HTML references are not mapped to local artifact assets.",
    ]);
  const rawBase = input.htmlBaseHref;
  const base =
    rawBase === undefined || rawBase === null
      ? rawBase
      : stripQueryAndFragment(htmlUrlText(rawBase));
  if (base !== undefined && base !== null && looksExternal(base))
    return unresolvedCandidate("external", [
      "The document base href is external, so its script reference is not a local artifact path.",
    ]);
  const declaredPath = percentDecodeUrlPath(declared);
  if (declaredPath === null)
    return unresolvedCandidate("rejected", [
      "The HTML reference path percent-decodes to NUL or to bytes that are not UTF-8.",
    ]);
  if (declaredPath.startsWith("/"))
    return exactUrlPathCandidate(
      declaredPath,
      urlRelativeCandidate("", declaredPath),
      "HTML",
    );
  if (base === undefined || base === null || base === "")
    return declaredPath === ""
      ? input.sourcePath
      : exactUrlPathCandidate(
          declaredPath,
          urlRelativeCandidate(posix.dirname(input.sourcePath), declaredPath),
          "HTML",
        );
  // A local base href is a second untrusted path input; apply the same
  // admission rules a declared path gets so it cannot smuggle traversal or
  // separator syntax past canonicalization.
  if (!admitsCanonicalPathSyntax(base))
    return unresolvedCandidate("rejected", [
      "The document base href uses NUL, backslash, or encoded dot and separator bytes that are not admitted for canonical artifact paths.",
    ]);
  const decodedBase = percentDecodeUrlPath(base);
  if (decodedBase === null)
    return unresolvedCandidate("rejected", [
      "The document base href path percent-decodes to NUL or to bytes that are not UTF-8.",
    ]);
  // Keep the base's empty segments and escapes until the reference is
  // applied; only the final path must name a canonical artifact file.
  const baseState = applyUrlReference(
    urlDirectoryState(posix.dirname(input.sourcePath)),
    decodedBase,
  );
  if (declaredPath === "")
    return exactUrlPathCandidate(
      decodedBase,
      urlPathCandidate(baseState),
      "HTML",
    );
  return exactUrlPathCandidate(
    declaredPath,
    urlPathCandidate(
      applyUrlReference(urlBaseDirectory(baseState), declaredPath),
    ),
    "HTML",
  );
};

const exactUrlPathCandidate = (
  declared: string,
  candidate: string | CandidateResolution,
  kind: "HTML" | "URL" | "module URL",
): string | CandidateResolution => {
  if (typeof candidate !== "string" || !urlPathIsDirectory(declared))
    return candidate;
  const confined = confineCandidate(candidate);
  if (typeof confined !== "string") return confined;
  return unresolvedCandidate("not-found", [
    `The ${kind} reference resolves to directory ${confined || "."}, not an exact selected application file.`,
  ]);
};

/** Whether a URL path retains directory form after dot-segment normalization. */
const urlPathIsDirectory = (path: string): boolean =>
  path.endsWith("/") ||
  path.endsWith("/.") ||
  path.endsWith("/..") ||
  path === "." ||
  path === "..";

const confineCandidate = (candidate: string): string | CandidateResolution => {
  const normalized = normalizeJoinedLogicalPath(candidate);
  if (logicalPathEscapesRoot(normalized))
    return unresolvedCandidate("rejected", [
      "The resolved candidate escapes the canonical artifact root.",
    ]);
  return normalized === "." ? "" : normalized;
};

type PackageMetadata =
  | {
      readonly kind: "available";
      readonly path: string;
      readonly name: string | undefined;
      readonly exports: string | object | undefined;
      readonly imports: object | undefined;
      readonly main: unknown;
      readonly module: unknown;
    }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable"; readonly limitation: string };

const readPackageMetadata = (
  input: ResolveArtifactPathInput,
  directory: string,
): PackageMetadata => {
  const path = posix.join(directory, "package.json");
  const file = input.files.get(path);
  if (file === undefined) {
    const unavailable = input.unanalyzedFiles?.get(path);
    if (
      unavailable !== undefined &&
      (admitsRuntimeContainer(input, path, unavailable.container_sha256) ||
        input.moduleKind !== undefined)
    )
      return {
        kind: "unavailable",
        limitation:
          unavailable.limitations?.[0] ??
          `Directory package metadata ${path} was inventoried but its bytes are unavailable.`,
      };
    if (input.unanalyzedFiles?.coverage.status === "unknown")
      return {
        kind: "unavailable",
        limitation: `Directory package metadata ${path} was not observed, and artifact traversal is incomplete; its absence is unknown.`,
      };
    return { kind: "absent" };
  }
  if (!admitsRuntimeContainer(input, path, file.container_sha256))
    return input.moduleKind === undefined
      ? { kind: "absent" }
      : {
          kind: "unavailable",
          limitation: `Inventoried package metadata ${path} crosses an artifact container boundary without an established runtime loader mapping.`,
        };
  if (!file.text.included)
    return {
      kind: "unavailable",
      limitation: `Directory package metadata ${path} was inventoried but its text is unavailable: ${file.text.reason}.`,
    };
  const document = input.jsonDocuments.read(file);
  if (document.status !== "included" || document.packageFields === null)
    return {
      kind: "unavailable",
      limitation: `Directory package metadata ${path} is not valid package JSON.`,
    };
  const value = document.packageFields;
  const name = value.name;
  const exports = value.exports;
  const imports = value.imports;
  const main = value.main;
  return {
    kind: "available",
    path,
    name: typeof name === "string" ? name : undefined,
    // Node's package reader ignores scalar root exports other than strings.
    // Nested targets retain their raw values for exports validation.
    exports:
      typeof exports === "string" ||
      (typeof exports === "object" && exports !== null)
        ? exports
        : undefined,
    // Import maps must be non-array objects; other shapes are not a map.
    imports:
      typeof imports === "object" && imports !== null && !Array.isArray(imports)
        ? imports
        : undefined,
    main:
      input.moduleKind !== undefined && typeof main !== "string"
        ? undefined
        : main,
    module: value.module,
  };
};

/** File and directory lookup never interprets a nested directory's exports. */
const resolveCandidate = (
  input: ResolveArtifactPathInput,
  candidate: string,
  packageChain: ReadonlySet<string>,
  emittedSourceCandidates: readonly TypeScriptEmittedSourceCandidate[] = [],
): CandidateResolution => {
  if (!commonJsDirectoryRequest(input)) {
    // An explicitly selected source path owns its identity independently of
    // whether its declaration bytes can implement a runtime module.
    const exactSource =
      input.context === "module-specifier" &&
      input.runtimePathKind === undefined
        ? resolveRuntimeSourceCandidates(input, candidate, [])
        : null;
    const file =
      exactSource ??
      resolveFileCandidates(
        input,
        fileCandidates(candidate, input.moduleKind),
      ) ??
      resolveRuntimeSourceCandidates(input, candidate, emittedSourceCandidates);
    if (file !== null) return file;
  }
  return resolveDirectory(
    input,
    candidate,
    readPackageMetadata(input, candidate),
    packageChain,
  );
};

const commonJsDirectoryRequest = (input: ResolveArtifactPathInput): boolean =>
  input.context === "module-specifier" &&
  input.moduleKind === "require" &&
  (input.declaredPath.endsWith("/") ||
    /(?:^|\/)\.{1,2}$/u.test(input.declaredPath));

const resolveDirectory = (
  input: ResolveArtifactPathInput,
  directory: string,
  metadata: PackageMetadata,
  packageChain: ReadonlySet<string>,
): CandidateResolution => {
  if (metadata.kind === "absent")
    return (
      resolveFileCandidates(
        input,
        indexCandidates(directory, input.moduleKind),
      ) ?? notFoundCandidate()
    );
  if (metadata.kind === "unavailable")
    return unresolvedCandidate("unavailable", [metadata.limitation]);
  if (packageChain.has(metadata.path))
    return unresolvedCandidate("unavailable", [
      `Directory package entrypoint cycle includes ${metadata.path}.`,
    ]);
  const entry =
    metadata.main === ""
      ? undefined
      : metadata.main !== undefined
        ? metadata.main
        : input.moduleKind === undefined
          ? metadata.module
          : undefined;
  if (entry === undefined)
    return input.moduleKind !== undefined
      ? resolveNodePackageMain(input, directory, undefined)
      : (resolveFileCandidates(
          input,
          indexCandidates(directory, input.moduleKind),
        ) ?? notFoundCandidate());
  if (typeof entry !== "string" || entry.length === 0)
    return unresolvedCandidate("unavailable", [
      `Directory package metadata ${metadata.path} is not valid package JSON.`,
    ]);
  const entryInput: ResolveArtifactPathInput = {
    declaredPath: entry,
    sourcePath: metadata.path,
    context: "package-entrypoint",
    files: input.files,
    jsonDocuments: input.jsonDocuments,
    ...(input.directoryPaths === undefined
      ? {}
      : { directoryPaths: input.directoryPaths }),
    ...(input.unanalyzedFiles === undefined
      ? {}
      : { unanalyzedFiles: input.unanalyzedFiles }),
    ...(input.moduleKind === undefined ? {} : { moduleKind: input.moduleKind }),
  };
  const hostPath = resolveRuntimeHostPath(entryInput);
  if (hostPath !== null) return hostPath;
  if (entryInput.moduleKind !== undefined) {
    const windowsPath = unknownWindowsRuntimePath(entry);
    if (windowsPath !== null) return windowsPath;
  }
  const candidate = contextualCandidate(entryInput);
  if (typeof candidate !== "string") return candidate;
  const confined = confineCandidate(candidate);
  if (typeof confined !== "string") return confined;
  if (input.moduleKind !== undefined)
    return resolveNodePackageMain(entryInput, directory, confined);
  const selected =
    resolveFileCandidates(entryInput, [
      ...fileCandidates(confined, entryInput.moduleKind),
      ...indexCandidates(confined, entryInput.moduleKind),
    ]) ??
    resolveFileCandidates(input, indexCandidates(directory, input.moduleKind));
  if (selected !== null) return selected;
  return resolveCandidate(
    entryInput,
    confined,
    new Set([...packageChain, metadata.path]),
  );
};

const resolveNodePackageMain = (
  input: ResolveArtifactPathInput,
  directory: string,
  mainPath: string | undefined,
): CandidateResolution => {
  const normalizedMain = mainPath?.replace(/\/$/u, "");
  if (normalizedMain !== undefined)
    for (const suffix of NODE_PACKAGE_MAIN_SUFFIXES) {
      const isDirectoryIndex = suffix.startsWith("/");
      if (normalizedMain === "" && !isDirectoryIndex) continue;
      const selected = resolveFileCandidates(input, [
        isDirectoryIndex
          ? posix.join(normalizedMain, suffix.slice(1))
          : posix.normalize(`${normalizedMain}${suffix}`),
      ]);
      if (selected === null) continue;
      if (input.moduleKind === "require") return selected;
      // ESM probes the normalized main, then appends the selected suffix to
      // the original declaration before finalizing the resulting file path.
      const finalized = confineCandidate(
        relativeCandidate(input.sourcePath, `${input.declaredPath}${suffix}`),
      );
      if (typeof finalized !== "string") return finalized;
      const finalizedFile = resolveFileCandidates(input, [
        finalized.replace(/\/$/u, ""),
      ]);
      if (finalizedFile !== null) return finalizedFile;
      if (hasContainerDirectory(input, finalized))
        return {
          ...unresolvedCandidate("rejected", [
            `The selected legacy ESM package main finalizes to directory ${finalized}; directory imports are unsupported and no later main or index candidate was tried.`,
          ]),
          candidatePath: finalized,
        };
      return unresolvedCandidate("not-found", [
        `The selected legacy ESM package main finalizes to ${finalized}, which is not an inventoried file; no later main or index candidate was tried.`,
      ]);
    }
  const fallback = resolveFileCandidates(
    input,
    indexCandidates(directory, input.moduleKind),
  );
  if (fallback !== null) return fallback;
  return input.moduleKind === "require" && mainPath !== undefined
    ? { ...notFoundCandidate(), stopsAncestorLookup: true }
    : notFoundCandidate();
};

const resolveFileCandidates = (
  input: ResolveArtifactPathInput,
  candidates: readonly string[],
): CandidateResolution | null => {
  for (const path of candidates) {
    const selected = findFileCandidate(input, path);
    if (selected === null) continue;
    return selected.status === "resolved" &&
      isRuntimeDeclarationPath(input, path)
      ? {
          resolvedPath: null,
          status: "unavailable",
          candidatePath: path,
          limitations: [
            `The TypeScript declaration ${path} is compile-time evidence and cannot identify a runtime module implementation.`,
          ],
        }
      : selected;
  }
  return null;
};

/** Classify the extension as inventory does; retain exact archive occurrence bytes. */
const runtimeArchiveRoot = (path: string): string | undefined => {
  const components = path.split("/");
  const archive = components.findLastIndex(
    (component, index) =>
      index < components.length - 1 &&
      component.toLowerCase().endsWith(".asar"),
  );
  return archive < 0
    ? undefined
    : `${components.slice(0, archive + 1).join("/")}/`;
};

/** One archive-path admission rule serves files, directories and their metadata. */
const isNodeFilesystemLookup = (input: ResolveArtifactPathInput): boolean =>
  input.runtimePathKind === "node-entrypoint" ||
  (input.moduleKind !== undefined &&
    (input.context === "module-specifier" ||
      input.context === "package-entrypoint"));

/** Runtime launch and module lookup share archive occurrence admission. */
const crossesRuntimeArchiveBoundary = (
  input: ResolveArtifactPathInput,
  path: string,
): boolean => {
  // Electron's archive filesystem normalizes a relative module path before
  // opening it, including entry into an inventoried archive occurrence and
  // escape from one, after the existing artifact-root confinement check.
  const sourceArchive = runtimeArchiveRoot(input.sourcePath);
  const targetArchive = runtimeArchiveRoot(path);
  return (
    isNodeFilesystemLookup(input) &&
    ((sourceArchive !== undefined && !path.startsWith(sourceArchive)) ||
      (targetArchive !== undefined &&
        !input.sourcePath.startsWith(targetArchive)))
  );
};

const admitsRuntimeContainer = (
  input: ResolveArtifactPathInput,
  path: string,
  containerSha256: string,
): boolean => {
  const source = input.files.get(input.sourcePath);
  return (
    crossesRuntimeArchiveBoundary(input, path) ||
    (input.runtimePathKind === "application-file" &&
      input.applicationRootIsProven === true) ||
    source === undefined ||
    containerSha256 === source.container_sha256
  );
};

/** Own candidate presence and container identity independently of loader policy. */
const findFileCandidate = (
  input: ResolveArtifactPathInput,
  path: string,
): CandidateResolution | null => {
  const target = input.files.get(path);
  if (
    target !== undefined &&
    admitsRuntimeContainer(input, path, target.container_sha256)
  )
    return { resolvedPath: path, status: "resolved", limitations: [] };
  if (target !== undefined && isNodeFilesystemLookup(input))
    return {
      resolvedPath: null,
      status: "unavailable",
      candidatePath: path,
      limitations: [
        "The inventoried module crosses an artifact container boundary; its runtime loader mapping has not been established.",
      ],
    };
  const unanalyzed = input.unanalyzedFiles?.get(path);
  if (
    unanalyzed !== undefined &&
    admitsRuntimeContainer(input, path, unanalyzed.container_sha256)
  )
    return {
      resolvedPath: null,
      status: "unavailable",
      candidatePath: path,
      limitations: [
        ...(unanalyzed.limitations ?? []),
        unanalyzed.kind === undefined
          ? `${path} exists in the inventoried artifact container (sha256 ${unanalyzed.sha256 ?? "unknown"}, ${unanalyzed.bytes === null ? "unknown size" : `${String(unanalyzed.bytes)} bytes`}) but is not a JavaScript, JSON, HTML, source map, or native add-on file; its contents were not analyzed.`
          : `${path} is an inventoried ${unanalyzed.kind} file, but its bytes are unavailable (hash status ${unanalyzed.hash_status ?? "unknown"}); resolution cannot be confirmed.`,
      ],
    };
  if (input.unanalyzedFiles?.coverage.status === "unknown")
    return {
      resolvedPath: null,
      status: "unavailable",
      candidatePath: path,
      limitations: [
        `Artifact path ${path} was not observed, and artifact traversal is incomplete; its absence is unknown.`,
      ],
    };
  return null;
};

const isRuntimeDeclarationPath = (
  input: ResolveArtifactPathInput,
  path: string,
): boolean =>
  input.moduleKind !== undefined && /\.d\.(?:ts|mts|cts)$/iu.test(path);

const NODE_MODULE_EXTENSIONS = [".js", ".json", ".node"] as const;
const NODE_PACKAGE_MAIN_SUFFIXES = [
  "",
  ...NODE_MODULE_EXTENSIONS,
  ...NODE_MODULE_EXTENSIONS.map((extension) => `/index${extension}`),
];

const fileCandidates = (
  candidate: string,
  moduleKind?: ResolveArtifactPathInput["moduleKind"],
): readonly string[] => [
  candidate,
  ...(moduleKind === undefined ? EXTENSIONS : NODE_MODULE_EXTENSIONS).map(
    (extension) => `${candidate}${extension}`,
  ),
];

const indexCandidates = (
  candidate: string,
  moduleKind?: ResolveArtifactPathInput["moduleKind"],
): readonly string[] =>
  (moduleKind === undefined ? EXTENSIONS : NODE_MODULE_EXTENSIONS).map(
    (extension) => posix.join(candidate, `index${extension}`),
  );

type PackageTargetBlockCause = "null" | "empty-array";

type PackageExportOutcome =
  | ({ readonly status: "value" } & PackageFileTarget)
  | { readonly status: "rejected"; readonly limitation: string }
  | { readonly status: "blocked"; readonly cause: PackageTargetBlockCause }
  | { readonly status: "pattern-unresolved"; readonly pattern: string }
  | { readonly status: "unmatched"; readonly declared: readonly string[] };

/** Exact keys precede the best matching pattern; pattern expansion remains unknown. */
const selectPackageExport = (
  value: unknown,
  subpath: string,
  moduleKind: ResolveArtifactPathInput["moduleKind"],
  packagePath: string,
): PackageExportOutcome => {
  let target = value;
  let pattern: string | undefined;
  let declared: string[] = [];
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value);
    const hasSubpaths = keys.some((key) => key.startsWith("."));
    if (hasSubpaths && keys.some((key) => !key.startsWith(".")))
      return {
        status: "rejected",
        limitation:
          "The package exports configuration mixes subpath keys and condition keys.",
      };
    declared = keys;
    if (hasSubpaths) {
      if (subpath.endsWith("/")) return { status: "unmatched", declared };
      if (!subpath.includes("*") && Object.hasOwn(value, subpath))
        target = Reflect.get(value, subpath);
      else {
        pattern = selectPackageSubpathPattern(keys, subpath);
        if (pattern === undefined) return { status: "unmatched", declared };
        target = Reflect.get(value, pattern);
      }
    } else if (subpath !== ".") return { status: "unmatched", declared };
  } else if (subpath !== ".") return { status: "unmatched", declared };
  const selected = selectExportTarget(
    target,
    packageExportConditions(moduleKind),
    packagePath,
  );
  if (selected.kind === "invalid" || selected.kind === "invalid-config")
    return { status: "rejected", limitation: selected.limitation };
  if (selected.kind === "unmatched")
    return {
      status: "unmatched",
      declared: selected.declared,
    };
  if (selected.kind === "blocked")
    return { status: "blocked", cause: selected.cause };
  if (selected.kind === "non-relative")
    return {
      status: "rejected",
      limitation: `The package exports target ${JSON.stringify(selected.value)} must start with "./".`,
    };
  if (pattern !== undefined) return { status: "pattern-unresolved", pattern };
  return {
    status: "value",
    value: selected.value,
    url: selected.url,
    ...(selected.lookupLimitation === undefined
      ? {}
      : {
          lookupLimitation: selected.lookupLimitation,
        }),
  };
};

type ExportTargetOutcome =
  | ({ readonly kind: "value" } & PackageFileTarget)
  | { readonly kind: "non-relative"; readonly value: string }
  | { readonly kind: "blocked"; readonly cause: PackageTargetBlockCause }
  | { readonly kind: "unmatched"; readonly declared: readonly string[] }
  | { readonly kind: "invalid"; readonly limitation: string }
  | { readonly kind: "invalid-config"; readonly limitation: string };

const invalidExportTarget = (
  value: unknown,
  reason: string,
  mapKind: "exports" | "imports" = "exports",
): ExportTargetOutcome => ({
  kind: "invalid",
  limitation: `The package ${mapKind === "imports" ? "import" : "exports"} target ${JSON.stringify(value) ?? String(value)} ${reason}.`,
});

// Node checks raw target segments before URL normalization. Compare encoded
// segment names here; full URL decoding follows array target selection.
const forbiddenExportSegment = (value: string): string | undefined =>
  value
    .slice(2)
    .split(/[\\/]/u)
    .find((raw) => {
      const segment = raw.replace(/%[0-9a-f]{2}/giu, (encoded) =>
        String.fromCharCode(Number.parseInt(encoded.slice(1), 16)),
      );
      return (
        segment === "." ||
        segment === ".." ||
        segment.toLowerCase() === "node_modules"
      );
    });

const selectStringPackageTarget = (
  value: string,
  packagePath: string,
  mapKind: "exports" | "imports",
): ExportTargetOutcome => {
  if (mapKind === "imports") {
    const target = classifyPackageImportTargetString(value);
    if (target.kind === "invalid")
      return invalidExportTarget(
        value,
        "cannot be parent-relative, absolute, or a URL",
        mapKind,
      );
    if (target.kind !== "relative") return { kind: "non-relative", value };
  } else if (!value.startsWith("./"))
    return invalidExportTarget(value, 'must start with "./"', mapKind);
  const forbidden = forbiddenExportSegment(value);
  if (forbidden !== undefined)
    return invalidExportTarget(
      value,
      `contains forbidden path segment ${JSON.stringify(forbidden)} before URL normalization`,
      mapKind,
    );
  const metadataUrl = packageMetadataUrl(packagePath, value);
  const packageUrl = metadataUrl.ok
    ? metadataUrl.value
    : metadataUrl.error.structuralUrl;
  // Node constructs the URL before deciding whether this array entry is an
  // invalid package target. Tabs/newlines and dot segments normalize here;
  // percent decoding and existence checks belong after target selection.
  const url = new URL(value, packageUrl);
  if (!url.pathname.startsWith(new URL(".", packageUrl).pathname))
    return invalidExportTarget(
      value,
      "escapes the package root after URL normalization",
      mapKind,
    );
  return {
    kind: "value",
    value,
    url,
    ...(metadataUrl.ok
      ? {}
      : {
          lookupLimitation: metadataUrl.error.limitation,
        }),
  };
};

const selectArrayPackageTarget = (
  value: readonly unknown[],
  conditions: ReadonlySet<string>,
  packagePath: string,
  mapKind: "exports" | "imports",
): ExportTargetOutcome => {
  if (value.length === 0) return { kind: "blocked", cause: "empty-array" };
  let lastRefusal:
    | Extract<ExportTargetOutcome, { readonly kind: "invalid" | "blocked" }>
    | undefined;
  const declared = new Set<string>();
  for (const entry of value) {
    const nested = selectExportTarget(entry, conditions, packagePath, mapKind);
    // Node's array fallback catches invalid targets, not invalid configuration.
    if (nested.kind === "invalid-config") return nested;
    if (nested.kind === "unmatched") {
      for (const condition of nested.declared) declared.add(condition);
      continue;
    }
    if (nested.kind === "invalid" || nested.kind === "blocked") {
      lastRefusal = nested;
      continue;
    }
    return nested;
  }
  return lastRefusal ?? { kind: "unmatched", declared: [...declared] };
};

/**
 * Resolve a target in Node's declared order. Explicit null blocks an active
 * condition, whereas an unmatched nested object permits the next condition.
 * An array skips unmatched and invalid entries, stops at its first string, and
 * preserves the last invalid/null outcome if no string is selected. A nonempty
 * array of unmatched conditions stays unmatched; an empty array blocks.
 */
const selectExportTarget = (
  value: unknown,
  conditions: ReadonlySet<string>,
  packagePath: string,
  mapKind: "exports" | "imports" = "exports",
): ExportTargetOutcome => {
  if (typeof value === "string")
    return selectStringPackageTarget(value, packagePath, mapKind);
  if (value === null) return { kind: "blocked", cause: "null" };
  if (Array.isArray(value))
    return selectArrayPackageTarget(value, conditions, packagePath, mapKind);
  if (typeof value !== "object")
    return invalidExportTarget(
      value,
      "must be a relative string, object, array, or null",
      mapKind,
    );
  for (const key of Object.keys(value)) {
    const numeric = Number(key);
    if (String(numeric) === key && numeric >= 0 && numeric < 0xffff_ffff)
      return {
        kind: "invalid-config",
        limitation: `The package exports configuration contains numeric condition key ${JSON.stringify(key)}.`,
      };
  }
  const declared = new Set<string>();
  for (const [condition, target] of Object.entries(value)) {
    declared.add(condition);
    if (!conditions.has(condition)) continue;
    const nested = selectExportTarget(target, conditions, packagePath, mapKind);
    if (nested.kind !== "unmatched") return nested;
    for (const name of nested.declared) declared.add(name);
  }
  return { kind: "unmatched", declared: [...declared] };
};

/**
 * Node selects an exports target by walking the declared keys in order and
 * taking the first whose condition is active for the calling resolver.
 * "default" is always active, and "node" plus "node-addons" are active for the
 * built-in resolver that owns installed-package imports and requires. The
 * supported Node runtimes also activate "module-sync" for both loaders.
 */
const packageExportConditions = (
  moduleKind: ResolveArtifactPathInput["moduleKind"],
): ReadonlySet<string> =>
  new Set([
    "node",
    "node-addons",
    "module-sync",
    ...(moduleKind === undefined ? [] : [moduleKind]),
    "default",
  ]);

const notFoundCandidate = (): Extract<
  CandidateResolution,
  { readonly resolvedPath: null }
> => ({
  resolvedPath: null,
  status: "not-found",
  limitations: [
    "No extension, directory package, or index candidate exists in the inventoried artifact container.",
  ],
});

const exactPackageTargetNotFound = (
  path: string,
  targetKind: "exports" | "imports" | "ESM subpath",
): CandidateResolution => ({
  resolvedPath: null,
  status: "not-found",
  limitations: [
    `The selected package ${targetKind === "imports" ? "import" : targetKind} target ${path} does not exist in the inventoried artifact container; ${targetKind === "imports" ? "import" : targetKind} targets are exact files, so no extension or directory index was tried.`,
  ],
});

const fileUrlPath = (value: string): string | null | undefined => {
  if (!/^file:\/\//iu.test(value)) return undefined;
  // URL parsing removes tabs and newlines and normalizes encoded dot segments.
  // Check the raw path first, excluding URL identity suffixes, then check the
  // parsed pathname so parser normalization cannot introduce a separator.
  const rawPath = stripQueryAndFragment(value);
  if (
    value.includes("\0") ||
    value.includes("\\") ||
    /[\t\n\r]/u.test(rawPath) ||
    !admitsCanonicalPathSyntax(rawPath)
  )
    return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "file:" || url.hostname !== "") return undefined;
    if (!admitsCanonicalPathSyntax(url.pathname)) return null;
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes("\0")) return null;
    return decoded.replace(/^\/+/, "");
  } catch (cause: unknown) {
    // Unparseable file URLs have no path to resolve.
    void cause;
    return undefined;
  }
};

const unresolvedCandidate = (
  status: UnresolvedArtifactPathStatus,
  limitations: readonly string[],
): CandidateResolution => ({ resolvedPath: null, status, limitations });
