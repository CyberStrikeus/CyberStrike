import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { appendCallerPath } from "../filesystem/callerPath.js";

/** Standard executable names and locations used to discover Homebrew. */
const HOMEBREW_COMMANDS = [
  "brew",
  "/opt/homebrew/bin/brew",
  "/usr/local/bin/brew",
] as const;

/**
 * Return the first defined result from standard Homebrew executables.
 * A probe returning `undefined` means that location was unavailable or failed;
 * other falsy values are successful results and stop discovery.
 */
export const probeHomebrew = async <T>(
  probe: (command: string) => Promise<T | undefined>,
): Promise<T | undefined> => {
  for (const command of HOMEBREW_COMMANDS) {
    const result = await probe(command);
    if (result !== undefined) return result;
  }
  return undefined;
};

const caskDirectoriesSchema = z
  .object({ appdir: z.string().min(1).optional() })
  .loose();
const caskConfigSchema = z
  .object({
    default: caskDirectoriesSchema.optional(),
    env: caskDirectoriesSchema.optional(),
    explicit: caskDirectoriesSchema.optional(),
  })
  .loose();

/**
 * Read the application directory Homebrew recorded when it installed a cask,
 * in Homebrew's precedence: explicit option, then environment, then default.
 * Reading the Caskroom avoids `brew` cask commands, which refresh Homebrew's
 * API and bootsnap caches.
 */
export const installedCaskAppdir = async (
  caskroom: string,
  token: string,
  home: string,
): Promise<string | undefined> => {
  let text: string;
  try {
    text = await readFile(
      join(caskroom, token, ".metadata", "config.json"),
      "utf8",
    );
  } catch (cause: unknown) {
    // An absent or unreadable receipt means the cask is not installed here.
    void cause;
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause: unknown) {
    // A malformed receipt does not identify an application directory.
    void cause;
    return undefined;
  }
  const config = caskConfigSchema.safeParse(parsed);
  if (!config.success) return undefined;
  const appdir =
    config.data.explicit?.appdir ??
    config.data.env?.appdir ??
    config.data.default?.appdir;
  if (appdir === undefined) return undefined;
  return appdir.startsWith("~/")
    ? appendCallerPath(home, appdir.slice(2))
    : appdir;
};
