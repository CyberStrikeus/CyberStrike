import { createHash } from "node:crypto";

type InlineCacheEntry = readonly [opcode: number, codeUnits: number];

const inlineCacheProfiles = (
  magics: readonly number[],
  entries: readonly InlineCacheEntry[],
): ReadonlyArray<readonly [number, ReadonlyMap<number, number>]> => {
  const profile = new Map(entries);
  return magics.map((magic) => [magic, profile]);
};

/**
 * CPython equality skips cache code units after comparing original code size.
 * These tables are pinned to CPython bytecode snapshots, not the shared marshal
 * layout. The 3.11 profile is from v3.11.9; commit
 * 616622cab7200bac476bf753d6cc98f4ee48808c adds magic 3495 with the same
 * opcode/cache table. 3.12 magic/profile transitions
 * follow CPython's v3.12.12 magic history and these cache-changing source
 * commits: f012df706cf3a9e63625b8166fe3f419855e9a94 (3503),
 * b083450f8896bb4a29ac522e4474d91c056b9f32 (3504),
 * 5fcfdd87c9b5066a581d3ccb4b2fede938f343ec (3505),
 * 6e4e14d98fe0868981f29701496d57a8223c5407 (3515),
 * 7b14c2ef194b6eed79670aa9d7e29ab8e2256a56 (3516),
 * 160f2fe2b90ed5ec7838cb4141dd35768422891f (3519),
 * 08b67fb34f4519be1b0bb4673643a2c761c7ae92 (3521),
 * 0444ae24875489dc290d8efdb9ee6440ee60dac8 (3523),
 * 121057aa3600c4d4d392539aeb79e1b09fd5659d (3524),
 * b4978ff872be5102117b4e25d93dbbb4e04c8292 (3525),
 * ef25febcf2ede92a03c5ea00a13e167e0b5cb274 (3528), and
 * 77262458fe3fe9f3f0266bbf578675a906b1e353 (3530). The 3.13 magic history
 * is recorded in CPython's Lib/importlib/_bootstrap_external.py; opcode/cache sources include
 * 1d857da7f0e4858e561223f319ae5afe737d5657 (3553/3554),
 * 665a4391e10167dad1c854fb604c86f336fcd331 (3559),
 * 3b2ecbc1275bd05534885cee9ac1389987238561 (3560),
 * bcce5e271815c0bdbe894964e853210d2c75949b (3561),
 * 8b55adfa8ff05477b4be7def36db7b66c73f181d (3562),
 * 22e65eecaad3f5337862319687047afe9861e1ef (3563), and
 * 52cc4af6ae9002f11605f91b672746c127494efd (3564). Adjacent magics share a
 * profile only where their source changes do not alter cache widths or IDs.
 * Final 3.13 magic 3571 matches the opcode IDs and cache widths in CPython
 * v3.13.17's Lib/_opcode_metadata.py and Lib/opcode.py.
 */
const INLINE_CACHE_ENTRIES_BY_MAGIC: ReadonlyMap<
  number,
  ReadonlyMap<number, number>
