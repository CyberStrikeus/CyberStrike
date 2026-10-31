import { dirname, join } from "node:path";

/** Preserve the caller's npm entry and arguments without invoking a shell. */
export const npmInvocation = (arguments_, environment) => {
  const selectedEntry = environment.npm_execpath;
  if (
    selectedEntry !== undefined &&
    (typeof selectedEntry !== "string" || selectedEntry.length === 0)
  )
    throw new Error("npm_execpath must name the selected npm CLI entry point");
  const entry =
    selectedEntry ??
    (process.platform === "win32"
      ? join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
      : undefined);
  return entry === undefined
    ? { command: "npm", arguments: arguments_ }
    : { command: process.execPath, arguments: [entry, ...arguments_] };
};
