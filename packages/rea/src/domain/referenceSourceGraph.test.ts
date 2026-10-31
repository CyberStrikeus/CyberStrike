import { createHash } from "node:crypto";

import canonicalize from "canonicalize";
import { describe, expect, it } from "vitest";

import {
  createHistoricalSourceGraph,
  createHistoricalSourceManifest,
  historicalSourceGraphSchema,
  historicalSourceParseFailureKey,
  parseHistoricalSourceGraph,
  type HistoricalSourceGraphInput,
} from "./referenceSourceGraph.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
type Entry = HistoricalSourceGraphInput["entries"][number];
type DirectoryEntry = Extract<Entry, { kind: "directory" }>;
type FileEntry = Extract<Entry, { kind: "file" }>;
type HashedFileEntry = Extract<FileEntry, { content_state: "hashed" }>;
type UnavailableFileEntry = Exclude<FileEntry, HashedFileEntry>;
type SymlinkEntry = Extract<Entry, { kind: "symlink" }>;

const directoryEntry = (
  treeState: DirectoryEntry["tree_state"] = "enumerated",
): DirectoryEntry => ({
  path: "src",
  kind: "directory",
  classifications: ["source"],
  tree_state: treeState,
  limitations: [],
});

const fileEntry = (
  overrides: Partial<HashedFileEntry> = {},
): HashedFileEntry => ({
  path: "src/main.ts",
  kind: "file",
  sha256: HASH_B,
  size: 20,
  language: "TypeScript",
  classifications: ["source"],
  content_state: "hashed",
  limitations: [],
  ...overrides,
});

const unavailableFileEntry = (
  overrides: Partial<UnavailableFileEntry> = {},
): UnavailableFileEntry => ({
  path: "src/main.ts",
  kind: "file",
  sha256: null,
  size: null,
  language: "TypeScript",
  classifications: ["source"],
  content_state: "unreadable",
  limitations: ["Permission denied"],
  ...overrides,
});

type KnownTargetSymlinkEntry = Extract<SymlinkEntry, { target: string }>;

const symlinkEntry = (
  overrides: Partial<KnownTargetSymlinkEntry> = {},
): KnownTargetSymlinkEntry => ({
  path: "src/package.json",
  kind: "symlink",
  target: "main.ts",
  target_state: "internal",
  classifications: ["manifest"],
  limitations: [],
  ...overrides,
});

const graphInput = (): HistoricalSourceGraphInput => ({
  schema: "HistoricalSourceGraph",
  authority: "historical-reference",
  root_alias: "$REFERENCE_ROOT",
  inventory_state: "complete",
  entries: [directoryEntry(), fileEntry(), symlinkEntry()],
  relationships: [
    {
      from_path: "src/main.ts",
      to: "node:fs",
      kind: "imports",
      resolution: "external",
      parse_state: "parsed",
    },
    {
      from_path: "src/main.ts",
      to: "src",
      kind: "references",
      resolution: "internal",
      parse_state: "parsed",
    },
  ],
  parse_failures: [],
  exclusions: [],
  languages: ["TypeScript"],
  manifests: [],
  vcs: { kind: "git", head: HASH_A, dirty: false },
  provenance: { importer: "rea", importer_version: "1", caller: "test" },
  limitations: [],
});

