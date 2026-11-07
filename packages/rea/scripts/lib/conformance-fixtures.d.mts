export const LARGE_FIXTURE_COUNT: number;
export const HOPPER_C_ORACLE: Readonly<{
  mainProcedure: "main";
  entryProcedure: "rea_entry";
  branchProcedure: "rea_branch";
  leafProcedure: "rea_leaf";
  entryString: "REA_C_ENTRY";
  leafString: "REA_C_LEAF";
  globalName: "rea_c_global";
}>;
export function sha256(value: string | Uint8Array): string;
export function generateLargeFixture(): string;
export function sourceDigest(
  sources: readonly { readonly path: string; readonly content: string }[],
): string;

export function resolveConformanceFixturePath(
  root: string,
  declaredPath: unknown,
): Promise<string>;
export function bindConformanceFixtureArtifact(
  path: string,
  fixture: unknown,
): Promise<{ readonly path: string; readonly sha256: string }>;
