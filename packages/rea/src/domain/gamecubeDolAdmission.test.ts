import { describe, expect, it } from "vitest";

import { buildGamecubeDol } from "./gamecubeDol.fixture.js";
import { admitGamecubeDol } from "./gamecubeDolAdmission.js";
import { rawBinarySelectionError } from "./rawBinary.js";

describe("gamecube-dol admission", () => {
  it("admits a valid DOL as big-endian powerpc at the header entry", () => {
    const admitted = admitGamecubeDol({ bytes: buildGamecubeDol() });
    expect(admitted).toMatchObject({
      ok: true,
      value: {
        architecture: "powerpc",
        entryPoint: "0x80003100",
        entryPointSource: "dol-header",
        header: {
          sections: [
            {
              kind: "text",
              index: 0,
              fileOffset: 0x100,
              address: 0x8000_3100,
              size: 32,
            },
          ],
          bss: { address: 0, size: 0 },
          bssOverlaps: [],
          bssGaps: [],
          entryPoint: 0x8000_3100,
        },
      },
    });
  });

  it("accepts a caller entry that equals the header entry", () => {
    const admitted = admitGamecubeDol({
      bytes: buildGamecubeDol(),
      entryPoint: "0x80003100",
    });
    expect(admitted.ok).toBe(true);
  });

  it("rejects a caller entry that conflicts with the header entry", () => {
    const admitted = admitGamecubeDol({
      bytes: buildGamecubeDol(),
      entryPoint: "0x80003104",
    });
    expect(admitted).toMatchObject({
      ok: false,
      error: {
        constraint: "load_selection_rejected",
        reason: expect.stringContaining("conflicts with the DOL header entry"),
      },
    });
  });

  it("rejects a malformed caller entry as a selection error", () => {
    const admitted = admitGamecubeDol({
      bytes: buildGamecubeDol(),
      entryPoint: "80003100",
    });
    expect(admitted).toMatchObject({
      ok: false,
      error: { constraint: "load_selection_rejected" },
    });
  });

  it("rejects a file whose header fails parsing as a file-format error", () => {
    const admitted = admitGamecubeDol({ bytes: Buffer.alloc(0x80) });
    expect(admitted).toMatchObject({
      ok: false,
      error: {
        constraint: "file_format_rejected",
        reason: expect.stringContaining("gamecube-dol header rejected"),
      },
    });
  });

  it("rejects an entry outside every text section", () => {
    const admitted = admitGamecubeDol({
      bytes: buildGamecubeDol({ entryPoint: 0x8000_4000 }),
    });
    expect(admitted).toMatchObject({
      ok: false,
      error: {
        constraint: "file_format_rejected",
        reason: expect.stringContaining("outside every used text section"),
      },
    });
  });
});

describe("gamecube-dol selection pairing", () => {
  it("refuses a caller architecture because the header fixes powerpc", () => {
    expect(
      rawBinarySelectionError({
        format: "gamecube-dol",
        architecture: "x86",
      }),
    ).toContain("takes its architecture from the DOL header");
  });

  it("allows format=gamecube-dol with no architecture, with or without entry", () => {
    expect(rawBinarySelectionError({ format: "gamecube-dol" })).toBeUndefined();
    expect(
      rawBinarySelectionError({
        format: "gamecube-dol",
        entryPoint: "0x80003100",
      }),
    ).toBeUndefined();
  });

  it("keeps architecture and entry rejected without a format", () => {
    expect(rawBinarySelectionError({ architecture: "powerpc" })).toBe(
      "architecture and entry_point apply only with format=raw-binary",
    );
  });
});