const registerSourceCommitmentTests = (): void => {
  it("builds and verifies internal root and manifest commitments", () => {
    const graph = createHistoricalSourceGraph(graphInput());
    const first = createHistoricalSourceManifest(graph);
    const second = createHistoricalSourceManifest(structuredClone(graph));
    const graphJson = canonicalize(graph);
    if (graphJson === undefined) throw new TypeError("Unserializable graph");
    const expectedSemantic = {
      schema: "HistoricalSourceManifest",
      authority: "historical-reference",
      graph_sha256: createHash("sha256").update(graphJson).digest("hex"),
      root_sha256: graph.root_sha256,
      inventory_state: "complete",
      entry_count: 3,
      relationship_count: 2,
    };
    const semanticJson = canonicalize(expectedSemantic);
    if (semanticJson === undefined)
      throw new TypeError("Unserializable manifest semantics");

    expect(first).toEqual({
      ...expectedSemantic,
      manifest_id: `hsm_${createHash("sha256").update(semanticJson).digest("hex")}`,
    });
    expect(first).toEqual(second);
    expect(parseHistoricalSourceGraph(graph)).toEqual(graph);
    expect(() =>
      createHistoricalSourceGraph({
        ...graphInput(),
        entries: [
          directoryEntry(),
          { ...fileEntry(), content_state: "unreadable" },
          symlinkEntry(),
        ],
      }),
    ).toThrow();
  });

  it("rejects stale roots and commits file, directory, and symlink semantics", () => {
    const original = createHistoricalSourceGraph(graphInput());
    expect(() =>
      parseHistoricalSourceGraph({ ...original, root_sha256: HASH_A }),
    ).toThrow(/root commitment/u);

    for (const mutate of [
      (input: HistoricalSourceGraphInput) => {
        input.entries[0] = directoryEntry("partial");
        input.inventory_state = "partial";
      },
      (input: HistoricalSourceGraphInput) => {
        input.entries[1] = fileEntry({ sha256: "c".repeat(64) });
      },
      (input: HistoricalSourceGraphInput) => {
        input.entries[2] = symlinkEntry({
          target: "other.json",
          target_state: "missing",
        });
        input.inventory_state = "partial";
      },
      (input: HistoricalSourceGraphInput) => {
        input.exclusions = [
          {
            path: "private.env",
            reason: "configured-secret",
            pattern: ".env",
          },
        ];
        input.inventory_state = "partial";
      },
    ]) {
      const changed = graphInput();
      mutate(changed);
      expect(createHistoricalSourceGraph(changed).root_sha256).not.toBe(
        original.root_sha256,
      );
    }
  });

  it("commits the matched pattern for each exclusion", () => {
    const graphWith = (pattern: string) =>
      createHistoricalSourceGraph({
        ...graphInput(),
        inventory_state: "partial",
        exclusions: [
          { path: "private.env", reason: "configured-secret", pattern },
        ],
      });
    expect(graphWith(".env").root_sha256).not.toBe(
      graphWith("*.env").root_sha256,
    );
  });
};

describe("historical source graph", () => {
  it("validates supplementary paths and derived indexes by code point", () => {
    const paths = ["a", "aa", "\uE000", "\u{10000}"];
    const input: HistoricalSourceGraphInput = {
      ...graphInput(),
      entries: paths.map((path) =>
        fileEntry({
          path,
          language: path,
          classifications: ["manifest"],
        }),
      ),
      relationships: [],
      languages: paths,
      manifests: paths,
    };
    const graph = createHistoricalSourceGraph(input);
    expect(parseHistoricalSourceGraph(graph)).toEqual(graph);
    expect(() =>
      createHistoricalSourceGraph({
        ...input,
        entries: [...input.entries].sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
        ),
      }),
    ).toThrow(/Unicode code point/u);
  });

  it("omits absent local diagnostics and rejects explicitly undefined non-JSON metadata", () => {
    const input = graphInput();
    const graph = createHistoricalSourceGraph(input);
    expect(graph.entries.map((entry) => entry.path)).toEqual(
      input.entries.map((entry) => entry.path),
    );
    expect(
      graph.entries.every(
        (entry) => !Object.hasOwn(entry, "local_diagnostics"),
      ),
    ).toBe(true);
    expect(() =>
      createHistoricalSourceGraph({
        ...input,
        entries: input.entries.map((entry) => ({
          ...entry,
          local_diagnostics: undefined,
        })),
      }),
    ).toThrow();
  });

  registerSourceCommitmentTests();

  it("retains actual external targets and rejects placeholder targets", () => {
    const input = { ...graphInput(), inventory_state: "partial" as const };
    input.entries[2] = symlinkEntry({
      target: "/private/shared/target.js",
      target_state: "external",
    });
    const graph = createHistoricalSourceGraph(input);
    expect(graph.entries[2]).toMatchObject({
      kind: "symlink",
      target: "/private/shared/target.js",
      target_state: "external",
    });
    expect(() =>
      createHistoricalSourceGraph({
        ...input,
        entries: input.entries.map((entry) =>
          entry.kind === "symlink"
            ? { ...entry, target: "<outside-root>" }
            : entry,
        ),
      }),
    ).toThrow(/target path does not match/u);
  });

  it("derives language and manifest indexes and enforces code-point order", () => {
    const input = graphInput();
    input.entries[1] = fileEntry({ classifications: ["source", "test"] });
    expect(() =>
      createHistoricalSourceGraph({ ...input, languages: [] }),
    ).toThrow(/derived/u);
    expect(() =>
      createHistoricalSourceGraph({ ...input, manifests: ["src/main.ts"] }),
    ).toThrow(/derived/u);
    expect(() =>
      createHistoricalSourceGraph({
        ...input,
        entries: input.entries.toReversed(),
      }),
    ).toThrow(/Unicode code point/u);
    expect(() =>
      createHistoricalSourceGraph({
        ...input,
        entries: input.entries.map((entry) =>
          entry.path === "src/main.ts"
            ? { ...entry, classifications: ["test", "source"] }
            : entry,
        ),
      }),
    ).toThrow(/Unicode code point/u);
  });
});

