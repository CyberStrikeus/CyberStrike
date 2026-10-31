import { readFileSync } from "node:fs";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { CapabilityDescriptor } from "../../src/application/AnalysisProvider.js";
import type { ToolKind } from "../../src/contracts/toolContractTypes.js";
import type { ToolEffects } from "../../src/contracts/toolEffects.js";

interface GeneratedTool {
  readonly name: string;
  readonly analysisOperation: CapabilityDescriptor["operation"] | null;
  readonly title: string;
  readonly description: string;
  readonly kind: ToolKind;
  readonly requiresSession: boolean;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: ToolAnnotations;
  readonly effects: ToolEffects;
}

interface GeneratedPayload {
  readonly catalog: readonly GeneratedTool[];
}

const generatedPayload: unknown = JSON.parse(
  readFileSync(
    new URL("../../.cache/mcp-tool-catalog.json", import.meta.url),
    "utf8",
  ),
);
if (!isGeneratedPayload(generatedPayload))
  throw new TypeError(
    "Generated MCP catalog payload is invalid; run npm run mcp-catalog:generate",
  );

/** Canonical schemas advertised through the pinned MCP SDK. */
export const GENERATED_MCP_TOOL_CATALOG = generatedPayload.catalog;

function isGeneratedPayload(value: unknown): value is GeneratedPayload {
  return (
    isRecord(value) &&
    Array.isArray(value.catalog) &&
    value.catalog.every(isGeneratedTool)
  );
}

function isGeneratedTool(value: unknown): value is GeneratedTool {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (typeof value.analysisOperation === "string" ||
      value.analysisOperation === null) &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    typeof value.kind === "string" &&
    typeof value.requiresSession === "boolean" &&
    isRecord(value.inputSchema) &&
    isRecord(value.outputSchema) &&
    isRecord(value.annotations) &&
    isRecord(value.effects)
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
