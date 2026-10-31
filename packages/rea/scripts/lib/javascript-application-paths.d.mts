export function assertJavaScriptApplicationInputPaths(
  evidence: {
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly subject: { readonly local_path: string } | null;
    readonly normalized_result: { readonly input_path: string };
  },
  inputPath: string,
): Promise<void>;
