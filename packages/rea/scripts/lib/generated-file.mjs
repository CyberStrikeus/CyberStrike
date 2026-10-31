import { readFile, writeFile } from "node:fs/promises";

const isMissing = (cause) =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  cause.code === "ENOENT";

const normalizeLineEndings = (value) => value.replaceAll("\r\n", "\n");

const preserveLineEndings = (source, existing) =>
  existing?.includes("\r\n") === true
    ? normalizeLineEndings(source).replaceAll("\n", "\r\n")
    : source;

/** Compare or update one generated text artifact with actionable diagnostics. */
export const ensureGeneratedFile = async ({
  path,
  source,
  check,
  generateCommand,
}) => {
  let existing;
  try {
    existing = await readFile(path, "utf8");
  } catch (cause) {
    if (!isMissing(cause)) throw cause;
  }
  if (
    existing !== undefined &&
    normalizeLineEndings(existing) === normalizeLineEndings(source)
  )
    return { changed: false };
  if (check)
    throw new Error(
      `${path} is missing or stale. Run \`${generateCommand}\` to regenerate it; commit the result if the file is tracked.`,
    );
  await writeFile(path, preserveLineEndings(source, existing), "utf8");
  return { changed: true };
};
