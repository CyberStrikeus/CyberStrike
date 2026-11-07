export function supportsNativeAotFixtureHost(
  platform: string,
  architecture: string,
): boolean;

export function buildNativeAotFixture(
  run: (command: string, args: string[]) => unknown,
  options: {
    dotnet: string;
    project: string;
    runtime: string;
    output: string;
  },
): Promise<void>;

export function nativeAotCommandError(
  command: string,
  operation: string,
  result: {
    error?: { message: string };
    status: number | null;
    stdout?: string | null;
    stderr?: string | null;
  },
): Error;
