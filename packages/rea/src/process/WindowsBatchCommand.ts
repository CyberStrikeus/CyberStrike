import { win32 } from "node:path";

import { snapshotEnvironment } from "./snapshotEnvironment.js";

/** Why a batch launcher cannot be passed safely to cmd.exe. */
export type WindowsBatchCommandFailure = "invalid_comspec" | "metacharacter";

export class WindowsBatchCommandError extends Error {
  constructor(
    readonly reason: WindowsBatchCommandFailure,
    message: string,
  ) {
    super(message);
    this.name = "WindowsBatchCommandError";
  }
}

/** Exact executable and argv passed to shell-free process creation. */
export interface WindowsBatchCommand {
  readonly command: string;
  /** Pass verbatim: cmd.exe parses this line itself, not by CRT argv rules. */
  readonly arguments: readonly string[];
}

/**
 * Windows runs `.bat` and `.cmd` files only through cmd.exe, so Node rejects
 * them without a shell (CVE-2024-27980).
 */
export const isWindowsBatchFile = (command: string): boolean =>
  /\.(?:bat|cmd)$/iu.test(command);

/**
 * Quote one token for cmd.exe. Tokens that cmd.exe could expand, split or
 * redirect are rejected instead of escaped.
 */
export const quoteWindowsBatchToken = (value: string): string => {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\r") ||
    value.includes("\n") ||
    /["%^!&|<>]/u.test(value)
  )
    throw new WindowsBatchCommandError(
      "metacharacter",
      "Windows batch arguments cannot contain command-interpreter metacharacters",
    );
  return `"${value}"`;
};

/** Run a batch file through an explicit, non-AutoRun cmd.exe invocation. */
export const windowsBatchCommand = (options: {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly batchPath: string;
  readonly arguments: readonly string[];
  readonly comSpec?: string;
}): WindowsBatchCommand => {
  const environment = snapshotEnvironment(options.environment, "win32");
  const systemRoot = environment.SYSTEMROOT;
  const comSpec =
    options.comSpec ??
    environment.COMSPEC ??
    (systemRoot === undefined
      ? "C:\\Windows\\System32\\cmd.exe"
      : win32.join(systemRoot, "System32", "cmd.exe"));
  if (
    !win32.isAbsolute(comSpec) ||
    win32.basename(comSpec).toLowerCase() !== "cmd.exe"
  )
    throw new WindowsBatchCommandError(
      "invalid_comspec",
      "Windows ComSpec must be an absolute cmd.exe path",
    );
  const tokens = [options.batchPath, ...options.arguments].map(
    quoteWindowsBatchToken,
  );
  return {
    command: comSpec,
    arguments: ["/d", "/e:on", "/v:off", "/s", "/c", `"${tokens.join(" ")}"`],
  };
};
