/**
 * Validate optional source-map content against its source inventory.
 *
 * ECMA-426 DecodeSourceMapSources reads a content slot only while its index is
 * within `sourcesContent`, so a shorter array leaves trailing sources without
 * content and a longer array contributes no extra sources. Only the entry types
 * are checked here.
 */
export const hasValidSourceMapContents = (contents: unknown): boolean =>
  contents === undefined ||
  contents === null ||
  (Array.isArray(contents) &&
    contents.every(
      (content: unknown) => content === null || typeof content === "string",
    ));
