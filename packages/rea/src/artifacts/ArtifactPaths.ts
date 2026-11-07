import { posix } from "node:path";

import { logicalPathNfc } from "../domain/artifactIdentity.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import {
  ArtifactReaderFailure,
  artifactFixedLimitFailure,
  type ArtifactEntry,
} from "./ArtifactReader.js";

const ABSOLUTE_DRIVE_PATH = /^[A-Za-z]:[\\/]/u;

// Bound diagnostic JSON expansion to 768 characters before formatting. This is
// a presentation budget, never a limit on accepted paths or retained facts.
const PATH_DIAGNOSTIC_CODE_UNITS = 128;
const pathDiagnostic = (path: string): string =>
  path.length <= PATH_DIAGNOSTIC_CODE_UNITS
    ? JSON.stringify(path)
    : `${JSON.stringify(path.slice(0, PATH_DIAGNOSTIC_CODE_UNITS))}… (${String(path.length)} UTF-16 code units)`;

type DestinationEntryKind = Exclude<ArtifactEntry["kind"], "metadata">;

/** Declarations have query identities, but never claim a destination path. */
export const hasDestinationPath = (
  kind: ArtifactEntry["kind"],
): kind is DestinationEntryKind => kind !== "metadata";

/**
 * English Unicode case folding used only to describe logical names a
 * case-insensitive destination might collapse. It is not a filesystem case table.
 */
const ENGLISH_UNICODE_CASE_NOTE =
  "This comparison is not a filesystem observation.";

/** Inventory limitation when logical names collide under English Unicode case folding. */
export const ENGLISH_UNICODE_CASE_INVENTORY_LIMITATION = `Logical archive names collide under English (en-US) Unicode case folding; a case-insensitive destination cannot store both spellings. ${ENGLISH_UNICODE_CASE_NOTE}`;

/** A rejected destination create whose directory listing identifies another spelling. */
export class DestinationCaseCollisionFailure extends ArtifactReaderFailure {
  constructor(
    readonly requestedPath: string,
    readonly existingPath: string,
    options?: ErrorOptions,
  ) {
    super(
      "path",
      `Destination filesystem cannot store both ${requestedPath} and ${existingPath}; inventory retains both logical names.`,
      options,
    );
    this.name = "DestinationCaseCollisionFailure";
  }
}

/** The destination rejected a name before a file or directory was acquired. */
export class DestinationPathUnrepresentableFailure extends ArtifactReaderFailure {
  constructor(
    readonly requestedPath: string,
    options: ErrorOptions,
  ) {
    super(
      "path",
      `Destination filesystem cannot represent ${pathDiagnostic(requestedPath)}.`,
      options,
    );
    this.name = "DestinationPathUnrepresentableFailure";
  }
}

/** Normalize slash-separated logical names; backslashes are literal components. */
export const normalizeArtifactPath = (input: string): string => {
  if (
    input.includes("\0") ||
    input.startsWith("/") ||
    ABSOLUTE_DRIVE_PATH.test(input)
  )
    throw new ArtifactReaderFailure(
      "path",
      `Artifact path is absolute or unsafe: ${pathDiagnostic(input)}`,
    );
  const normalized = logicalPathNfc(input).replace(/\/+$/u, "");
  const parts = normalized.split("/");
  if (
    normalized.length === 0 ||
    parts.some((part) => part === "" || part === "." || part === "..") ||
    posix.normalize(normalized) !== normalized
  )
    throw new ArtifactReaderFailure(
      "path",
      `Artifact path is not normalized: ${pathDiagnostic(input)}`,
    );
  return normalized;
};

/** Reject prefix collisions and optionally bound the allocated path tree. */
export class ArtifactPathRegistry {
  readonly #root: PathTrieNode = { kind: undefined, children: new Map() };
  #nodeCount = 0;

  constructor(
    private readonly budget?: {
      readonly maxParts: number;
      readonly maxNodes: number;
    },
  ) {}

  add(path: string, kind: ArtifactEntry["kind"]): void {
    if (!hasDestinationPath(kind)) return;
    this.#visit(path, kind);
  }

