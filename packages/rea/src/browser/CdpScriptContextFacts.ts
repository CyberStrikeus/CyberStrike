import { z } from "zod";
import {
  cdpStringValue,
  numberValue,
  recordValue,
} from "./CdpCaptureValues.js";

const integer = z.int().min(0);
const contextAuxDataSchema = z
  .object({
    frameId: z.string().optional(),
    isDefault: z.boolean().optional(),
    type: z.string().optional(),
  })
  .passthrough();
const scriptDeclaration = z.object({
  scriptId: z.string(),
  url: z.string(),
  executionContextId: z.number(),
});
const contextDeclaration = z.object({
  id: z.number(),
  origin: z.string().optional(),
  name: z.string().optional(),
  uniqueId: z.string().optional(),
  auxData: contextAuxDataSchema.optional(),
});

/** Active runtime admission retains its required positions and exact auxiliary declarations. */
export const runtimeScriptParsedSchema = scriptDeclaration.extend({
  scriptId: z.string().min(1),
  executionContextId: integer,
  startLine: integer,
  startColumn: integer,
  endLine: integer,
  endColumn: integer,
  hash: z.string().optional(),
  sourceMapURL: z.string().optional(),
  hasSourceURL: z.boolean().optional(),
  scriptLanguage: z.string().optional(),
  executionContextAuxData: contextAuxDataSchema.optional(),
});
export const runtimeContextSchema = z.object({
  context: contextDeclaration.extend({ id: integer }).passthrough(),
});

/** Private storage seeding keeps its original numeric and text admission policy. */
export const storageScriptParsedSchema = scriptDeclaration;
export const storageContextSchema = z.object({
  context: contextDeclaration
    .pick({ id: true, origin: true, name: true, auxData: true })
    .required({ origin: true, name: true })
    .extend({
      auxData: contextAuxDataSchema.pick({ frameId: true }).strip().optional(),
    }),
});
export const storageContextDestroyedSchema = z.object({
  executionContextId: z.number(),
});

/** Narrow frame claims may be retained without borrowing unbounded auxiliary JSON. */
export interface CdpContextFrameClaim {
  readonly state: "missing" | "invalid" | "observed";
  /** Supplied string spelling, including an invalid empty claim, remains available. */
  readonly frameId: string | undefined;
}
export const cdpContextFrameClaim = (
  auxiliary: unknown,
): CdpContextFrameClaim => {
  if (auxiliary === undefined) return { state: "missing", frameId: undefined };
  const value = recordValue(auxiliary);
  if (value === undefined) return { state: "invalid", frameId: undefined };
  if (value.frameId === undefined)
    return { state: "missing", frameId: undefined };
  const frameId = cdpStringValue(value.frameId);
  return {
    state: frameId === undefined || frameId === "" ? "invalid" : "observed",
    frameId,
  };
};

/** Numeric producer identity and the safe integer lookup spelling have distinct policies. */
const contextIdentity = (reported: unknown) => {
  const id = numberValue(reported);
  return {
    id,
    contextKey:
      id !== undefined && Number.isSafeInteger(id) ? String(id) : null,
  };
};

export const readCdpExecutionContextCreated = (params: unknown) => {
  const context = recordValue(recordValue(params)?.context);
  return {
    ...contextIdentity(context?.id),
    name: cdpStringValue(context?.name),
    origin: cdpStringValue(context?.origin),
    frameClaim: cdpContextFrameClaim(context?.auxData),
  };
};
export const readCdpExecutionContextDestroyed = (params: unknown) =>
  contextIdentity(recordValue(params)?.executionContextId);

/** Partial passive observations do not impose the active runtime's required fields. */
export const readCdpScriptParsed = (params: unknown) => {
  const value = recordValue(params);
  const identity = contextIdentity(value?.executionContextId);
  const length = numberValue(value?.length);
  return {
    scriptId: cdpStringValue(value?.scriptId),
    url: cdpStringValue(value?.url),
    contextId: identity.id,
    contextKey: identity.contextKey,
    metadata: {
      hash: cdpStringValue(value?.hash) ?? null,
      length:
        length !== undefined && Number.isSafeInteger(length) && length >= 0
          ? length
          : null,
      isModule: typeof value?.isModule === "boolean" ? value.isModule : null,
      language: cdpStringValue(value?.scriptLanguage) ?? null,
    },
    frameClaim: cdpContextFrameClaim(value?.executionContextAuxData),
    hasSourceUrl:
      typeof value?.hasSourceURL === "boolean" ? value.hasSourceURL : null,
    invalidHasSourceUrl:
      value?.hasSourceURL !== undefined &&
      typeof value.hasSourceURL !== "boolean",
    sourceMapUrl: value?.sourceMapURL,
  };
};
/** Missing claims allow other producer evidence; malformed and conflicting claims never do. */
export const selectCdpScriptFrame = (
  script: CdpContextFrameClaim,
  context: CdpContextFrameClaim | undefined,
): {
  readonly frameId: string | null;
  readonly invalid: boolean;
  readonly conflicting: boolean;
} => {
  const invalid = script.state === "invalid" || context?.state === "invalid";
  const conflicting =
    script.state === "observed" &&
    context?.state === "observed" &&
    script.frameId !== context.frameId;
  return {
    frameId:
      invalid || conflicting
        ? null
        : (script.frameId ?? context?.frameId ?? null),
    invalid,
    conflicting,
  };
};
