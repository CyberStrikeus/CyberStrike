import type { RizinInput } from "../domain/reverseEngineering.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";

export const RIZIN_PROVIDER_IDENTITY = {
  id: "rizin",
  name: "Rizin",
  version: null,
} as const;

/** Default one-shot presentation to plain text while retaining plugin availability. */
export const rizinCommand = (input: RizinInput): readonly string[] => [
  "-N",
  "-q",
  "-e",
  "scr.color=0",
  "-c",
  input.command,
  absoluteCallerPath(input.path),
];
