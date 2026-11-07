import { clientSchemaPositions } from "./client-schema-positions.mjs";

export interface GeminiUnsupportedLiteral {
  readonly path: string;
  readonly keyword: "const" | "enum";
  readonly reason: "boolean" | "empty-string";
}

/** Gemini's declaration policy, including schemas selected by resolved local references. */
export const geminiUnsupportedLiteral = (
  schema: unknown,
): GeminiUnsupportedLiteral | undefined => {
  for (const position of clientSchemaPositions(schema)) {
    if (position.kind !== "keyword") continue;
    const { keyword, value, path } = position;
    if (keyword === "const") {
      if (typeof value === "boolean")
        return { path, keyword, reason: "boolean" };
      if (value === "") return { path, keyword, reason: "empty-string" };
    } else if (keyword === "enum" && Array.isArray(value)) {
      if (value.some((item) => typeof item === "boolean"))
        return { path, keyword, reason: "boolean" };
      if (value.includes("")) return { path, keyword, reason: "empty-string" };
    }
  }
  return undefined;
};
