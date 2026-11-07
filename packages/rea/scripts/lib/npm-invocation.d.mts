/** Preserve the caller's npm entry and arguments without invoking a shell. */
export function npmInvocation(
  arguments_: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv>,
): { readonly command: string; readonly arguments: readonly string[] };
