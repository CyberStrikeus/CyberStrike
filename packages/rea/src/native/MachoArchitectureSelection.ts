import { machoCpuSubtypeBase } from "../domain/apple/machoCpuIdentity.js";
import type { LipoArchitecture } from "./parsers/lipo.js";

interface MachoArchitecturePolicy {
  readonly cpuType: number;
  readonly subtypes: readonly {
    readonly subtype: number;
    readonly name: string;
  }[];
  readonly variantName?: RegExp;
}

/** One preference order for FAT subtype identities and Apple tool slice names. */
export const MACHO_ARCHITECTURE_POLICIES: Readonly<
  Record<string, MachoArchitecturePolicy>
> = {
  x86: { cpuType: 7, subtypes: [{ subtype: 3, name: "i386" }] },
  x86_64: {
    cpuType: 0x01000007,
    subtypes: [{ subtype: 3, name: "x86_64" }],
  },
  arm: { cpuType: 12, subtypes: [], variantName: /^arm$/u },
  arm64: {
    cpuType: 0x0100000c,
    subtypes: [
      { subtype: 0, name: "arm64" },
      { subtype: 2, name: "arm64e" },
      { subtype: 1, name: "arm64v8" },
    ],
    variantName: /^arm64e\.[A-Za-z0-9_]+$/u,
  },
  arm64_32: {
    cpuType: 0x0200000c,
    subtypes: [{ subtype: 1, name: "arm64_32" }],
  },
};

/** Unlisted subtypes follow the preferred slices in FAT table order. */
export const machoSubtypeRank = (
  policy: MachoArchitecturePolicy,
  subtype: number,
): number => {
  const rank = policy.subtypes.findIndex(
    (candidate) => candidate.subtype === machoCpuSubtypeBase(subtype),
  );
  return rank < 0 ? policy.subtypes.length : rank;
};

/** Return a tool selector only for an explicitly supported CPU subtype. */
export const machoKnownCodeSignSelector = (
  cpuType: number,
  cpuSubtype: number,
): string | undefined => {
  const capabilities = (cpuSubtype >>> 24) & 0xff;
  // arm64e pointer authentication and x86_64 LIB64 have known tool selectors.
  // Other capability variants may have distinct names; do not collapse them.
  if (
    capabilities !== 0 &&
    !(
      cpuType === 0x0100000c &&
      machoCpuSubtypeBase(cpuSubtype) === 2 &&
      capabilities === 0x80
    ) &&
    !(
      cpuType === 0x01000007 &&
      machoCpuSubtypeBase(cpuSubtype) === 3 &&
      capabilities === 0x80
    )
  )
    return undefined;
  return Object.values(MACHO_ARCHITECTURE_POLICIES)
    .find((policy) => policy.cpuType === cpuType)
    ?.subtypes.find(
      ({ subtype }) => subtype === machoCpuSubtypeBase(cpuSubtype),
    )?.name;
};

/** Keep the selected lipo record, including its container coordinates. */
export const selectMachoArchitecture = (
  policy: MachoArchitecturePolicy,
  available: readonly LipoArchitecture[],
): LipoArchitecture | undefined => {
  let selected: LipoArchitecture | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const architecture of available) {
    if (
      architecture.cpu_type_code !== null &&
      architecture.cpu_type_code !== policy.cpuType
    )
      continue;
    const namedSubtype = policy.subtypes.find(
      ({ name }) => name === architecture.name,
    );
    const recognizedName =
      namedSubtype !== undefined || policy.variantName?.test(architecture.name);
    if (
      !recognizedName &&
      (architecture.cpu_type_code === null ||
        architecture.cpu_subtype_base === null)
    )
      continue;
    // Parsed identity is authoritative. Names support thin/partial lipo records.
    const subtype = architecture.cpu_subtype_base ?? namedSubtype?.subtype;
    const rank =
      subtype === undefined
        ? policy.subtypes.length
        : machoSubtypeRank(policy, subtype);
    if (rank >= bestRank) continue;
    selected = architecture;
    bestRank = rank;
  }
  return selected;
};

/** lipo may label ARM64 V8 as arm64 even though tools select it as arm64v8. */
export const machoToolArchitectureName = (
  policy: MachoArchitecturePolicy,
  architecture: LipoArchitecture,
): string => {
  const named = policy.subtypes.find(({ name }) => name === architecture.name);
  const actual = policy.subtypes.find(
    ({ subtype }) => subtype === architecture.cpu_subtype_base,
  );
  return named !== undefined && actual !== undefined && named !== actual
    ? actual.name
    : architecture.name;
};
