import { describe, expect, it } from "vitest";

import type { PointerFixups } from "./AppleMachoFixups.js";
import { parsePointerFixups } from "./AppleMachoFixups.js";
import type { MachoLayout } from "./AppleMachoSelection.js";
import { inspectObjcClassImportBindings } from "./AppleObjcClassImportBindings.js";

const createInput = (
  overrides: Partial<Parameters<typeof inspectObjcClassImportBindings>[0]> = {},
) => {
  const bytes = Buffer.alloc(16);
  const fixups: PointerFixups = {
    kind: "chained",
    formats: ["DYLD_CHAINED_PTR_64"],
    failures: [],
    issues: [],
    examined: 1,
    decoded: 1,
    legacyRebaseStreams: 0,
    legacyBindStreams: 0,
    unreadRebaseBytes: 0,
    hasUnresolvedLegacyBytes: () => false,
    decode: (address) =>
      address === 0x1000n
        ? {
            kind: "bind",
            symbol: "_OBJC_CLASS_$_Document",
            binding_source: "chained",
            library_ordinal: 1,
            library: "/System/Library/Frameworks/AppKit.framework/AppKit",
            weak: false,
            addend: 0n,
          }
        : address === 0x1008n
          ? {
              kind: "bind",
              symbol: "_free",
              binding_source: "chained",
              library_ordinal: 2,
              library: "/usr/lib/libSystem.B.dylib",
              weak: false,
              addend: 0n,
            }
          : { kind: "rebase", target: 0n },
  };
  const layout: MachoLayout = {
    segments: [],
    sections: [],
    selectedImage: {
      container: "thin",
      offset: 0,
      byteLength: bytes.length,
      cpuType: 0x0100000c,
      cpuSubtype: 0,
      containerTableSha256: null,
    },
    fixups: { chained: null, binds: [], rebases: [], dylibs: [] },
    baseAddress: 0n,
    offset: (address, size = 1) => {
      if (address === 0x1000n && size === 8) return 0;
      if (address === 0x1008n && size === 8) return 8;
      throw new RangeError("address is outside fixture");
    },
  };
  return {
    bytes,
    layout,
    fixups,
    addresses: ["0x1000", "0x1008"],
    addressesComplete: true,
    maxRecords: 100,
    ...overrides,
  };
};

describe("Objective-C import binding address inspection", () => {
  it("retains only exact class-symbol binds for the requested slot addresses", () => {
    expect(inspectObjcClassImportBindings(createInput())).toEqual({
      bindings: [
        {
          requested_address: "0x1000",
          symbol: "_OBJC_CLASS_$_Document",
          binding_source: "chained",
          library_ordinal: 1,
          library: "/System/Library/Frameworks/AppKit.framework/AppKit",
          weak: false,
          addend: "0",
        },
      ],
      coverage: {
        status: "complete",
        reason: null,
        examined: 2,
        decoded: 1,
      },
    });
  });

  it("keeps exact binds while marking malformed or unresolved addresses partial", () => {
    expect(
      inspectObjcClassImportBindings(
        createInput({ addresses: ["0x1000", "not-an-address", "0x2000"] }),
      ),
    ).toMatchObject({
      bindings: [{ requested_address: "0x1000" }],
      coverage: {
        status: "partial",
        examined: 3,
        decoded: 1,
        reason: expect.stringContaining("not a 64-bit hexadecimal address"),
      },
    });
  });

  it("keeps an invalid raw ordinal unsupported instead of treating it as an absent bind", () => {
    const input = createInput();
    expect(
      inspectObjcClassImportBindings({
        ...input,
        addresses: ["0x1000"],
        fixups: {
          ...input.fixups,
          decode: () => ({
            kind: "unsupported",
            reason: "Dylib ordinal 4 exceeds the 3 declared dependencies",
          }),
        },
      }),
    ).toEqual({
      bindings: [],
      coverage: {
        status: "partial",
        reason: "0x1000: Dylib ordinal 4 exceeds the 3 declared dependencies",
        examined: 1,
        decoded: 0,
      },
    });
  });

  it("marks selected slots partial when legacy rebase ownership is unknown", () => {
    const input = createInput();
    const streams = Buffer.from([0x20, 0x80, 0]); // Truncated rebase operand; valid bind DONE.
    const fixups = parsePointerFixups(
      streams,
      {
        chained: null,
        binds: [{ offset: 2, size: 1, stream: "bind" }],
        rebases: [{ offset: 0, size: 2 }],
        dylibs: [],
      },
      [{ address: 0x1000n, size: 0x1000n, offset: 0, executable: false }],
      0n,
    );
    expect(
      inspectObjcClassImportBindings({
        ...input,
        addresses: ["0x1000"],
        fixups,
      }),
    ).toMatchObject({
      bindings: [],
      coverage: {
        status: "partial",
        reason: expect.stringContaining(
          "LC_DYLD_INFO pointer-fixup applicability was not completely decoded",
        ),
        examined: 1,
        decoded: 0,
      },
    });
  });

  it("does not infer absent imports from unsupported fixup coverage", () => {
    const input = createInput({
      fixups: { ...createInput().fixups, kind: "none" },
      addresses: ["0x1000"],
    });
    expect(inspectObjcClassImportBindings(input)).toMatchObject({
      bindings: [],
      coverage: {
        status: "unsupported",
        reason: expect.stringContaining("no supported pointer fixup commands"),
      },
    });
  });

  it("preserves partial facts when the existing record budget truncates candidates", () => {
    expect(
      inspectObjcClassImportBindings(
        createInput({
          addresses: ["0x1000", "0x1008"],
          maxRecords: 1,
        }),
      ),
    ).toMatchObject({
      bindings: [{ requested_address: "0x1000" }],
      coverage: {
        status: "partial",
        examined: 1,
        decoded: 1,
        reason: expect.stringContaining("max_records limit"),
      },
    });
  });

  it("keeps an explicitly truncated empty candidate scan partial", () => {
    expect(
      inspectObjcClassImportBindings(
        createInput({ addresses: [], addressesComplete: false }),
      ),
    ).toMatchObject({
      bindings: [],
      coverage: {
        status: "partial",
        examined: 0,
        decoded: 0,
        reason: expect.stringContaining("max_records limit"),
      },
    });
    expect(
      inspectObjcClassImportBindings(
        createInput({ addresses: [], addressesComplete: true }),
      ).coverage,
    ).toMatchObject({ status: "not_requested", reason: null, examined: 0 });
  });
});
