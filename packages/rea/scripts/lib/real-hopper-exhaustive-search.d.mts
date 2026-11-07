interface ToolClient {
  callTool(request: unknown, options: unknown): Promise<unknown>;
}

interface SearchSummary {
  readonly count: number;
  readonly calls: 1;
}

export function openAndVerifyLargeFixture(input: {
  readonly client: ToolClient;
  readonly options: unknown;
  readonly normalizedResult: (value: unknown, operation: string) => unknown;
  readonly path: string;
  readonly expectedCount: number;
  readonly symbolPrefix: string;
  readonly stringPrefix: string;
}): Promise<{
  readonly procedures: SearchSummary;
  readonly strings: SearchSummary;
}>;
