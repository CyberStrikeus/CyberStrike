import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseBinaryTarget } from "../application/BinaryTargetResolver.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { buildGamecubeDol } from "../domain/gamecubeDol.fixture.js";
import type { DolHeader } from "../domain/gamecubeDol.js";
import type {
  NativeLoadImageObservation,
  NativeLoadImage,
} from "../domain/native/nativeLoadImage.js";
import { attestGhidraDolLoadImage } from "./GhidraDolLoadImage.js";
import type { Result } from "../domain/result.js";

type DolTarget = Extract<BinaryTarget, { format: "gamecube-dol" }>;
type DolImage = Extract<NativeLoadImage, { format: "gamecube-dol" }>;

/** Unwrap a successful DOL attestation; the union also admits other formats. */
const attestedDol = (result: Result<NativeLoadImage, string>): DolImage => {
  if (!result.ok) throw new Error(result.error);
  if (result.value.status === "unsupported")
    throw new Error(result.value.reason);
  if (result.value.format !== "gamecube-dol")
    throw new Error("Expected a gamecube-dol attestation");
  return result.value;
};

const sha = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
const hex = (value: number): string => `0x${value.toString(16)}`;

/** The digest snapshot the Ghidra client streams for these exact bytes. */
const snapshotOf = (bytes: Buffer, target: DolTarget) => ({
  sha256: sha(bytes),
  bytes: bytes.length,
  sectionSha256: target.dol.sections.map((section) =>
    sha(bytes.subarray(section.fileOffset, section.fileOffset + section.size)),
  ),
});

// Data at 0x80010000 (16 bytes) with BSS 0x8000fff8..0x80010018: the BSS
// overlaps the data, so only the two 8-byte edges are uninitialized gaps.
const DATA_ADDRESS = 0x8001_0000;
const BSS_ADDRESS = 0x8000_fff8;
const BSS_SIZE = 0x20;
const EXPECTED_GAPS = [
  { start: "0x8000fff8", end: "0x8000ffff", length: 8 },
  { start: "0x80010010", end: "0x80010017", length: 8 },
];

const overlappingDol = (): Buffer =>
  buildGamecubeDol({
    data: { address: DATA_ADDRESS, bytes: Buffer.alloc(16, 0x11) },
    bss: { address: BSS_ADDRESS, size: BSS_SIZE },
  });

const dolTarget = async (bytes: Buffer): Promise<DolTarget> => {
  const directory = await createTestTempDirectory("rea-dol-attest-");
  await writeFile(join(directory, "game.dol"), bytes);
  const parsed = await parseBinaryTarget("game.dol", {
    cwd: directory,
    formatHint: "gamecube-dol",
  });
  if (!parsed.ok) throw parsed.error;
  if (parsed.value.format !== "gamecube-dol")
    throw new Error("Expected a gamecube-dol target");
  return parsed.value;
};

/** Observations Ghidra would report for a correct import of `bytes`. */
const observationsFor = (
  bytes: Buffer,
  dol: DolHeader,
  language: { readonly id: string; readonly cspec: string } = {
    id: "PowerPC:BE:32:default",
    cspec: "default",
  },
): NativeLoadImageObservation => ({
  executable_format: "Raw Binary",
  language_id: language.id,
  compiler_spec_id: language.cspec,
  image_base: "0x0",
  default_address_space: "ram",
  source_files: [
    {
      name: "game.dol",
      size: bytes.length,
      original_sha256: sha(bytes),
      modified_sha256: sha(bytes),
    },
  ],
  mappings: [
    ...dol.sections.map((section) => ({
      block: `.${section.kind}${section.index}`,
      start: hex(section.address),
      end: hex(section.address + section.size - 1),
      address_space: "ram",
      initialized: true,
      loaded: true,
      overlay: false,
      length: section.size,
      source_file_index: 0,
      file_offset: section.fileOffset,
      sha256: sha(
        bytes.subarray(section.fileOffset, section.fileOffset + section.size),
      ),
      ...(section.kind === "text" ? TEXT_PERM : DATA_PERM),
    })),
    ...EXPECTED_GAPS.map((gap) => ({
      block: "bss",
      start: gap.start,
      end: gap.end,
      address_space: "ram",
      initialized: false,
      loaded: true,
      overlay: false,
      length: gap.length,
      source_file_index: null,
      file_offset: null,
      sha256: null,
      ...DATA_PERM,
    })),
  ],
  relocations: [],
  entry_points: [hex(dol.entryPoint)],
  entry_context: [],
});

