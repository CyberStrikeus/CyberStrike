import { describe, expect, it } from "vitest";

import { attestGhidraRawBinaryLoadImage } from "./GhidraLoadImageValues.js";
import { fixtureRawBinaryLoadImage } from "./GhidraRawBinaryLoadImage.fixture.js";
import { ghidraRawBinaryLanguage } from "./GhidraRawBinaryLanguage.js";

describe("raw-binary Ghidra language binding", () => {
  it("maps the big-endian m68k family to the default 68000 language", () => {
    expect(ghidraRawBinaryLanguage("m68k")).toEqual({
      languageId: "68000:BE:32:default",
      compilerSpecId: "default",
      defaultAddressSpace: "ram",
    });
  });
  it("maps the four admitted families to little-endian generic languages", () => {
    expect(ghidraRawBinaryLanguage("x86")).toEqual({
      languageId: "x86:LE:32:default",
      compilerSpecId: "gcc",
      defaultAddressSpace: "ram",
    });
    expect(ghidraRawBinaryLanguage("x86_64")).toEqual({
      languageId: "x86:LE:64:default",
      compilerSpecId: "gcc",
      defaultAddressSpace: "ram",
    });
    expect(ghidraRawBinaryLanguage("arm")).toEqual({
      languageId: "ARM:LE:32:v7",
      compilerSpecId: "default",
      defaultAddressSpace: "ram",
    });
    expect(ghidraRawBinaryLanguage("arm64")).toEqual({
      languageId: "AARCH64:LE:64:v8A",
      compilerSpecId: "default",
      defaultAddressSpace: "ram",
    });
  });
});

describe("raw-binary mapped-block state", () => {
  it.each(["RAM", "ram"])(
    "requires the bound 6502 address space for %s observations",
    (space) => {
      const f = fixtureRawBinaryLoadImage();
      const target = {
        ...f.target,
        architecture: "6502" as const,
        availableArchitectures: ["6502" as const],
        entryPoint: "0x8001",
        entryPointSource: "0x8001",
      };
      f.observation.language_id = "6502:LE:16:default";
      f.observation.default_address_space = space;
      f.observation.entry_points = [target.entryPoint];
      const mapping = f.observation.mappings[0];
      if (mapping === undefined)
        throw new Error("Missing source mapping fixture");
      mapping.start = target.entryPoint;
      mapping.end = "0x8004";
      mapping.address_space = space;
      expect(
        attestGhidraRawBinaryLoadImage(f.snapshot, target, f.observation),
      ).toMatchObject({
        ok: true,
        value: {
          status: space === "RAM" ? "verified" : "mismatch",
          checks: expect.arrayContaining([
            expect.objectContaining({
              name: "default_address_space",
              expected: "RAM",
              observed: space,
              matched: space === "RAM",
            }),
          ]),
        },
      });
    },
  );
  it.each(["ram", "RAM"])(
    "requires the bound m68k address space for %s observations",
    (space) => {
      const f = fixtureRawBinaryLoadImage();
      const target = {
        ...f.target,
        architecture: "m68k" as const,
        availableArchitectures: ["m68k" as const],
        entryPoint: "0x1000",
        entryPointSource: "0x1000",
      };
      f.observation.language_id = "68000:BE:32:default";
      f.observation.default_address_space = space;
      f.observation.entry_points = [target.entryPoint];
      const mapping = f.observation.mappings[0];
      if (mapping === undefined)
        throw new Error("Missing source mapping fixture");
      mapping.start = target.entryPoint;
      mapping.end = "0x1003";
      mapping.address_space = space;
      expect(
        attestGhidraRawBinaryLoadImage(f.snapshot, target, f.observation),
      ).toMatchObject({
        ok: true,
        value: {
          status: space === "ram" ? "verified" : "mismatch",
          language_id: "68000:BE:32:default",
          checks: expect.arrayContaining([
            expect.objectContaining({
              name: "default_address_space",
              expected: "ram",
              observed: space,
              matched: space === "ram",
            }),
          ]),
        },
      });
    },
  );
  it.each([
    ["initialized", false],
    ["loaded", false],
    ["overlay", true],
    ["address_space", "overlay"],
  ] as const)(
    "retains a mismatch when the file mapping declares %s=%s",
    (property, value) => {
      const f = fixtureRawBinaryLoadImage();
      const mapping = f.observation.mappings[0];
      if (mapping === undefined)
        throw new Error("Missing source mapping fixture");
      Object.assign(mapping, { [property]: value });
      expect(
        attestGhidraRawBinaryLoadImage(f.snapshot, f.target, f.observation),
      ).toMatchObject({
        ok: true,
        value: {
          status: "mismatch",
          observations: f.observation,
          checks: expect.arrayContaining([
            expect.objectContaining({
              name: `mapping.${property}`,
              matched: false,
              observed: value,
            }),
          ]),
        },
      });
    },
  );
  it("does not verify a foreign default address space even when its mapping agrees", () => {
    const f = fixtureRawBinaryLoadImage();
    f.observation.default_address_space = "foreign";
    const mapping = f.observation.mappings[0];
    if (mapping === undefined)
      throw new Error("Missing source mapping fixture");
    mapping.address_space = "foreign";
    expect(
      attestGhidraRawBinaryLoadImage(f.snapshot, f.target, f.observation),
    ).toMatchObject({
      ok: true,
      value: {
        status: "mismatch",
        observations: f.observation,
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: "default_address_space",
            matched: false,
            observed: "foreign",
          }),
        ]),
      },
    });
  });
});

