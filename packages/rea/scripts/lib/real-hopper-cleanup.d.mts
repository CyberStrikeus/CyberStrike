/** Observe concrete Hopper runtime resources for a before/after cleanup check. */
export function snapshotHopperRuntime(
  parent: string,
  targetLeaseDirectory: string,
  ownedProcessIds?: ReadonlySet<number>,
): Promise<Set<string>>;