const registerLocalDiagnosticCommitmentTests = (): void => {
  it("keeps unknown-entry diagnostics outside the root commitment", () => {
    const base = graphInput();
    base.inventory_state = "partial";
    base.entries[2] = {
      path: "src/package.json",
      kind: "unknown",
      classifications: ["unknown"],
      limitations: ["Permission denied at /private/first"],
    };
    const graph = createHistoricalSourceGraph(base);
    const changedMessage = structuredClone(base);
    changedMessage.entries[2] = {
      path: "src/package.json",
      kind: "unknown",
      classifications: ["unknown"],
      limitations: ["Permission denied at /private/second"],
    };
    const revised = createHistoricalSourceGraph(changedMessage);
    expect(revised.root_sha256).toBe(graph.root_sha256);
    expect(createHistoricalSourceManifest(revised).graph_sha256).not.toBe(
      createHistoricalSourceManifest(graph).graph_sha256,
    );
  });

  it("retains local diagnostics outside semantic commitments while committing operation failures", () => {
    const base = graphInput();
    base.inventory_state = "partial";
    base.entries[1] = unavailableFileEntry({
      limitations: [
        "File could not be read safely: EACCES. Check permissions.",
      ],
      local_diagnostics: [
        "EACCES: permission denied, open '/first/src/main.ts'",
      ],
    });
    const graph = createHistoricalSourceGraph(base);
    const moved = structuredClone(base);
    moved.entries[1]!.local_diagnostics = [
      "EACCES: permission denied, open '/second/src/main.ts'",
    ];
    const relocated = createHistoricalSourceGraph(moved);
    expect(createHistoricalSourceManifest(relocated)).toEqual(
      createHistoricalSourceManifest(graph),
    );
    expect(relocated.entries[1]!.local_diagnostics).toEqual(
      moved.entries[1]!.local_diagnostics,
    );
    moved.entries[1]!.limitations = [
      "File could not be read safely: EIO. Check permissions.",
    ];
    expect(
      createHistoricalSourceManifest(createHistoricalSourceGraph(moved))
        .graph_sha256,
    ).not.toBe(createHistoricalSourceManifest(graph).graph_sha256);
  });
};

describe("partial historical source graphs", () => {
  registerLocalDiagnosticCommitmentTests();

  it("keeps an unreadable symlink target unknown and out of root identity", () => {
    const base = graphInput();
    base.inventory_state = "partial";
    base.entries[2] = {
      path: "src/package.json",
      kind: "symlink",
      target: null,
      target_state: "unreadable",
      classifications: ["manifest"],
      limitations: ["Target could not be read."],
    };
    const graph = createHistoricalSourceGraph(base);
    expect(graph.entries[2]).toMatchObject({
      kind: "symlink",
      target: null,
      target_state: "unreadable",
    });

    const changedMessage = structuredClone(base);
    changedMessage.entries[2] = {
      path: "src/package.json",
      kind: "symlink",
      target: null,
      target_state: "unreadable",
      classifications: ["manifest"],
      limitations: ["A different diagnostic."],
    };
    const revised = createHistoricalSourceGraph(changedMessage);
    expect(revised.root_sha256).toBe(graph.root_sha256);
    expect(createHistoricalSourceManifest(revised).graph_sha256).not.toBe(
      createHistoricalSourceManifest(graph).graph_sha256,
    );
    expect(() =>
      createHistoricalSourceGraph({
        ...base,
        entries: base.entries.map((entry) =>
          entry.kind === "symlink"
            ? { ...entry, target: "<unreadable>" }
            : entry,
        ),
      }),
    ).toThrow();
  });

  it("preserves partial observations but rejects every partial complete graph", () => {
    const partial = graphInput();
    partial.inventory_state = "partial";
    partial.entries[1] = unavailableFileEntry();
    partial.parse_failures = [
      { path: "src/main.ts", parser: "typescript", reason: "Malformed input" },
    ];
    expect(createHistoricalSourceGraph(partial).inventory_state).toBe(
      "partial",
    );
    expect(
      createHistoricalSourceGraph({ ...partial, inventory_state: "unknown" })
        .inventory_state,
    ).toBe("unknown");

    for (const change of [
      { entries: partial.entries },
      { parse_failures: partial.parse_failures },
      {
        exclusions: [
          {
            path: "secret",
            reason: "configured-secret" as const,
            pattern: "secret",
          },
        ],
      },
      { limitations: ["Incomplete"] },
      {
        relationships: [
          {
            ...graphInput().relationships[0]!,
            parse_state: "partial" as const,
          },
        ],
      },
    ])
      expect(() =>
        createHistoricalSourceGraph({ ...graphInput(), ...change }),
      ).toThrow(/Complete inventory/u);
  });

  it("keeps distinct parse failure reasons for the same path and parser", () => {
    const input = graphInput();
    const malformed = {
      path: "src/main.ts",
      parser: "typescript",
      reason: "Malformed input",
    };
    const unexpected = {
      path: "src/main.ts",
      parser: "typescript",
      reason: "Unexpected token",
    };
    input.inventory_state = "partial";
    input.parse_failures = [malformed, unexpected];

    expect(createHistoricalSourceGraph(input).parse_failures).toEqual(
      input.parse_failures,
    );
    expect(historicalSourceParseFailureKey(malformed)).not.toBe(
      historicalSourceParseFailureKey(unexpected),
    );
  });
});

