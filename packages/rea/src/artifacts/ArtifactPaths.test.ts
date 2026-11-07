import { describe, expect, it } from "vitest";

import {
  ArtifactPathRegistry,
  destinationCaseCollision,
  DestinationCaseCollisionFailure,
  annotateEnglishUnicodeCaseCollisions,
  ENGLISH_UNICODE_CASE_INVENTORY_LIMITATION,
  normalizeArtifactPath,
} from "./ArtifactPaths.js";

const NOTE =
  "a case-insensitive destination cannot store both. This comparison is not a filesystem observation.";

it.each(["drive", "escaped", "normalization", "prefix", "collision"])(
  "bounds path failure diagnostics at the owning boundary: %s",
  (kind) => {
    const name = "x".repeat(1024 * 1024);
    const registry = new ArtifactPathRegistry();
    const fail = () => {
      if (kind === "drive") normalizeArtifactPath("C:/" + name);
      else if (kind === "escaped")
        normalizeArtifactPath("\0".repeat(name.length));
      else if (kind === "normalization")
        normalizeArtifactPath(name + "/../child");
      else {
        registry.add(name, "file");
        registry.add(kind === "prefix" ? name + "/child" : name, "directory");
      }
    };
    const failure = (() => {
      try {
        fail();
      } catch (cause: unknown) {
        return cause;
      }
      return undefined;
    })();
    expect(failure).toMatchObject({ reason: "path" });
    expect((failure as Error).message.length).toBeLessThan(1024);
  },
);

it.each(["a:b", "C:cache/file.txt", "a:"])(
  "preserves a literal POSIX colon name %s",
  (path) => {
    expect(normalizeArtifactPath(path)).toBe(path);
  },
);

const annotate = (paths: readonly string[]) => {
  const occurrences = paths.map((logical_path) => ({
    entry_kind: "file" as const,
    logical_path,
    limitations: [] as string[],
  }));
  const limitation = annotateEnglishUnicodeCaseCollisions(occurrences);
  return {
    limitation,
    byPath: new Map(
      occurrences.map(({ logical_path, limitations }) => [
        logical_path,
        limitations,
      ]),
    ),
  };
};

describe("English Unicode case collisions", () => {
  it("retains repeated same-kind entries while rejecting file-directory aliasing", () => {
    const registry = new ArtifactPathRegistry();
    registry.add("duplicate", "file");
    expect(() => registry.add("duplicate", "file")).not.toThrow();
    expect(() => registry.add("duplicate", "directory")).toThrow(
      "Artifact path collision",
    );
  });

  it("names the other spelling of a colliding file", () => {
    const { limitation, byPath } = annotate([".", "Main.js", "main.js", "x"]);
    expect(limitation).toBe(ENGLISH_UNICODE_CASE_INVENTORY_LIMITATION);
    expect(byPath.get("Main.js")).toEqual([
      `Logical path Main.js collides under English (en-US) Unicode case folding with main.js; ${NOTE}`,
    ]);
    expect(byPath.get("main.js")).toEqual([
      `Logical path main.js collides under English (en-US) Unicode case folding with Main.js; ${NOTE}`,
    ]);
    expect(byPath.get("x")).toEqual([]);
  });

  it("records a directory collision once at the diverging segment", () => {
    const { byPath } = annotate([
      "res/Foo",
      "res/Foo/a.txt",
      "res/foo",
      "res/foo/b.txt",
    ]);
    expect(byPath.get("res/Foo")).toEqual([
      `Logical path res/Foo collides under English (en-US) Unicode case folding with res/foo; ${NOTE}`,
    ]);
    expect(byPath.get("res/foo/b.txt")).toEqual([
      `Logical path res/foo/b.txt is under res/foo, which collides under English (en-US) Unicode case folding with res/Foo; ${NOTE}`,
    ]);
  });

  it("counts further spellings, each of which is its own occurrence", () => {
    const { byPath } = annotate(["A.txt", "a.txt", "a.TXT"]);
    expect(byPath.get("a.txt")).toEqual([
      `Logical path a.txt collides under English (en-US) Unicode case folding with A.txt and 1 other spelling; ${NOTE}`,
    ]);
  });

  it("retains every spelling in a high-cardinality folded sibling group", () => {
    const count = 8_192;
    const variants = caseVariants("abcdefghijklm", count);
    const { limitation, byPath } = annotate(variants);
    const ordered = [...variants].sort();
    const first = ordered[0];
    const second = ordered[1];
    const original = variants[0];
    if (first === undefined || second === undefined || original === undefined) {
      throw new Error("Expected at least two case variants");
    }
    expect(limitation).toBe(ENGLISH_UNICODE_CASE_INVENTORY_LIMITATION);
    expect(byPath.size).toBe(count);
    expect(byPath.get(first)).toEqual([
      `Logical path ${first} collides under English (en-US) Unicode case folding with ${second} and ${String(count - 2)} other spellings; ${NOTE}`,
    ]);
    expect(byPath.get(original)?.[0]).toContain(
      `with ${first} and ${String(count - 2)} other spellings;`,
    );
    expect(
      [...byPath.values()].every((limitations) => limitations.length === 1),
    ).toBe(true);
  });

  it("stays linear for large case-variant subtrees", () => {
    const count = 5_000;
    const paths = Array.from({ length: count }, (_, index) => [
      `Foo/a${String(index)}.txt`,
      `foo/b${String(index)}.txt`,
    ]).flat();
    const { byPath } = annotate(paths);
    for (const path of paths) {
      const limitations = byPath.get(path) ?? [];
      expect(limitations).toHaveLength(1);
      expect(limitations[0]?.length).toBeLessThan(300);
    }
  });

  it("walks names with more components than the call stack holds", () => {
    const deep = Array.from({ length: 30_000 }, () => "a").join("/");
    const { byPath } = annotate([deep, `${deep}/X`, `${deep}/x`]);
    expect(byPath.get(`${deep}/X`)).toHaveLength(1);
    expect(byPath.get(deep)).toEqual([]);
  });
});

const caseVariants = (lowercase: string, count: number): string[] =>
  Array.from({ length: count }, (_, mask) =>
    [...lowercase]
      .map((character, index) =>
        (mask & (1 << index)) === 0 ? character : character.toUpperCase(),
      )
      .join(""),
  );

it("retains both source spellings and the native failure in a destination collision", () => {
  const cause = Object.assign(new Error("exclusive create refused"), {
    code: "EEXIST",
  });
  const collision = destinationCaseCollision("res/café.js", ["CAFÉ.js"], {
    cause,
  });
  expect(collision).toBeInstanceOf(DestinationCaseCollisionFailure);
  expect(collision).toMatchObject({
    reason: "path",
    requestedPath: "res/café.js",
    existingPath: "res/CAFÉ.js",
  });
  expect(collision?.cause).toBe(cause);
});

it.each([["app.js"], ["app.js", "App.js"], ["other.js"]])(
  "does not invent a destination alias from listing %j",
  (...names) => {
    expect(destinationCaseCollision("res/app.js", names)).toBeUndefined();
  },
);

it("reserves prefix capacity atomically without declaring destination kinds", () => {
  const registry = new ArtifactPathRegistry({ maxParts: 4, maxNodes: 3 });
  registry.reservePath("a/b");
  expect(() => registry.reservePath("a/c/d")).toThrow();
  expect(() => registry.reservePath("z")).not.toThrow();
  expect(() => registry.reservePath("a/b")).not.toThrow();
  registry.add("a/b", "file");
  expect(() => registry.add("a/b", "directory")).toThrow();
});
