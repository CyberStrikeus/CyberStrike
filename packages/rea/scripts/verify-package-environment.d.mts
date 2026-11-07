export interface PackageHopperEnvironment {
  readonly HOPPER_LAUNCHER_PATH: string;
  readonly HOPPER_LOADER_ARGS_JSON: string;
}

export function packageHopperEnvironment(
  root: string,
  platform?: string,
): PackageHopperEnvironment;

export function verifyPackageEnvironment(input: {
  readonly root: string;
  readonly workspace: string;
  readonly evidenceRoot: string;
  readonly referenceRoot: string;
}): Promise<{
  readonly prefix: string;
  readonly home: string;
  readonly npxLog: string;
  readonly claudeConfig: string;
  readonly codexConfig: string;
  readonly codexTarget: string;
  readonly cursorConfig: string;
  readonly cursorTarget: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}>;
