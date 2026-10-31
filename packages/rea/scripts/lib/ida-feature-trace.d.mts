export function assertFeatureTrace(
  trace: unknown,
  procedure: { readonly address: string },
): void;

export function findMappedNonFunction(
  strings: readonly { readonly address: string }[],
  resolveAt: (address: string) => Promise<unknown>,
): Promise<string | undefined>;
