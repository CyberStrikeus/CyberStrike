/** Compare actual Vitest discovery with repository-owned test paths. */
export function compareTestDiscovery(
  expectedPaths: readonly string[],
  discovery: unknown,
  root: string,
): {
  readonly missing: readonly string[];
  readonly unexpected: readonly string[];
  readonly duplicates: readonly {
    readonly file: string;
    readonly projects: readonly string[];
  }[];
  readonly discovered: number;
};
