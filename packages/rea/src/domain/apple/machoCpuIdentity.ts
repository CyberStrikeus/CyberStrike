/** CPU subtype bits reserved for ABI/capability flags, not the base subtype. */
const CPU_SUBTYPE_CAPABILITY_MASK = 0xff000000;

/** Return the CPU subtype identity shared across capability-flag variations. */
export const machoCpuSubtypeBase = (cpuSubtype: number): number =>
  cpuSubtype & ~CPU_SUBTYPE_CAPABILITY_MASK;

/**
 * Display known byte-header identities without inferring pointer-auth ABI names.
 * Subtype 12: llvm-project b8007a8e4020b8bca2b12e941660e10bf5bf6716,
 * MachO.h / MachOObjectFile.cpp. Capability bits remain independent source facts.
 */
export const machoArchitectureName = (
  cpuType: number,
  cpuSubtype: number,
): string => {
  const subtype = machoCpuSubtypeBase(cpuSubtype);
  if (cpuType === 0x0100000c) {
    if (subtype === 12) return "arm64e.x1";
    if (subtype === 2) return "arm64e";
    if (subtype === 1) return "arm64v8";
    return "arm64";
  }
  if (cpuType === 0x0200000c) return "arm64_32";
  if (cpuType === 0x01000007) return subtype === 8 ? "x86_64h" : "x86_64";
  if (cpuType === 7) return "i386";
  if (cpuType === 12) return "arm";
  return `cpu-${cpuType.toString(16)}`;
};

/** Known exact display aliases retain the existing family-based request semantics. */
export const machoArchitectureFamily = (architecture: string): string => {
  if (architecture === "arm64e.x1") return "arm64e";
  if (architecture === "arm64v8") return "arm64";
  return architecture;
};
