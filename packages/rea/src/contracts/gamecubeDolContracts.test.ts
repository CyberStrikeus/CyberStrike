import { describe, expect, it } from "vitest";

import { sessionOutputSchemas } from "./toolOutputSchemaGroups.js";
import { openBinaryInputSchema } from "./sessionLifecycleInputs.js";

const base = { path: "/tmp/game.dol" };

describe("open_binary gamecube-dol input contract", () => {
  it("accepts format=gamecube-dol with no architecture", () => {
    expect(
      openBinaryInputSchema.safeParse({ ...base, format: "gamecube-dol" })
        .success,
    ).toBe(true);
  });

  it("accepts format=gamecube-dol with a matching entry syntax", () => {
    expect(
      openBinaryInputSchema.safeParse({
        ...base,
        format: "gamecube-dol",
        entry_point: "0x80003100",
      }).success,
    ).toBe(true);
  });

  it("rejects a caller architecture with format=gamecube-dol", () => {
    const parsed = openBinaryInputSchema.safeParse({
      ...base,
      format: "gamecube-dol",
      architecture: "x86",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues[0]?.message).toContain(
        "takes its architecture from the DOL header",
      );
  });

  it("rejects an entry_point without a format", () => {
    expect(
      openBinaryInputSchema.safeParse({
        ...base,
        entry_point: "0x80003100",
      }).success,
    ).toBe(false);
  });
});

describe("gamecube-dol output contract", () => {
  it("validates the open_binary DOL lifecycle result", () => {
    const schema = sessionOutputSchemas.open_binary;
    const sha256 = "a".repeat(64);
    expect(
      schema.safeParse({
        result: {
          path: "/tmp/game.dol",
          kind: "executable",
          format: "gamecube-dol",
          sha256,
          architecture: "powerpc",
          entry_point: "0x80003100",
        },
      }).success,
    ).toBe(true);
  });

  it("does not let the detected-format branch carry gamecube-dol", () => {
    const schema = sessionOutputSchemas.open_binary;
    expect(
      schema.safeParse({
        result: {
          path: "/tmp/game.dol",
          kind: "executable",
          format: "gamecube-dol",
          sha256: "a".repeat(64),
          architecture: "powerpc",
        },
      }).success,
    ).toBe(false);
  });
});
