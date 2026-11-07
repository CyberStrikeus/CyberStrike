export interface RealHopperFixtureOracle {
  readonly mainProcedure: string;
  readonly entryProcedure: string;
  readonly branchProcedure: string;
  readonly leafProcedure: string;
  readonly entryString: string;
  readonly leafString: string;
  readonly globalName: string;
}

export interface RealHopperFixtureTarget {
  readonly path: string;
  readonly sha256: string;
}

export interface RealHopperLargeFixtureOracle {
  readonly symbolPrefix: string;
  readonly symbolCount: number;
  readonly stringPrefix: string;
  readonly stringCount: number;
}

export interface RealHopperFixtureTargets {
  readonly manifestPath: string;
  readonly primary: RealHopperFixtureTarget;
  readonly secondary: RealHopperFixtureTarget;
  readonly large: RealHopperFixtureTarget;
  readonly oracle: RealHopperFixtureOracle;
  readonly largeOracle: RealHopperLargeFixtureOracle;
}

export function loadRealHopperFixtureTargets(
  manifestPath: string,
): Promise<RealHopperFixtureTargets>;
