/** Emitted NodeNext suffixes and the TypeScript source counterparts they name. */
const EMITTED_SUFFIXES: ReadonlyArray<
  readonly [suffix: string, sourceSuffixes: readonly string[]]
> = [
  [".js", [".ts", ".tsx", ".d.ts"]],
  [".mjs", [".mts", ".d.mts"]],
  [".cjs", [".cts", ".d.cts"]],
  [".jsx", [".tsx", ".d.ts"]],
];

export interface TypeScriptEmittedSourceCandidate {
  readonly path: string;
  readonly kind: "implementation" | "declaration";
}

/**
 * Return TypeScript source counterparts for an explicit emitted filename.
 * Callers retain exact runtime-file precedence and must not use these for
 * directory/index, URL, HTML, or package target resolution.
 */
export const typescriptEmittedSourceCandidates = (
  sourcePath: string,
  candidate: string,
): readonly TypeScriptEmittedSourceCandidate[] => {
  if (!/\.(?:ts|tsx|mts|cts)$/u.test(sourcePath)) return [];
  const emitted = EMITTED_SUFFIXES.find(([suffix]) =>
    candidate.endsWith(suffix),
  );
  if (emitted === undefined) return [];
  // Strip the matched suffix by length. posix.extname would miss dotfile
  // names such as ".js", whose whole basename is the emitted suffix itself.
  const stem = candidate.slice(0, candidate.length - emitted[0].length);
  return emitted[1].map((suffix) => ({
    path: `${stem}${suffix}`,
    kind: suffix.startsWith(".d.") ? "declaration" : "implementation",
  }));
};
