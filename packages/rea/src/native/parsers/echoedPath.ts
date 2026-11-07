/**
 * Remove the header line dyld_info prints before a slice's output:
 * `<path>:`, `<path> (architecture <arch>):`, or `<path> [<arch>]:`. File
 * names may contain line breaks and tool keywords, so only the exact operand
 * path is stripped; output without that header is returned unchanged.
 */
export const withoutEchoedPathHeader = (
  output: string,
  path: string | undefined,
): string => {
  if (path === undefined || !output.startsWith(path)) return output;
  const header = /^(?: \(architecture [^)\n]*\)| \[[^\]\n]*\])?:\r?\n/u.exec(
    output.slice(path.length),
  );
  return header === null
    ? output
    : output.slice(path.length + header[0].length);
};
