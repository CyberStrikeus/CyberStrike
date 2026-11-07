import { describe, expect, it } from "vitest";

import { formatSelectionOption } from "../../../src/cli/options.js";

describe("gamecube-dol CLI option", () => {
  it("accepts gamecube-dol as the --target-format selection", () => {
    expect(formatSelectionOption.safeParse("gamecube-dol").success).toBe(true);
  });

  it("rejects an unknown format name", () => {
    expect(formatSelectionOption.safeParse("gamecube").success).toBe(false);
  });
});