  /** Account for distinct prefixes without claiming file/directory validity. */
  reservePath(path: string): void {
    this.#visit(path);
  }

  #visit(path: string, kind?: DestinationEntryKind): void {
    const parts = path.split("/");
    if (this.budget !== undefined && parts.length > this.budget.maxParts)
      throw artifactFixedLimitFailure(
        "Artifact path depth",
        this.budget.maxParts,
        "path parts",
      );
    if (this.budget !== undefined) {
      let observed = this.#root;
      for (const [index, part] of parts.entries()) {
        const existing = observed.children.get(part);
        if (existing === undefined) {
          if (parts.length - index > this.budget.maxNodes - this.#nodeCount)
            throw artifactFixedLimitFailure(
              "Artifact path tree",
              this.budget.maxNodes,
              "path nodes",
            );
          break;
        }
        observed = existing;
      }
    }
    let node = this.#root;
    for (const [index, part] of parts.entries()) {
      if (
        kind !== undefined &&
        node.kind !== undefined &&
        node.kind !== "directory"
      )
        throw new ArtifactReaderFailure(
          "path",
          `Artifact prefix conflict: ${pathDiagnostic(path)}`,
        );
      let child = node.children.get(part);
      if (child === undefined) {
        child = { kind: undefined, children: new Map() };
        node.children.set(part, child);
        if (this.budget !== undefined) this.#nodeCount++;
      }
      node = child;
      if (kind !== undefined && index === parts.length - 1) {
        if (node.kind !== undefined && node.kind !== kind)
          throw new ArtifactReaderFailure(
            "path",
            `Artifact path collision: ${pathDiagnostic(path)}`,
          );
        if (kind !== "directory" && node.children.size > 0)
          throw new ArtifactReaderFailure(
            "path",
            `Artifact prefix conflict: ${pathDiagnostic(path)}`,
          );
      }
    }
    if (kind !== undefined) node.kind = kind;
  }
}

interface PathTrieNode {
  kind: DestinationEntryKind | undefined;
  readonly children: Map<string, PathTrieNode>;
}

interface CaseNode {
  readonly bySpelling: Map<string, CaseNode>;
  readonly spellingsByFold: Map<string, string[]>;
  readonly terminals: string[];
}

const emptyCaseNode = (): CaseNode => ({
  bySpelling: new Map(),
  spellingsByFold: new Map(),
  terminals: [],
});

const englishCaseFold = (part: string): string =>
  part.toLocaleLowerCase("en-US");

/**
 * Record English (en-US) Unicode case collisions on each affected occurrence.
 * Returns the inventory limitation when any logical names collide.
 */
export const annotateEnglishUnicodeCaseCollisions = (
  occurrences: readonly {
    readonly entry_kind: ArtifactEntry["kind"];
    readonly logical_path: string;
    limitations: string[];
  }[],
): string | undefined => {
  const destinations = occurrences.filter(({ entry_kind }) =>
    hasDestinationPath(entry_kind),
  );
  const collisions = englishUnicodeCaseCollisions(
    destinations.map(({ logical_path }) => logical_path),
  );
  if (collisions.size === 0) return undefined;
  for (const occurrence of destinations)
    for (const collision of collisions.get(occurrence.logical_path) ?? [])
      occurrence.limitations.push(
        caseCollisionLimitation(occurrence.logical_path, collision),
      );
  return ENGLISH_UNICODE_CASE_INVENTORY_LIMITATION;
};

/** One logical path segment whose spelling folds to another sibling's. */
interface CaseCollision {
  /** Logical path through the colliding segment. */
  readonly prefix: string;
  /** First other sibling spelling, as a logical path, in code-point order. */
  readonly other: string;
  /** Count of further sibling spellings, each its own occurrence. */
  readonly additional: number;
}

