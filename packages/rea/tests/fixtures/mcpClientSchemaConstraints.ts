import { geminiUnsupportedLiteral } from "../../scripts/lib/gemini-schema-literals.mjs";
import { clientSchemaPositions } from "../../scripts/lib/client-schema-positions.mjs";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** VS Code Copilot rejects falsy `items` for any type that admits arrays. */
export const arrayItemSchemaError = (
  schema: unknown,
  path: string,
): string | undefined => {
  for (const position of clientSchemaPositions(schema)) {
    if (position.kind !== "schema") continue;
    const value = position.schema;
    const admitsArrays =
      value.type === "array" ||
      (Array.isArray(value.type) && value.type.includes("array"));
    if (admitsArrays && !value.items)
      return `${path}${position.path.slice(1)}: tool parameters array type must have items`;
  }
  return undefined;
};

/** Reject Gemini-incompatible boolean and empty-string input literals. */
export const unsupportedInputLiteralSchemaError = (
  schema: unknown,
  path: string,
): string | undefined => {
  const finding = geminiUnsupportedLiteral(schema);
  if (finding === undefined) return undefined;
  const reason =
    finding.reason === "boolean"
      ? finding.keyword === "const"
        ? "is boolean"
        : "contains a boolean"
      : finding.keyword === "const"
        ? "is an empty string"
        : "contains an empty string";
  return `${path}${finding.path.slice(1)} ${reason}`;
};

/**
 * Gemini function declarations accept `items` only on a schema whose type is
 * the single `array` type (`items: field predicate failed: $type ==
 * Type.ARRAY`), and strict gateways drop untyped item unions. Return every
 * advertised position with either shape so a catalog test names them all.
 */
export const strictGatewayItemSchemaErrors = (
  schema: unknown,
  path = "$",
): readonly string[] => {
  const errors: string[] = [];
  for (const position of clientSchemaPositions(schema)) {
    if (position.kind !== "schema") continue;
    const value = position.schema;
    const selectedPath = `${path}${position.path.slice(1)}`;
    if (value.items !== undefined && value.type !== "array")
      errors.push(
        `${selectedPath}.items is beside type ${JSON.stringify(value.type)}`,
      );
    const items = value.items;
    if (
      value.type === "array" &&
      isRecord(items) &&
      items.type === undefined &&
      (Array.isArray(items.oneOf) || Array.isArray(items.anyOf))
    )
      errors.push(`${selectedPath}.items is an untyped union`);
  }
  return errors;
};
