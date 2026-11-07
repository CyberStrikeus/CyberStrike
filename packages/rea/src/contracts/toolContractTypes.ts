import type { z } from "zod";

import type { JsonValue } from "../domain/jsonValue.js";
import type { DerivedToolAnnotations, ToolEffects } from "./toolEffects.js";

/** One validated example request for an MCP tool contract. */
export interface ToolExample {
  readonly title: string;
  readonly input: Readonly<Record<string, JsonValue>>;
}

/** Canonical adapter families responsible for public MCP tools. */
export const TOOL_KINDS = [
  "official-proxy",
  "enhanced",
  "native-provider",
  "artifact-provider",
  "managed-provider",
  "android-provider",
  "apktool-provider",
  "flutter-provider",
  "jeb-provider",
  "adb-provider",
  "firmware-provider",
  "browser-provider",
  "electron-provider",
  "runtime-provider",
  "pcap-provider",
  "application",
  "session",
] as const;

/** Adapter family responsible for implementing a public MCP tool. */
export type ToolKind = (typeof TOOL_KINDS)[number];

/** Single source of truth for a public MCP tool. */
export interface ToolContract<
  Name extends string = string,
  InputSchema extends z.ZodType<Readonly<Record<string, unknown>>> = z.ZodType<
    Readonly<Record<string, unknown>>
  >,
  OutputSchema extends z.ZodType<Readonly<Record<string, unknown>>> = z.ZodType<
    Readonly<Record<string, unknown>>
  >,
> {
  readonly name: Name;
  readonly title: string;
  readonly description: string;
  readonly kind: ToolKind;
  /** This handler dispatches through the active binary-analysis session. */
  readonly requiresActiveTarget?: boolean;
  /** Adapter delivery of a retained summary; detail never reaches analysis. */
  readonly retainedSummary?: {
    readonly evidenceParameters: "omit-detail" | "preserve-detail";
  };
  readonly inputSchema: InputSchema;
  readonly outputSchema: OutputSchema;
  readonly effects: ToolEffects;
  readonly annotations: DerivedToolAnnotations;
  /**
   * Results, successful or failed, can contain text that originates from the
   * analysis target. MCP delivery marks such results as untrusted data.
   */
  readonly returnsTargetContent: boolean;
  readonly examples: readonly ToolExample[];
}
