import type {
  ParsedReconstructionCoverage,
  ReconstructionCoverageData,
} from "./reconstructionCoverage.js";

/** One completion scope shared by ownership, proof, risk and summary checks. */
export interface ReconstructionCoverageScope {
  readonly surfaceIds: ReadonlySet<string>;
  readonly claimIds: ReadonlySet<string>;
  readonly claimSurfaceIds: ReadonlyMap<string, ReadonlySet<string>>;
  readonly missingDependencies: ReadonlyMap<string, ReadonlySet<string>>;
}

export const reconstructionCoverageScope = (
  parsed: ParsedReconstructionCoverage,
  boundary: ReconstructionCoverageData["boundaries"][number],
): ReconstructionCoverageScope => {
  const claimIds = new Set(boundary.required_claim_ids);
  const claimSurfaceIds = new Map<string, ReadonlySet<string>>();
  for (const claimId of claimIds) {
    const claim = parsed.claims.get(claimId);
    if (claim !== undefined)
      claimSurfaceIds.set(
        claimId,
        reachableSurfaces(claim.surface_ids, parsed.surfaces).surfaceIds,
      );
  }
  return {
    ...reachableSurfaces(
      [
        ...boundary.required_surface_ids,
        ...[...claimSurfaceIds.values()].flatMap((ids) => [...ids]),
      ],
      parsed.surfaces,
    ),
    claimIds,
    claimSurfaceIds,
  };
};

const reachableSurfaces = (
  roots: readonly string[],
  surfaces: ParsedReconstructionCoverage["surfaces"],
): Pick<ReconstructionCoverageScope, "surfaceIds" | "missingDependencies"> => {
  const surfaceIds = new Set(roots);
  const pending = [...surfaceIds];
  const missingDependencies = new Map<string, Set<string>>();
  for (let index = 0; index < pending.length; index += 1) {
    const surface = surfaces.get(pending[index]!);
    if (surface === undefined) continue;
    for (const dependencyId of surface.dependency_surface_ids) {
      if (!surfaces.has(dependencyId)) {
        const dependents = missingDependencies.get(dependencyId) ?? new Set();
        dependents.add(surface.surface_id);
        missingDependencies.set(dependencyId, dependents);
      }
      if (!surfaceIds.has(dependencyId)) {
        surfaceIds.add(dependencyId);
        pending.push(dependencyId);
      }
    }
  }
  return { surfaceIds, missingDependencies };
};
