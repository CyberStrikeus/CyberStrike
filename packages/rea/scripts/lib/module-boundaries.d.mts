/** One dependency crossing a settled source ownership boundary. */
export interface ModuleBoundaryViolation {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly target: string;
  readonly boundary:
    | "artifact-acquisition"
    | "process-capture"
    | "pure-layer"
    | "application-composition"
    | "provider-construction"
    | "provider-generated-catalog";
}

/** Check resolved source ownership, including type imports and reexports. */
export function inspectModuleBoundaries(
  file: string,
  source: string,
  root: string,
): readonly ModuleBoundaryViolation[];
