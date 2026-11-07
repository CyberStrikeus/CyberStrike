import {
  readElfRelocationWritesSteps,
  ElfPointerRelocationFailure,
} from "../native/metadata/ElfPointerRelocations.js";
import type {
  BinaryContainer,
  FileMapping,
  ZeroFillMapping,
} from "../native/metadata/BinaryContainer.js";
import { Il2cppBinaryFormatFailure } from "./Il2cppBinaryFormat.js";

/** Materialize the shared loader facts only for IL2CPP's existing private reader. */
export function* applyElfRelativeRelocationsSteps(
  image: Buffer,
  elf: Extract<BinaryContainer, { format: "elf" }>["elf"],
  mappings: readonly FileMapping[],
  zeroFills: readonly ZeroFillMapping[],
): Generator<
  void,
  {
    readonly bytes: Buffer;
    readonly unresolved: ReadonlyMap<bigint, number>;
    readonly zeroFillPointers: ReadonlyMap<bigint, bigint>;
  }
> {
  try {
    const steps = readElfRelocationWritesSteps(
      image,
      {
        bits: 64,
        little: true,
        machine: elf.machine,
        dynamicSegments: elf.dynamicSegments,
        mappings,
        zeroFills,
      },
      { requireDynamic: true },
    );
    const bytes = Buffer.from(image),
      zeroFillPointers = new Map<bigint, bigint>(),
      unresolved = new Map<bigint, number>();
    // One bit per original file offset replaces per-relocation objects. Reads
    // of implicit addends continue using image, never this mutable private copy.
    const starts = Buffer.alloc(Math.ceil(image.length / 8));
    const wasWritten = (offset: number) =>
      offset >= 0 &&
      offset < image.length &&
      ((starts[Math.floor(offset / 8)] ?? 0) & (1 << (offset % 8))) !== 0;
    const admitState = () => {
      if (unresolved.size + zeroFillPointers.size >= 65_536)
        throw new Il2cppBinaryFormatFailure(
          "native-index-capacity",
          "ELF unresolved and zero-fill overlay exceeds 65536 entries",
        );
    };
    const unknown = (address: bigint, width: number) => {
      if (!unresolved.has(address)) admitState();
      unresolved.set(address, Math.max(unresolved.get(address) ?? 0, width));
    };
    let next = steps.next();
    while (!next.done) {
      const write = next.value;
      if (write === undefined) {
        yield;
        next = steps.next();
        continue;
      }
      const at = write.file_offset;
      if (write.value === null) {
        unknown(write.address, write.width);
        if (at !== null) bytes.fill(0, at, at + write.width);
      } else if (at === null) {
        for (let delta = -7; delta <= 7; delta++) {
          const previous = zeroFillPointers.get(write.address + BigInt(delta));
          if (
            previous !== undefined &&
            (delta !== 0 || previous !== write.value)
          )
            unknown(write.address, 8);
        }
        if (!zeroFillPointers.has(write.address)) admitState();
        zeroFillPointers.set(write.address, write.value);
      } else {
        for (let delta = -7; delta <= 7; delta++)
          if (
            wasWritten(at + delta) &&
            (delta !== 0 || bytes.readBigUInt64LE(at) !== write.value)
          )
            unknown(write.address, 8);
        const byte = Math.floor(at / 8);
        starts[byte] = (starts[byte] ?? 0) | (1 << (at % 8));
        bytes.writeBigUInt64LE(write.value, at);
      }
      next = steps.next();
    }
    return { bytes, unresolved, zeroFillPointers };
  } catch (cause) {
    if (cause instanceof ElfPointerRelocationFailure)
      throw new Il2cppBinaryFormatFailure(cause.reason, cause.message);
    throw cause;
  }
}
