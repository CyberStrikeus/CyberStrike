export interface FixtureProcedure {
  readonly address: string;
  readonly name: string;
}

interface ToolClient {
  callTool(
    request: { readonly name: string; readonly arguments: unknown },
    options: unknown,
  ): Promise<unknown>;
}

export function resolveFixtureProcedure(
  client: ToolClient,
  options: unknown,
  expectedName: string,
  normalizedResult: (value: unknown, operation: string) => unknown,
): Promise<FixtureProcedure>;

export function requireSafeDiagnostics(chunks: readonly string[]): number;

export function requireCurrentDocument(
  client: ToolClient,
  options: unknown,
  documents: readonly string[],
  normalizedResult: (value: unknown, operation: string) => unknown,
): Promise<string>;

export function analyzeFixtureProcedure(
  client: ToolClient,
  options: unknown,
  procedure: FixtureProcedure,
  normalizedResult: (value: unknown, operation: string) => unknown,
): Promise<unknown>;