> = new Map([
  ...inlineCacheProfiles(
    [3494, 3495],
    [
      [25, 4],
      [60, 1],
      [92, 1],
      [95, 4],
      [106, 4],
      [107, 2],
      [116, 5],
      [122, 1],
      [160, 10],
      [166, 1],
      [171, 4],
    ],
  ),
  ...inlineCacheProfiles(
    [3500, 3501, 3502],
    [
      [25, 4],
      [60, 1],
      [92, 1],
      [95, 4],
      [106, 4],
      [107, 2],
      [116, 5],
      [122, 1],
      [160, 10],
      [171, 4],
    ],
  ),
  ...inlineCacheProfiles(
    [3503],
    [
      [25, 4],
      [60, 1],
      [92, 1],
      [95, 4],
      [106, 4],
      [107, 2],
      [116, 5],
      [122, 1],
      [160, 9],
      [171, 4],
    ],
  ),
  ...inlineCacheProfiles(
    [3504],
    [
      [25, 4],
      [60, 1],
      [92, 1],
      [95, 4],
      [106, 9],
      [107, 2],
      [116, 5],
      [122, 1],
      [171, 4],
    ],
  ),
  ...inlineCacheProfiles(
    [3505, 3506, 3507, 3508, 3509, 3510, 3511, 3512, 3513, 3514],
    [
      [25, 4],
      [60, 1],
      [92, 1],
      [93, 1],
      [95, 4],
      [106, 9],
      [107, 2],
      [116, 5],
      [122, 1],
      [171, 4],
    ],
  ),
  ...inlineCacheProfiles(
    [3515],
    [
      [25, 4],
      [60, 1],
      [92, 1],
      [93, 1],
      [95, 4],
      [106, 9],
      [107, 1],
      [116, 5],
      [122, 1],
      [171, 4],
    ],
  ),
  ...inlineCacheProfiles(
    [3516, 3517, 3518],
    [
      [25, 4],
      [60, 1],
      [92, 1],
      [93, 1],
      [95, 4],
      [106, 9],
      [107, 1],
      [116, 5],
      [122, 1],
      [141, 1],
      [171, 4],
    ],
  ),
  ...inlineCacheProfiles(
    [3519, 3520],
    [
      [25, 4],
      [60, 1],
      [92, 1],
      [93, 1],
      [95, 4],
      [106, 9],
      [107, 1],
      [116, 5],
      [122, 1],
      [123, 1],
      [141, 1],
      [171, 4],
    ],
  ),
  ...inlineCacheProfiles(
    [3521, 3522],
    [
      [25, 4],
      [60, 1],
      [92, 1],
      [93, 1],
      [95, 4],
      [106, 9],
      [107, 1],
      [116, 4],
      [122, 1],
      [123, 1],
      [141, 1],
      [171, 4],
    ],
  ),
  ...inlineCacheProfiles(
    [3523],
    [
      [25, 4],
      [60, 1],
      [92, 1],
      [93, 1],
      [95, 4],
      [106, 9],
      [107, 1],
      [116, 4],
      [122, 1],
      [123, 1],
      [171, 4],
    ],
  ),
  ...inlineCacheProfiles(
    [3524],
    [
      [25, 1],
      [60, 1],
      [92, 1],
      [93, 1],
      [95, 4],
      [106, 9],
      [107, 1],
      [116, 4],
      [122, 1],
      [123, 1],
      [171, 4],
    ],
  ),
  ...inlineCacheProfiles(
    [3525, 3526, 3527],
    [
      [25, 1],
      [60, 1],
      [92, 1],
      [93, 1],
      [95, 4],
      [106, 9],
      [107, 1],
      [116, 4],
      [122, 1],
      [123, 1],
      [171, 3],
    ],
  ),
  ...inlineCacheProfiles(
    [3528, 3529],
    [
      [25, 1],
      [60, 1],
      [92, 1],
      [93, 1],
      [95, 4],
      [106, 9],
      [107, 1],
      [116, 4],
      [122, 1],
      [123, 1],
      [141, 9],
      [171, 3],
    ],
  ),
  ...inlineCacheProfiles(
    [3530, 3531],
    [
      [25, 1],
      [60, 1],
      [92, 1],
      [93, 1],
      [95, 4],
      [106, 9],
      [107, 1],
      [116, 4],
      [122, 1],
      [123, 1],
      [141, 1],
      [171, 3],
    ],
  ),
  ...inlineCacheProfiles(
    [3550, 3551, 3552, 3553, 3554, 3555, 3556, 3557, 3558],
    [
      [25, 1],
      [60, 1],
      [92, 1],
      [93, 1],
      [95, 4],
      [106, 9],
      [107, 1],
      [116, 4],
      [122, 1],
      [123, 1],
      [140, 1],
      [141, 1],
      [171, 3],
    ],
  ),
  ...inlineCacheProfiles(
    [3559],
    [
      [12, 1],
      [53, 1],
      [56, 3],
      [67, 1],
      [75, 3],
      [97, 1],
      [114, 1],
      [123, 1],
      [129, 9],
      [150, 4],
      [154, 1],
      [168, 1],
      [173, 4],
      [183, 1],
    ],
  ),
  ...inlineCacheProfiles(
    [3560],
    [
      [12, 1],
      [54, 1],
      [57, 3],
      [68, 1],
      [76, 3],
      [98, 1],
      [115, 1],
      [124, 1],
      [130, 9],
      [151, 4],
      [155, 1],
      [169, 1],
      [174, 4],
      [184, 1],
    ],
  ),
  ...inlineCacheProfiles(
    [3561],
    [
      [12, 1],
      [54, 1],
      [57, 3],
      [68, 1],
      [76, 3],
      [98, 1],
      [115, 1],
      [124, 1],
      [130, 9],
      [151, 4],
      [155, 1],
      [161, 1],
      [162, 1],
      [163, 1],
      [164, 1],
      [169, 1],
      [174, 4],
      [184, 1],
    ],
  ),
  ...inlineCacheProfiles(
    [3562],
    [
      [5, 1],
      [39, 1],
      [40, 3],
      [45, 1],
      [53, 3],
      [57, 1],
      [71, 1],
      [76, 1],
      [82, 9],
      [91, 4],
      [93, 1],
      [97, 1],
      [98, 1],
      [99, 1],
      [100, 1],
      [104, 1],
      [108, 4],
      [117, 1],
    ],
  ),
  ...inlineCacheProfiles(
    [3563, 3564, 3565, 3566, 3567, 3568],
    [
      [5, 1],
      [39, 1],
      [40, 3],
      [45, 1],
      [53, 3],
      [58, 1],
      [72, 1],
      [77, 1],
      [82, 9],
      [91, 4],
      [93, 1],
      [97, 1],
      [98, 1],
      [99, 1],
      [100, 1],
      [104, 1],
      [108, 4],
      [117, 1],
    ],
  ),
  ...inlineCacheProfiles(
    [3569, 3570, 3571],
    [
      [5, 1],
      [39, 1],
      [40, 3],
      [45, 1],
      [53, 3],
      [58, 1],
      [59, 1],
      [72, 1],
      [77, 1],
      [82, 9],
      [91, 4],
      [93, 1],
      [97, 1],
      [98, 1],
      [99, 1],
      [100, 1],
      [104, 1],
      [108, 4],
      [117, 1],
    ],
  ),
]);

/** Preserve CPython's bytecode-size check and omit only cache code units. */
export const pythonPycBytecodeIdentity = (
  bytecode: Buffer,
  magic: number,
  rawSha256: string,
): string => {
  const caches = INLINE_CACHE_ENTRIES_BY_MAGIC.get(magic);
  if (caches === undefined) return `${bytecode.length}:${rawSha256}`;

  const digest = createHash("sha256");
  let activeStart = 0;
  for (let offset = 0; offset < bytecode.length;) {
    const opcode = bytecode[offset] ?? 0;
    const afterOpcode = offset + 2;
    const cacheBytes = (caches.get(opcode) ?? 0) * 2;
    offset = afterOpcode + cacheBytes;
    if (cacheBytes > 0) {
      digest.update(bytecode.subarray(activeStart, afterOpcode));
      activeStart = offset;
    }
  }
  if (activeStart < bytecode.length) {
    digest.update(bytecode.subarray(activeStart));
  }
  return `${bytecode.length}:${digest.digest("hex")}`;
};