/** Permissions Ghidra reports for the import: text r-x, data and BSS rw-. */
const TEXT_PERM = { readable: true, writable: false, executable: true };
const DATA_PERM = { readable: true, writable: true, executable: false };

const checkNamed = (
  checks: readonly { readonly name: string; readonly matched: boolean }[],
  name: string,
) => checks.find((check) => check.name === name);

describe("GameCube DOL load-image attestation", () => {
  it("verifies file-backed sections and only the BSS gaps outside data", async () => {
    const bytes = overlappingDol();
    const target = await dolTarget(bytes);
    expect(target.dol.bssOverlaps).toEqual([0]);

    const result = attestGhidraDolLoadImage(
      snapshotOf(bytes, target),
      target,
      observationsFor(bytes, target.dol),
      undefined,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "verified",
        format: "gamecube-dol",
        architecture: "powerpc",
        entry: { address: "0x80003100" },
        bss: { address: "0x8000fff8", size: "0x20" },
      },
    });
    const image = attestedDol(result);
    expect(image.sections).toHaveLength(2);
    expect(image.checks.every((check) => check.matched)).toBe(true);
    expect(checkNamed(image.checks, "bss_mappings")).toMatchObject({
      matched: true,
      expected: EXPECTED_GAPS,
      observed: EXPECTED_GAPS,
    });
    expect(
      checkNamed(image.checks, "initialized_unbacked_mappings"),
    ).toMatchObject({ matched: true, observed: 0 });
  });

  it("flags a file-backed mapping whose sha256 differs from its section bytes", async () => {
    const bytes = overlappingDol();
    const target = await dolTarget(bytes);
    const observations = observationsFor(bytes, target.dol);
    const dataMapping = observations.mappings.find(
      (mapping) => mapping.block === ".data0",
    );
    if (dataMapping === undefined) throw new Error("Missing data mapping");
    dataMapping.sha256 = "0".repeat(64);

    const result = attestGhidraDolLoadImage(
      snapshotOf(bytes, target),
      target,
      observations,
      undefined,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { status: "mismatch" },
    });
    const image = attestedDol(result);
    expect(checkNamed(image.checks, "file_backed_mappings")).toMatchObject({
      matched: false,
    });
    expect(checkNamed(image.checks, "bss_mappings")).toMatchObject({
      matched: true,
    });
  });

  it("flags a BSS mapping that covers initialized data", async () => {
    const bytes = overlappingDol();
    const target = await dolTarget(bytes);
    const observations = observationsFor(bytes, target.dol);
    // Ghidra reporting one uninitialized block over the whole BSS, data included.
    observations.mappings = observations.mappings.filter(
      (mapping) => mapping.block !== "bss",
    );
    observations.mappings.push({
      block: "bss",
      start: "0x8000fff8",
      end: "0x80010017",
      address_space: "ram",
      initialized: false,
      loaded: true,
      overlay: false,
      length: BSS_SIZE,
      source_file_index: null,
      file_offset: null,
      sha256: null,
      ...DATA_PERM,
    });

    const result = attestGhidraDolLoadImage(
      snapshotOf(bytes, target),
      target,
      observations,
      undefined,
    );
    expect(result).toMatchObject({ ok: true, value: { status: "mismatch" } });
    const image = attestedDol(result);
    expect(checkNamed(image.checks, "bss_mappings")).toMatchObject({
      matched: false,
      expected: EXPECTED_GAPS,
    });
  });

  it("flags a stock-language import when the caller selected no override", async () => {
    const bytes = overlappingDol();
    const target = await dolTarget(bytes);
    const result = attestGhidraDolLoadImage(
      snapshotOf(bytes, target),
      target,
      observationsFor(bytes, target.dol, {
        id: "PowerPC:BE:32:Gekko_Broadway",
        cspec: "default",
      }),
      undefined,
    );
    expect(result).toMatchObject({ ok: true, value: { status: "mismatch" } });
    const image = attestedDol(result);
    expect(checkNamed(image.checks, "language_id")).toMatchObject({
      matched: false,
      expected: "PowerPC:BE:32:default",
      observed: "PowerPC:BE:32:Gekko_Broadway",
    });
  });

  it("verifies the Broadway override only when the import used that language", async () => {
    const bytes = overlappingDol();
    const target = await dolTarget(bytes);
    const override = { languageId: "PowerPC:BE:32:Gekko_Broadway" };
    const broadway = observationsFor(bytes, target.dol, {
      id: "PowerPC:BE:32:Gekko_Broadway",
      cspec: "default",
    });
    expect(
      attestGhidraDolLoadImage(
        snapshotOf(bytes, target),
        target,
        broadway,
        override,
      ),
    ).toMatchObject({ ok: true, value: { status: "verified" } });

    // Same override, but Ghidra imported with the stock language instead.
    expect(
      attestGhidraDolLoadImage(
        snapshotOf(bytes, target),
        target,
        observationsFor(bytes, target.dol),
        override,
      ),
    ).toMatchObject({ ok: true, value: { status: "mismatch" } });
  });
});

