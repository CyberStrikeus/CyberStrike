import { basename } from "node:path";

/** Match process-table command text while handling macOS executable-name normalization. */
export const matchesOwnedProcessCommand = (
  actual: string,
  expected: string,
  platform: NodeJS.Platform = process.platform,
): boolean => {
  const actualCommand = actual.trim();
  const expectedCommand = expected.trim();
  if (
    actualCommand === expectedCommand ||
    actualCommand.startsWith(`${expectedCommand} `)
  )
    return true;
  if (platform !== "darwin") return false;
  const actualExecutable = actualCommand.split(/\s+/u, 1)[0];
  const expectedExecutable = expectedCommand.split(/\s+/u, 1)[0];
  const normalizedActualExecutable =
    actualExecutable?.startsWith("(") === true && actualExecutable.endsWith(")")
      ? actualExecutable.slice(1, -1)
      : actualExecutable;
  return (
    normalizedActualExecutable !== undefined &&
    expectedExecutable !== undefined &&
    basename(normalizedActualExecutable) === basename(expectedExecutable)
  );
};
