/** One contextBridge exposure method and its API argument positions. */
export interface JavaScriptContextBridgeExposureArguments<Argument> {
  readonly world: "main" | "isolated";
  readonly worldId: Argument | null | undefined;
  readonly worldIdIndex: number | null;
  readonly apiKey: Argument | undefined;
  readonly api: Argument | undefined;
}

/**
 * Select the semantic arguments for a contextBridge exposure method.
 * Callers retain authority over callee identity and interpretation of values.
 */
export const contextBridgeExposureArguments = <Argument>(
  method: string,
  arguments_: readonly Argument[],
): JavaScriptContextBridgeExposureArguments<Argument> | undefined => {
  if (method === "exposeInMainWorld")
    return {
      world: "main",
      worldId: null,
      worldIdIndex: null,
      apiKey: arguments_[0],
      api: arguments_[1],
    };
  if (method === "exposeInIsolatedWorld")
    return {
      world: "isolated",
      worldId: arguments_[0],
      worldIdIndex: 0,
      apiKey: arguments_[1],
      api: arguments_[2],
    };
  return undefined;
};