describe("raw-binary independent load-image checks", () => {
  it("retains uninitialized language memory without treating it as file-backed bytes", () => {
    const f = fixtureRawBinaryLoadImage();
    const zeroPage = {
      block: "ZERO_PAGE",
      start: "0x0",
      end: "0xff",
      address_space: "ram",
      initialized: false,
      loaded: true,
      overlay: false,
      readable: true,
      writable: true,
      executable: false,
      length: 256,
      source_file_index: null,
      file_offset: null,
      sha256: null,
    };
    f.observation.mappings.unshift(zeroPage);
    expect(
      attestGhidraRawBinaryLoadImage(f.snapshot, f.target, f.observation),
    ).toMatchObject({
      ok: true,
      value: { status: "verified", observations: f.observation },
    });
    zeroPage.initialized = true;
    expect(
      attestGhidraRawBinaryLoadImage(f.snapshot, f.target, f.observation),
    ).toMatchObject({
      ok: true,
      value: {
        status: "mismatch",
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: "initialized_unbacked_mappings",
            matched: false,
          }),
        ]),
      },
    });
  });
  it("verifies mapped bytes at the caller-supplied entry", () => {
    const f = fixtureRawBinaryLoadImage();
    const result = attestGhidraRawBinaryLoadImage(
      f.snapshot,
      f.target,
      f.observation,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "verified",
        format: "raw-binary",
        architecture: "arm",
        language_id: "ARM:LE:32:v7",
        base_address: "0x8000000",
        file_bytes: 4,
        entry: { address: "0x8000000", file_offset: 0 },
      },
    });
  });
  it("retains mismatch evidence for a drifted language", () => {
    const f = fixtureRawBinaryLoadImage();
    f.observation.language_id = "x86:LE:32:default";
    const result = attestGhidraRawBinaryLoadImage(
      f.snapshot,
      f.target,
      f.observation,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { status: "mismatch", observations: f.observation },
    });
  });
  it("preserves additional language entries while requiring the caller entry", () => {
    const f = fixtureRawBinaryLoadImage();
    f.observation.entry_points = ["0x0", f.target.entryPoint, "0xffff0000"];
    expect(
      attestGhidraRawBinaryLoadImage(f.snapshot, f.target, f.observation),
    ).toMatchObject({
      ok: true,
      value: { status: "verified", observations: f.observation },
    });
    f.observation.entry_points = ["0x0", "0xffff0000"];
    expect(
      attestGhidraRawBinaryLoadImage(f.snapshot, f.target, f.observation),
    ).toMatchObject({
      ok: true,
      value: {
        status: "mismatch",
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: "entry_point",
            matched: false,
            observed: null,
          }),
        ]),
      },
    });
  });
  it("rejects stale snapshot identity", () => {
    const f = fixtureRawBinaryLoadImage();
    expect(
      attestGhidraRawBinaryLoadImage(
        f.snapshot,
        { ...f.target, sha256: "f".repeat(64) },
        f.observation,
      ).ok,
    ).toBe(false);
  });
});
