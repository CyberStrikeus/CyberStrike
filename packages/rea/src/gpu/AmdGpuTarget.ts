const processor = String.raw`gfx[0-9a-z]+(?:-[0-9a-z]+)*`;
const targetFeaturesSource = String.raw`(?:(?::[a-z0-9_-]+[+-])|(?:\+[a-z0-9_-]+))*`;
const targetIdSource = `${processor}${targetFeaturesSource}`;
const targetId = new RegExp(`^(${processor})${targetFeaturesSource}$`, "iu");
const targetTripleSource = String.raw`(?:amdgcn|amdgpu(?:[0-9]+(?:\.[0-9a-f]+)?)?)-amd-amdhsa`;
const bundleTriple = new RegExp(`^(?:hip|hipv4)-${targetTripleSource}-`, "iu");
const bundleTarget = new RegExp(`(?:--|-)(${targetIdSource})$`, "iu");
const noteTarget = new RegExp(
  `^${targetTripleSource}(?:--|-unknown-)(${targetIdSource})$`,
  "iu",
);

// LLVM's EF_AMDGPU_MACH values occupy the low byte of ELF e_flags. Keep this
// table limited to processor names explicitly assigned by LLVM; feature bits
// outside the processor mask have separate, code-object-version semantics.
const ELF_PROCESSORS: Readonly<Record<number, string>> = {
  0x20: "gfx600",
  0x21: "gfx601",
  0x22: "gfx700",
  0x23: "gfx701",
  0x24: "gfx702",
  0x25: "gfx703",
  0x26: "gfx704",
  0x28: "gfx801",
  0x29: "gfx802",
  0x2a: "gfx803",
  0x2b: "gfx810",
  0x2c: "gfx900",
  0x2d: "gfx902",
  0x2e: "gfx904",
  0x2f: "gfx906",
  0x30: "gfx908",
  0x31: "gfx909",
  0x32: "gfx90c",
  0x33: "gfx1010",
  0x34: "gfx1011",
  0x35: "gfx1012",
  0x36: "gfx1030",
  0x37: "gfx1031",
  0x38: "gfx1032",
  0x39: "gfx1033",
  0x3a: "gfx602",
  0x3b: "gfx705",
  0x3c: "gfx805",
  0x3d: "gfx1035",
  0x3e: "gfx1034",
  0x3f: "gfx90a",
  0x41: "gfx1100",
  0x42: "gfx1013",
  0x43: "gfx1150",
  0x44: "gfx1103",
  0x45: "gfx1036",
  0x46: "gfx1101",
  0x47: "gfx1102",
  0x48: "gfx1200",
  0x49: "gfx1250",
  0x4a: "gfx1151",
  0x4c: "gfx942",
  0x4e: "gfx1201",
  0x4f: "gfx950",
  0x50: "gfx1310",
  0x51: "gfx9-generic",
  0x52: "gfx10-1-generic",
  0x53: "gfx10-3-generic",
  0x54: "gfx11-generic",
  0x55: "gfx1152",
  0x57: "gfx1154",
  0x58: "gfx1153",
  0x59: "gfx12-generic",
  0x5a: "gfx1251",
  0x5b: "gfx12-5-generic",
  0x5c: "gfx1172",
  0x5d: "gfx1170",
  0x5e: "gfx1171",
  0x5f: "gfx9-4-generic",
  0x62: "gfx11-7-generic",
  0x63: "gfx13-generic",
  0xeb: "gfx1250-strict",
};

export interface AmdGpuTargetIdentity {
  readonly key: string;
  readonly processor: string;
}

/** Retain exact target spelling separately from its canonical processor identity. */
const parseAmdGpuTargetId = (value: string): AmdGpuTargetIdentity | null => {
  const match = targetId.exec(value);
  return match?.[1] === undefined
    ? null
    : { key: value, processor: match[1].toLowerCase() };
};

/** Clang HIP bundle IDs carry an AMD triple followed by an optional target ID. */
export const isAmdGpuBundleId = (name: string): boolean =>
  bundleTriple.test(name);

export const readAmdGpuBundleTarget = (
  name: string,
): AmdGpuTargetIdentity | null => {
  if (!isAmdGpuBundleId(name)) return null;
  const target = bundleTarget.exec(name)?.[1];
  return target === undefined ? null : parseAmdGpuTargetId(target);
};

/** Preserve the full target ID separately from its processor identity. */
export const readAmdGpuNoteTarget = (
  target: string,
): AmdGpuTargetIdentity | null => {
  const value = noteTarget.exec(target)?.[1];
  return value === undefined ? null : parseAmdGpuTargetId(value);
};

/** Decode the processor field from AMDGPU ELF e_flags (EF_AMDGPU_MACH). */
export const readAmdGpuElfProcessor = (flags: number): string | null =>
  ELF_PROCESSORS[flags & 0xff] ?? null;