const TEXT_ADDRESS = 0x8000_3100;

/** Attest a correct import after one mutation of the observed mappings. */
const attestMutated = async (
  mutate: (mappings: NativeLoadImageObservation["mappings"]) => void,
) => {
  const bytes = overlappingDol();
  const target = await dolTarget(bytes);
  const observations = observationsFor(bytes, target.dol);
  mutate(observations.mappings);
  return attestedDol(
    attestGhidraDolLoadImage(
      snapshotOf(bytes, target),
      target,
      observations,
      undefined,
    ),
  );
};

const blockCheck = (checks: DolImage["checks"], block: string, start: number) =>
  checkNamed(checks, `block ${block} at ${hex(start)}`);

describe("GameCube DOL block permissions and state", () => {
  it("names the text block when its write permission is wrong", async () => {
    const image = await attestMutated((mappings) => {
      const text = mappings.find((m) => m.block === ".text0");
      if (text === undefined) throw new Error("Missing text mapping");
      text.writable = true;
    });
    expect(image.status).toBe("mismatch");
    expect(blockCheck(image.checks, ".text0", TEXT_ADDRESS)).toMatchObject({
      matched: false,
      observed: expect.objectContaining({ writable: true, executable: true }),
    });
  });

  it("names the data block when its write permission is missing", async () => {
    const image = await attestMutated((mappings) => {
      const data = mappings.find((m) => m.block === ".data0");
      if (data === undefined) throw new Error("Missing data mapping");
      data.writable = false;
    });
    expect(image.status).toBe("mismatch");
    expect(blockCheck(image.checks, ".data0", DATA_ADDRESS)).toMatchObject({
      matched: false,
      observed: expect.objectContaining({ writable: false }),
    });
    expect(checkNamed(image.checks, "file_backed_mappings")).toMatchObject({
      matched: false,
    });
  });

  it("flags a BSS gap reported as an overlay", async () => {
    const image = await attestMutated((mappings) => {
      const gap = mappings.find((m) => m.block === "bss");
      if (gap === undefined) throw new Error("Missing BSS mapping");
      gap.overlay = true;
    });
    expect(image.status).toBe("mismatch");
    expect(blockCheck(image.checks, "bss", BSS_ADDRESS)).toMatchObject({
      matched: false,
      observed: expect.objectContaining({ overlay: true }),
    });
    expect(checkNamed(image.checks, "bss_mappings")).toMatchObject({
      matched: false,
    });
  });

  it("flags a BSS gap that Ghidra did not load", async () => {
    const image = await attestMutated((mappings) => {
      const gap = mappings.find((m) => m.block === "bss");
      if (gap === undefined) throw new Error("Missing BSS mapping");
      gap.loaded = false;
    });
    expect(image.status).toBe("mismatch");
    expect(blockCheck(image.checks, "bss", BSS_ADDRESS)).toMatchObject({
      matched: false,
      observed: expect.objectContaining({ loaded: false }),
    });
  });

  it("flags a data mapping in a different address space", async () => {
    const image = await attestMutated((mappings) => {
      const data = mappings.find((m) => m.block === ".data0");
      if (data === undefined) throw new Error("Missing data mapping");
      data.address_space = "io";
    });
    expect(image.status).toBe("mismatch");
    expect(blockCheck(image.checks, ".data0", DATA_ADDRESS)).toMatchObject({
      matched: false,
      observed: expect.objectContaining({ address_space: "io" }),
    });
  });

  it("does not verify a DOL block whose permissions were never measured", async () => {
    const image = await attestMutated((mappings) => {
      const text = mappings.find((m) => m.block === ".text0");
      if (text === undefined) throw new Error("Missing text mapping");
      delete text.readable;
      delete text.writable;
      delete text.executable;
    });
    expect(image.status).toBe("mismatch");
    expect(
      checkNamed(image.checks, "block_permissions_measured"),
    ).toMatchObject({ matched: false, observed: [".text0"] });
    expect(blockCheck(image.checks, ".text0", TEXT_ADDRESS)).toMatchObject({
      matched: false,
    });
  });

  it("flags a text block that is not readable", async () => {
    const image = await attestMutated((mappings) => {
      const text = mappings.find((m) => m.block === ".text0");
      if (text === undefined) throw new Error("Missing text mapping");
      text.readable = false;
    });
    expect(image.status).toBe("mismatch");
    expect(blockCheck(image.checks, ".text0", TEXT_ADDRESS)).toMatchObject({
      matched: false,
      observed: expect.objectContaining({ readable: false }),
    });
  });
});