describe("historical source graph validation", () => {
  it("rejects strict unknown fields, invalid VCS, and dangling internal edges", () => {
    expect(() =>
      createHistoricalSourceGraph({ ...graphInput(), surprise: true }),
    ).toThrow();
    expect(() =>
      createHistoricalSourceGraph({
        ...graphInput(),
        vcs: { kind: "git", head: "main", dirty: false },
      }),
    ).toThrow();
    expect(() =>
      createHistoricalSourceGraph({
        ...graphInput(),
        relationships: [
          { ...graphInput().relationships[1]!, to: "missing.ts" },
        ],
      }),
    ).toThrow(/normalized and inventoried/u);
    expect(() =>
      createHistoricalSourceGraph({
        ...graphInput(),
        inventory_state: "partial",
        entries: graphInput().entries.map((entry) =>
          entry.kind === "symlink"
            ? { ...entry, target: "/etc/passwd", target_state: "external" }
            : entry,
        ),
      }),
    ).not.toThrow();
    expect(() =>
      createHistoricalSourceGraph({
        ...graphInput(),
        inventory_state: "partial",
        entries: graphInput().entries.map((entry) =>
          entry.kind === "symlink"
            ? {
                ...entry,
                target: "<outside-root>",
                target_state: "external",
              }
            : entry,
        ),
      }),
    ).toThrow(/target path does not match/u);
    expect(() =>
      createHistoricalSourceGraph({
        ...graphInput(),
        relationships: [
          { ...graphInput().relationships[1]!, to: "../escape.ts" },
        ],
      }),
    ).toThrow(/normalized and inventoried/u);
    expect(() =>
      historicalSourceGraphSchema.parse({
        ...createHistoricalSourceGraph(graphInput()),
        extra: true,
      }),
    ).toThrow();
  });
});

describe("historical source graph excluded symlink targets", () => {
  it("retains internal symlinks into excluded trees without accepting sibling prefixes", () => {
    const input = { ...graphInput(), inventory_state: "partial" as const };
    input.exclusions = [
      {
        path: "dist",
        entry_kind: "directory",
        reason: "caller-excluded",
        pattern: "dist/",
      },
    ];
    input.entries[2] = symlinkEntry({ target: "../dist/generated.js" });
    const graph = createHistoricalSourceGraph(input);
    expect(graph.entries[2]).toMatchObject({
      target: "../dist/generated.js",
      target_state: "internal",
    });

    input.entries[2] = symlinkEntry({ target: "../dist-old/generated.js" });
    expect(() => createHistoricalSourceGraph(input)).toThrow(
      /recorded exclusion/u,
    );
  });

  it("does not treat an excluded file or unknown-kind ancestor as a directory", () => {
    const input = { ...graphInput(), inventory_state: "partial" as const };
    input.exclusions = [
      {
        path: "secret.txt",
        entry_kind: "file",
        reason: "configured-secret",
        pattern: "secret.txt",
      },
    ];
    input.entries[2] = symlinkEntry({ target: "../secret.txt/child" });
    expect(() => createHistoricalSourceGraph(input)).toThrow(
      /recorded exclusion/u,
    );

    input.exclusions[0] = {
      path: "secret.txt",
      entry_kind: "unknown",
      reason: "configured-secret",
      pattern: "secret.txt",
    };
    expect(() => createHistoricalSourceGraph(input)).toThrow(
      /recorded exclusion/u,
    );

    input.exclusions[0] = {
      path: "secret.txt",
      reason: "configured-secret",
      pattern: "secret.txt",
    };
    expect(() => createHistoricalSourceGraph(input)).toThrow(
      /recorded exclusion/u,
    );
  });
});

