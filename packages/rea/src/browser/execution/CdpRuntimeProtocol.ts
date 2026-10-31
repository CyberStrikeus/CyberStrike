import { z } from "zod";

const integer = z.int().min(0);
const range = z.object({
  startOffset: integer,
  endOffset: integer,
  count: integer,
});
/** CDP precise coverage preserves every nested producer range. */
export const preciseCoverageSchema = z.object({
  timestamp: z.number().min(0),
  result: z.array(
    z.object({
      scriptId: z.string().min(1),
      url: z.string(),
      functions: z.array(
        z.object({
          functionName: z.string(),
          isBlockCoverage: z.boolean(),
          ranges: z.array(range),
        }),
      ),
    }),
  ),
});
/** The full reported synchronous and embedded asynchronous stack is retained. */
export const runtimeStackSchema = z.object({
  callFrames: z.array(
    z.object({
      scriptId: z.string(),
      url: z.string(),
      lineNumber: integer,
      columnNumber: integer,
      functionName: z.string(),
    }),
  ),
  parent: z.unknown().optional(),
  parentId: z
    .object({ id: z.string(), debuggerId: z.string().optional() })
    .optional(),
});
/** Native listener descriptors omit live remote handles from portable evidence. */
export const runtimeListenersSchema = z.object({
  listeners: z.array(
    z.object({
      type: z.string(),
      useCapture: z.boolean(),
      passive: z.boolean(),
      once: z.boolean(),
      scriptId: z.string(),
      lineNumber: integer,
      columnNumber: integer,
    }),
  ),
});
/** Runtime document IDs; frame URLs are interpreted by CdpCaptureDocuments. */
export const runtimeFrameTreeSchema = z.object({
  frameTree: z.object({
    frame: z.object({
      id: z.string().min(1),
      loaderId: z.string().optional(),
    }),
  }),
});
