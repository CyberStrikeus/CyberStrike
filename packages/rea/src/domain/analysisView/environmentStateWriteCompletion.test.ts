import { expect, it, vi } from "vitest";
import * as paths from "./environmentStateRules.js";
import { prefixRelated } from "./environmentStateWriteRules.js";
import { CapturedWriteCompletion } from "./environmentStateWriteCompletion.js";

it("preserves the existing prefix relation, including non-transitive decoding and parameters", () => {
  const spellings = [
    "",
    "api",
    "a",
    "%61",
    "%2561",
    "%2F",
    "%252F",
    "{id}",
    "%ZZ",
  ];
  const candidates = [
    "/",
    ...spellings.flatMap((value) => [
      `/api/${value}`,
      `/api/${value}/child`,
      `/${value}/other`,
    ]),
  ];
  for (const write of candidates) {
    const completion = new CapturedWriteCompletion(() => {});
    completion.write(write, undefined);
    for (const read of candidates)
      expect(completion.runningAt(read, 100), `${write} -> ${read}`).toBe(
        prefixRelated(write, read),
      );
  }
});

it("retains unknown completion and isolates unrelated writes while aggregating known ends", () => {
  const completion = new CapturedWriteCompletion(() => {});
  completion.write("/api/books/1", 20);
  completion.write("/api/books/1", 30);
  completion.write("/api/books/2", undefined);
  completion.write("/api/books/2", 10);
  expect(completion.runningAt("/api/books/1", 29)).toBe(true);
  expect(completion.runningAt("/api/books/1", 30)).toBe(false);
  expect(completion.runningAt("/api/books/1", undefined)).toBe(true);
  expect(completion.runningAt("/api/books/2", 100)).toBe(true);
  expect(completion.runningAt("/api/books", 100)).toBe(true);
  expect(completion.runningAt("/api/authors", undefined)).toBe(false);
  completion.write("/", undefined);
  expect(completion.runningAt("/api/authors", 100)).toBe(true);
});

it("uses explicit record-order coordinates without treating absent writes as pending", () => {
  const completion = new CapturedWriteCompletion(() => {});
  expect(completion.runningAt("/api/books", undefined)).toBe(false);
  completion.write("/api/books", 1);
  expect(completion.runningAt("/api/books/1", 2)).toBe(false);
});

it("looks up a concrete path without reinterpreting every retained write path", () => {
  const completion = new CapturedWriteCompletion(() => {});
  for (let id = 0; id < 128; id += 1)
    completion.write(`/api/books/${String(id)}`, undefined);
  const decoded = vi.spyOn(paths, "decodedSegment");
  try {
    expect(completion.runningAt("/api/books/64", 100)).toBe(true);
    // Matching interprets only the three read segments; prior write segments were indexed once.
    expect(decoded).toHaveBeenCalledTimes(3);
  } finally {
    decoded.mockRestore();
  }
});

it("reserves retained prefix growth before publishing an unbudgeted edge", () => {
  const refused = new Error("state retained-memory budget exhausted");
  let remaining = Infinity;
  const completion = new CapturedWriteCompletion((bytes) => {
    if (bytes > remaining) throw refused;
    remaining -= bytes;
  });
  completion.write("/api/books/1", 10);
  remaining = 0;
  // Updating an indexed path retains no new keys or nodes.
  completion.write("/api/books/1", 20);
  expect(completion.runningAt("/api/books/1", 19)).toBe(true);
  expect(() => completion.write("/api/authors/1", undefined)).toThrow(refused);
  expect(completion.runningAt("/api/authors/1", 100)).toBe(false);
  expect(completion.runningAt("/api", 100)).toBe(false);
  expect(completion.runningAt("/", 100)).toBe(false);
  expect(completion.runningAt("/api/{collection}", 100)).toBe(false);
  expect(completion.runningAt("/api/books/1", 20)).toBe(false);
});

it("queries both interval boundaries across future writes in chronology order", () => {
  const completion = new CapturedWriteCompletion(() => {});
  completion.write("/api/books/1", 15, 10);
  completion.write("/api/books/1", undefined, 30);
  expect(completion.runningAt("/api/books/1", 5, 10)).toBe(false);
  expect(completion.runningAt("/api/books/1", 5, 11)).toBe(true);
  expect(completion.runningAt("/api/books/1", 15, 30)).toBe(false);
  expect(completion.runningAt("/api/books/1", 15, 31)).toBe(true);
  expect(completion.runningAt("/api/books/1", 15, undefined)).toBe(true);
  expect(completion.runningAt("/api/authors", 5, undefined)).toBe(false);
});

it("keeps a simultaneous unknown write ambiguous for a point read, unlike a known point write", () => {
  const completion = new CapturedWriteCompletion(() => {});
  completion.write("/api/books/1", undefined, 10);
  completion.write("/api/books/2", 10, 10);
  expect(completion.runningAt("/api/books/1", 10, 10)).toBe(true);
  expect(completion.runningAt("/api/books/2", 10, 10)).toBe(false);
  expect(completion.runningAt("/api/books/3", 10, 10)).toBe(false);
});
