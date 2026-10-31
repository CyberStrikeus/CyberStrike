export interface OpenAiModelFixture {
  readonly baseUrl: string;
  readonly requests: readonly { readonly path: string }[];
  readonly probes: readonly {
    readonly path: string | undefined;
    readonly status: 404;
  }[];
  readonly failure: string | undefined;
  close(): Promise<void>;
}

export function createOpenAiModelFixture(options: {
  readonly directory: string;
  readonly prefix: string;
  readonly onRequest: () =>
    | {
        readonly role: "assistant";
        readonly content: string;
      }
    | Promise<{ readonly role: "assistant"; readonly content: string }>;
}): Promise<OpenAiModelFixture>;
