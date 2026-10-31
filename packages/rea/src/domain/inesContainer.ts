import { z } from "zod";
import { err, ok, type Result } from "./result.js";

/** Byte signatures select a container family, never an executable architecture. */
export const nesContainerFormat = (
  prefix: Buffer,
): "ines" | "nes-2.0" | "unif" | undefined => {
  if (prefix.subarray(0, 4).equals(Buffer.from("UNIF"))) return "unif";
  if (!prefix.subarray(0, 4).equals(Buffer.from([0x4e, 0x45, 0x53, 0x1a])))
    return undefined;
  return prefix.length >= 8 && (prefix.readUInt8(7) & 0x0c) === 0x08
    ? "nes-2.0"
    : "ines";
};

const inesHeaderSchema = z.strictObject({
  format: z.literal("ines"),
  header_hex: z.string().regex(/^[a-f0-9]{32}$/u),
  prg_rom_units_16k: z.number().int().min(1).max(255),
  chr_rom_units_8k: z.number().int().min(0).max(255),
  mapper: z.number().int().min(0).max(255),
  flags_6: z.number().int().min(0).max(255),
  flags_7: z.number().int().min(0).max(255),
  trainer_present: z.boolean(),
  battery_flag: z.boolean(),
  mirroring: z.enum(["horizontal", "vertical", "four-screen"]),
});

/** Verified concatenation is a byte identity claim, not an emulator claim. */
export const inesInventorySchema = z.strictObject({
  header: inesHeaderSchema,
  reconstruction: z.strictObject({
    region_order: z.array(z.string().min(1)).min(2),
    bytes: z.number().int().min(16).max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    verified: z.literal(true),
  }),
});

export type InesInventory = z.infer<typeof inesInventorySchema>;

export interface InesRegion {
  readonly path: string;
  readonly offset: number;
  readonly length: number;
}

export interface InesLayout {
  readonly header: InesInventory["header"];
  readonly regions: readonly InesRegion[];
}

/**
 * Classic iNES counts 16 KiB PRG and 8 KiB CHR file units. Those units do not
 * establish the mapper's runtime windows. Preserve all other bytes verbatim.
 */
export const parseInesLayout = (
  prefix: Buffer,
  fileSize: number,
): Result<InesLayout, string> => {
  const format = nesContainerFormat(prefix);
  if (format !== "ines")
    return err(
      format === undefined
        ? "missing iNES byte signature"
        : `${format} containers are not supported by the classic iNES lane`,
    );
  if (!Number.isSafeInteger(fileSize) || fileSize < 0)
    return err("invalid iNES file extent: expected a nonnegative safe integer");
  if (fileSize < 16 || prefix.length < 16)
    return err("truncated iNES header: expected 16 bytes");
  const prgUnits = prefix.readUInt8(4);
  const chrUnits = prefix.readUInt8(5);
  const flags6 = prefix.readUInt8(6);
  const flags7 = prefix.readUInt8(7);
  if ((flags7 & 0x0c) !== 0) return err("unsupported iNES header variant");
  // Dirty legacy headers make the upper mapper bits ambiguous. Do not repair
  // them or claim a mapper that the observed header cannot establish.
  if (prefix.subarray(12, 16).some((byte) => byte !== 0))
    return err(
      "ambiguous iNES mapper: reserved header bytes 12..15 are nonzero",
    );
  if (prgUnits === 0) return err("iNES requires at least one PRG-ROM unit");
  const trainer = (flags6 & 4) !== 0;
  const declaredEnd =
    16 + (trainer ? 512 : 0) + prgUnits * 16_384 + chrUnits * 8_192;
  if (declaredEnd > fileSize)
    return err(
      `truncated iNES payload: header declares ${declaredEnd} bytes; file has ${fileSize}`,
    );
  const regions: InesRegion[] = [{ path: "header.bin", offset: 0, length: 16 }];
  let offset = 16;
  if (trainer) {
    regions.push({ path: "trainer.bin", offset, length: 512 });
    offset += 512;
  }
  for (const [kind, count, length] of [
    ["prg", prgUnits, 16_384],
    ["chr", chrUnits, 8_192],
  ] as const)
    for (let index = 0; index < count; index += 1) {
      regions.push({
        path: `${kind}/${String(index).padStart(3, "0")}.bin`,
        offset,
        length,
      });
      offset += length;
    }
  if (offset < fileSize)
    regions.push({ path: "trailing.bin", offset, length: fileSize - offset });
  return ok({
    header: {
      format: "ines",
      header_hex: prefix.subarray(0, 16).toString("hex"),
      prg_rom_units_16k: prgUnits,
      chr_rom_units_8k: chrUnits,
      mapper: (flags6 >>> 4) | (flags7 & 0xf0),
      flags_6: flags6,
      flags_7: flags7,
      trainer_present: trainer,
      battery_flag: (flags6 & 2) !== 0,
      mirroring:
        (flags6 & 8) !== 0
          ? "four-screen"
          : (flags6 & 1) !== 0
            ? "vertical"
            : "horizontal",
    },
    regions,
  });
};
