import { clientSchemaPositions } from "./client-schema-positions.mjs";

/** Check forwarded regex constraints in native plain/Unicode/Unicode-sets modes. */
export const assertClientSchemaPatterns = (
  schema: unknown,
): readonly string[] => {
  const patterns: string[] = [];
  for (const position of clientSchemaPositions(schema)) {
    const pattern =
      position.kind === "pattern-property"
        ? position.pattern
        : position.kind === "keyword" &&
            position.keyword === "pattern" &&
            typeof position.value === "string"
          ? position.value
          : undefined;
    if (pattern === undefined) continue;
    for (const flags of ["", "u", "v"]) new RegExp(pattern, flags);
    patterns.push(pattern);
  }
  return patterns;
};