describe("historical source graph symlink path identity", () => {
  it("joins internal symlink targets with the inventory NFC normalizer", () => {
    // "café" spelled NFC, as the inventory produces it, and the same
    // name spelled NFD, as a macOS readlink can report it.
    const nfcPath = "src/café.ts";
    const nfdTarget = "cafe\u0301.ts";
    expect(nfcPath).not.toBe(nfdTarget);

    const input = { ...graphInput(), inventory_state: "partial" as const };
    input.entries[1] = fileEntry({ path: nfcPath });
    input.entries[2] = symlinkEntry({
      path: "src/link.js",
      target: nfdTarget,
      target_state: "internal",
    });
    input.relationships = [];
    const graph = createHistoricalSourceGraph(input);
    expect(graph.entries[2]).toMatchObject({
      kind: "symlink",
      target: nfdTarget,
      target_state: "internal",
    });
  });

  it("preserves an exact NFD inventory spelling when resolving its symlink", () => {
    const input = { ...graphInput(), inventory_state: "partial" as const };
    input.entries[1] = fileEntry({ path: "src/cafe\u0301.ts" });
    input.entries[2] = symlinkEntry({
      path: "src/link.js",
      target: "cafe\u0301.ts",
      target_state: "internal",
    });
    input.relationships = [];
    expect(createHistoricalSourceGraph(input).entries[1]?.path).toBe(
      "src/cafe\u0301.ts",
    );
  });

  it("still rejects an internal symlink target that no inventory holds", () => {
    const input = { ...graphInput(), inventory_state: "partial" as const };
    input.entries[2] = symlinkEntry({
      path: "src/link.js",
      // The NFD spelling normalizes to "src/café.ts", which the
      // inventory does not contain, so the join must still miss.
      target: "cafe\u0301.ts",
      target_state: "internal",
    });
    expect(() => createHistoricalSourceGraph(input)).toThrow(
      /must resolve to an inventoried entry/u,
    );
  });
});

it.each([
  "\0",
  "/absolute.js",
  "../outside.js",
  "a/../b.js",
  "a//b.js",
  "./a.js",
  "a/",
])("rejects unsafe historical logical entry spelling %j", (path) => {
  const input = graphInput();
  input.entries = [fileEntry({ path })];
  input.relationships = [];
  expect(() => createHistoricalSourceGraph(input)).toThrow();
});

it("rejects NUL in observed symlink targets before graph identity", () => {
  const input = graphInput();
  input.entries[2] = symlinkEntry({ target: "literal\0name.js" });
  expect(() => createHistoricalSourceGraph(input)).toThrow(
    /normalized POSIX symlink target/u,
  );
});

it.each(["C:\\outside\\file.js", "\\\\server\\share.js"])(
  "preserves unowned recorded Windows absolute target policy %j",
  (target) => {
    const external = graphInput();
    external.inventory_state = "partial";
    external.entries[2] = symlinkEntry({ target, target_state: "external" });
    expect(createHistoricalSourceGraph(external).entries).toContainEqual(
      expect.objectContaining({ target, target_state: "external" }),
    );
    const internal = graphInput();
    internal.entries[2] = symlinkEntry({ target, target_state: "internal" });
    expect(() => createHistoricalSourceGraph(internal)).toThrow(
      /target path does not match its target state/u,
    );
  },
);

it("refuses an absolute POSIX internal target even when lexical joining would name an inventoried file", () => {
  const input = graphInput();
  input.entries[2] = symlinkEntry({
    target: "/main.ts",
    target_state: "internal",
  });
  expect(() => createHistoricalSourceGraph(input)).toThrow(
    /target path does not match its target state/u,
  );
});