const caseCollisionLimitation = (
  path: string,
  { prefix, other, additional }: CaseCollision,
): string => {
  const others =
    additional === 0
      ? other
      : `${other} and ${String(additional)} other spelling${additional === 1 ? "" : "s"}`;
  const subject =
    prefix === path
      ? `Logical path ${path} collides`
      : `Logical path ${path} is under ${prefix}, which collides`;
  return `${subject} under English (en-US) Unicode case folding with ${others}; a case-insensitive destination cannot store both. ${ENGLISH_UNICODE_CASE_NOTE}`;
};

/**
 * Name the directory-listing spelling that differs from the requested segment
 * only by English (en-US) Unicode case. Exact matches are the same logical name.
 */
export const destinationCaseCollision = (
  requestedPath: string,
  existingNames: readonly string[],
  options?: ErrorOptions,
): DestinationCaseCollisionFailure | undefined => {
  const slash = requestedPath.lastIndexOf("/");
  const segment = slash < 0 ? requestedPath : requestedPath.slice(slash + 1);
  if (existingNames.includes(segment)) return undefined;
  const folded = englishCaseFold(segment);
  const existing = existingNames
    .filter((name) => englishCaseFold(name) === folded)
    .sort(compareUnicodeCodePoints)[0];
  if (existing === undefined) return undefined;
  const parent = slash < 0 ? "" : requestedPath.slice(0, slash + 1);
  return new DestinationCaseCollisionFailure(
    requestedPath,
    `${parent}${existing}`,
    options,
  );
};

const englishUnicodeCaseCollisions = (
  paths: readonly string[],
): ReadonlyMap<string, readonly CaseCollision[]> => {
  const root = emptyCaseNode();
  for (const path of paths) {
    if (path.length === 0 || path === ".") continue;
    let node = root;
    for (const part of path.split("/")) {
      let child = node.bySpelling.get(part);
      if (child === undefined) {
        const folded = englishCaseFold(part);
        const spellings = node.spellingsByFold.get(folded);
        if (spellings === undefined) node.spellingsByFold.set(folded, [part]);
        else spellings.push(part);
        child = emptyCaseNode();
        node.bySpelling.set(part, child);
      }
      node = child;
    }
    node.terminals.push(path);
  }
  // A collision is recorded once, at the segment where spellings diverge, and
  // shared down the subtree. Pairing every descendant of one spelling with
  // every descendant of another grew quadratically with the subtree sizes.
  // The walk is iterative because a ZIP name can hold more components than
  // the call stack allows.
  const collisions = new Map<string, readonly CaseCollision[]>();
  const pending: {
    readonly node: CaseNode;
    readonly prefix: string | undefined;
    readonly chain: CollisionChain | undefined;
  }[] = [{ node: root, prefix: undefined, chain: undefined }];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const { node, prefix, chain } = item;
    if (chain !== undefined)
      for (const path of node.terminals)
        collisions.set(path, collisionsAlong(chain));
    for (const spellings of node.spellingsByFold.values())
      spellings.sort(compareUnicodeCodePoints);
    for (const [spelling, child] of node.bySpelling) {
      const childPrefix =
        prefix === undefined ? spelling : `${prefix}/${spelling}`;
      const spellings =
        node.spellingsByFold.get(englishCaseFold(spelling)) ?? [];
      const other = spellings[0] === spelling ? spellings[1] : spellings[0];
      pending.push({
        node: child,
        prefix: childPrefix,
        chain:
          other === undefined
            ? chain
            : {
                collision: {
                  prefix: childPrefix,
                  other: prefix === undefined ? other : `${prefix}/${other}`,
                  additional: spellings.length - 2,
                },
                parent: chain,
              },
      });
    }
  }
  return collisions;
};

/** Collisions on one path, linked from the deepest segment to the root. */
interface CollisionChain {
  readonly collision: CaseCollision;
  readonly parent: CollisionChain | undefined;
}

const collisionsAlong = (chain: CollisionChain): CaseCollision[] => {
  const collisions: CaseCollision[] = [];
  let link: CollisionChain | undefined = chain;
  while (link !== undefined) {
    collisions.push(link.collision);
    link = link.parent;
  }
  return collisions.reverse();
};
