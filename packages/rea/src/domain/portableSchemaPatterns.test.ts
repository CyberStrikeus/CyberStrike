import { describe, expect, it } from "vitest";

import { dylibResolutionInputSchema } from "./apple/dylibResolution.js";
import { processScenarioSchema } from "./process/processScenario.js";

// The look-ahead spellings these schemas advertised before; RE2 and Rust
// validators reject look-around, so the schemas now use equivalent complements.
const lookaheadRootRelativePath =
  /^(?!\/)(?!(?:.*\/)?\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*\/$)[^\\\u0000]+$/u;
const lookaheadEnvironmentName =
  /^(?!REA_PROCESS_RUN_ID(?![\s\S]))[^=\u0000]+$/u;

const strings = (alphabet: readonly string[], maxLength: number): string[] => {
  const all: string[] = [];
  let level = [""];
  for (let length = 1; length <= maxLength; length += 1) {
    level = level.flatMap((prefix) =>
      alphabet.map((character) => `${prefix}${character}`),
    );
    all.push(...level);
  }
  return all;
};

describe("look-around-free advertised patterns", () => {
  it("accepts exactly the previous normalized relative dylib roots", () => {
    const candidates = strings(["a", ".", "/", "\\", "\u0000"], 7);
    const mismatches = candidates.filter(
      (root) =>
        dylibResolutionInputSchema.safeParse({ roots: [root] }).success !==
        lookaheadRootRelativePath.test(root),
    );
    expect(candidates.length).toBeGreaterThan(90_000);
    expect(mismatches).toEqual([]);
  });

  it("accepts exactly the previous environment names around the reserved name", () => {
    const reserved = "REA_PROCESS_RUN_ID";
    const edits = ["", "R", "X", "_", "=", "\u0000", "é"];
    const candidates = new Set<string>(strings(["R", "E", "=", "x"], 5));
    for (let index = 0; index <= reserved.length; index += 1)
      for (const edit of edits) {
        const prefix = reserved.slice(0, index);
        candidates.add(`${prefix}${edit}`);
        candidates.add(`${prefix}${edit}${reserved.slice(index)}`);
        candidates.add(`${prefix}${edit}${reserved.slice(index + 1)}`);
        candidates.add(`${edit}${reserved.slice(index)}`);
      }
    const accepts = (name: string) =>
      processScenarioSchema.safeParse({
        executable: "/bin/true",
        environment: { [name]: "value" },
      }).success;
    const mismatches = [...candidates].filter(
      (name) => accepts(name) !== lookaheadEnvironmentName.test(name),
    );
    expect(accepts(reserved)).toBe(false);
    expect(accepts(`${reserved}_2`)).toBe(true);
    expect(accepts("REA_PROCESS_RUN")).toBe(true);
    expect(mismatches).toEqual([]);
  });

  it("keeps the reserved-name diagnostic", () => {
    const parsed = processScenarioSchema.safeParse({
      executable: "/bin/true",
      environment: { REA_PROCESS_RUN_ID: "value" },
    });
    // Record keys report their own issues nested under the invalid key.
    expect(parsed.error?.issues).toMatchObject([
      {
        code: "invalid_key",
        path: ["environment", "REA_PROCESS_RUN_ID"],
        issues: [
          { message: "REA_PROCESS_RUN_ID is reserved by the process adapter" },
        ],
      },
    ]);
  });
});
