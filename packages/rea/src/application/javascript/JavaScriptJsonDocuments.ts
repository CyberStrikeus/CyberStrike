import { compareUnicodeCodePoints } from "../../domain/unicodeCodePointOrder.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";

interface JavaScriptJsonDocumentSource {
  readonly path: string;
  readonly container_sha256: string;
  readonly sha256: string;
}

interface JavaScriptJsonDocumentFactBase {
  readonly source: JavaScriptJsonDocumentSource;
  readonly topLevelKeys: readonly string[];
}

export type JavaScriptJsonDocumentFacts =
  | (JavaScriptJsonDocumentFactBase & {
      readonly status: "included";
      readonly nextDependency: "declared" | "unproven";
      readonly packageFields: Readonly<
        Partial<Record<(typeof PACKAGE_PROPERTIES)[number], unknown>>
      > | null;
    })
  | (JavaScriptJsonDocumentFactBase & {
      readonly status: "invalid";
      readonly packageFields: null;
      readonly syntaxError: SyntaxError;
    })
  | (JavaScriptJsonDocumentFactBase & {
      readonly status: "unavailable";
      readonly packageFields: null;
      readonly reason:
        | "not-applicable"
        | "invalid-utf8"
        | "outside-analysis-scope";
    });

interface SourceSnapshot {
  readonly source: JavaScriptJsonDocumentSource;
  readonly kind: JavaScriptArtifactFile["kind"];
  readonly text: JavaScriptArtifactFile["text"];
}

interface CachedFacts {
  readonly snapshot: SourceSnapshot;
  readonly facts: JavaScriptJsonDocumentFacts;
}

const PACKAGE_PROPERTIES = [
  "name",
  "version",
  "main",
  "module",
  "renderer",
  "browser",
  "exports",
  "imports",
] as const;

/**
 * Lazy JSON facts shared by one analysis and its graph projection. Entries follow
 * the admitted source files' lifetime; changed identity, format or text replaces them.
 */
export class JavaScriptJsonDocuments {
  readonly #byFile = new Map<JavaScriptArtifactFile, CachedFacts>();

  read(file: JavaScriptArtifactFile): JavaScriptJsonDocumentFacts {
    const cached = this.#byFile.get(file);
    if (cached !== undefined && sameSnapshot(cached.snapshot, file))
      return cached.facts;

    const snapshot = sourceSnapshot(file);
    const facts = parseDocument(snapshot);
    this.#byFile.set(file, { snapshot, facts });
    return facts;
  }
}

const sourceSnapshot = (file: JavaScriptArtifactFile): SourceSnapshot => ({
  source: Object.freeze({
    path: file.path,
    container_sha256: file.container_sha256,
    sha256: file.sha256,
  }),
  kind: file.kind,
  text: { ...file.text },
});

const sameSnapshot = (
  left: SourceSnapshot,
  right: JavaScriptArtifactFile,
): boolean =>
  left.source.path === right.path &&
  left.source.container_sha256 === right.container_sha256 &&
  left.source.sha256 === right.sha256 &&
  left.kind === right.kind &&
  left.text.included === right.text.included &&
  (left.text.included
    ? right.text.included && left.text.value === right.text.value
    : !right.text.included && left.text.reason === right.text.reason);

const parseDocument = (
  snapshot: SourceSnapshot,
): JavaScriptJsonDocumentFacts => {
  if (!snapshot.text.included)
    return Object.freeze({
      source: snapshot.source,
      status: "unavailable",
      packageFields: null,
      topLevelKeys: Object.freeze([]),
      reason: snapshot.text.reason,
    });

  let root: unknown;
  try {
    root = JSON.parse(snapshot.text.value);
  } catch (cause: unknown) {
    if (!(cause instanceof SyntaxError)) throw cause;
    return Object.freeze({
      source: snapshot.source,
      status: "invalid",
      packageFields: null,
      topLevelKeys: Object.freeze([]),
      syntaxError: cause,
    });
  }

  if (typeof root !== "object" || root === null || Array.isArray(root))
    return Object.freeze({
      source: snapshot.source,
      status: "included",
      nextDependency: "unproven",
      packageFields: null,
      topLevelKeys: Object.freeze([]),
    });

  const record = root as Record<string, unknown>;
  const topLevelKeys = Object.freeze(
    Object.keys(record).sort(compareUnicodeCodePoints),
  );
  // Absent source fields must stay absent when consumers read named properties.
  const packageFields: Partial<
    Record<(typeof PACKAGE_PROPERTIES)[number], unknown>
  > | null = snapshot.kind === "package-json" ? Object.create(null) : null;
  if (packageFields !== null) {
    for (const key of PACKAGE_PROPERTIES)
      if (Object.hasOwn(record, key))
        packageFields[key] = Reflect.get(record, key);
    Object.freeze(packageFields);
  }
  const nextDeclared =
    snapshot.kind === "package-json" &&
    ["dependencies", "devDependencies", "peerDependencies"].some((key) => {
      const dependencies: unknown = record[key];
      if (
        typeof dependencies !== "object" ||
        dependencies === null ||
        Array.isArray(dependencies) ||
        !Object.hasOwn(dependencies, "next")
      )
        return false;
      const version: unknown = Reflect.get(dependencies, "next");
      return typeof version === "string" && version.length > 0;
    });
  return Object.freeze({
    source: snapshot.source,
    status: "included",
    nextDependency: nextDeclared ? "declared" : "unproven",
    packageFields,
    topLevelKeys,
  });
};
