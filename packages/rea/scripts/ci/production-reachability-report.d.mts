export interface ProductionReachabilityFinding {
  readonly name: string;
  readonly namespace?: string;
  readonly kind?: string;
  readonly specifier?: string;
  readonly line?: number;
  readonly col?: number;
  readonly pos?: number;
}

export interface ProductionReachabilityIssue {
  readonly file: string;
  readonly owners?: readonly { readonly name: string }[];
  readonly files?: readonly ProductionReachabilityFinding[];
  readonly exports?: readonly ProductionReachabilityFinding[];
  readonly nsExports?: readonly ProductionReachabilityFinding[];
  readonly types?: readonly ProductionReachabilityFinding[];
  readonly nsTypes?: readonly ProductionReachabilityFinding[];
  readonly enumMembers?: readonly ProductionReachabilityFinding[];
  readonly namespaceMembers?: readonly ProductionReachabilityFinding[];
  readonly duplicates?: readonly (readonly ProductionReachabilityFinding[])[];
}

export interface ProductionReachabilityReport {
  readonly issues: readonly ProductionReachabilityIssue[];
}

export function parseProductionReachabilityReport(
  text: string,
): ProductionReachabilityReport;
export function recordProductionReachabilityReport(
  root?: string,
): Promise<ProductionReachabilityReport>;