describe("GameCube DOL snapshot digest", () => {
  it("refuses bytes that do not match the admitted target digest", async () => {
    const bytes = overlappingDol();
    const target = await dolTarget(bytes);
    expect(
      attestGhidraDolLoadImage(
        snapshotOf(Buffer.concat([bytes, Buffer.from([0])]), target),
        target,
        observationsFor(bytes, target.dol),
        undefined,
      ),
    ).toEqual({
      ok: false,
      error: "Ghidra DOL snapshot digest does not match the admitted target",
    });
  });
});

it("preserves qualified language blocks outside the default BSS space", async () => {
  const bytes = overlappingDol();
  const target = await dolTarget(bytes);
  const observations = observationsFor(bytes, target.dol);
  const foreign = {
    block: "language-registers",
    start: "other%3Aspace:0x8000fff8",
    end: "other%3Aspace:0x8000ffff",
    address_space: "other:space",
    initialized: false,
    loaded: false,
    overlay: false,
    length: 8,
    source_file_index: null,
    file_offset: null,
    sha256: null,
    ...DATA_PERM,
  };
  observations.mappings.push(foreign);
  const image = attestedDol(
    attestGhidraDolLoadImage(
      snapshotOf(bytes, target),
      target,
      observations,
      undefined,
    ),
  );
  expect(image.status).toBe("verified");
  expect(image.observations.mappings).toContainEqual(foreign);
  expect(checkNamed(image.checks, "bss_mappings")).toMatchObject({
    matched: true,
  });
});

it("reports a foreign-space file mapping as a mismatch", async () => {
  const bytes = overlappingDol();
  const target = await dolTarget(bytes);
  const observations = observationsFor(bytes, target.dol);
  const data = observations.mappings.find(({ block }) => block === ".data0");
  if (data === undefined) throw new Error("Missing data mapping");
  data.start = "overlay%3Aone:0x80010000";
  data.end = "overlay%3Aone:0x8001000f";
  data.address_space = "overlay:one";
  data.overlay = true;
  const image = attestedDol(
    attestGhidraDolLoadImage(
      snapshotOf(bytes, target),
      target,
      observations,
      undefined,
    ),
  );
  expect(image.status).toBe("mismatch");
  expect(image.observations.mappings).toContainEqual(data);
  expect(checkNamed(image.checks, "file_backed_mappings")).toMatchObject({
    matched: false,
  });
});
