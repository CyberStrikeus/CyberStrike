import { z } from "zod";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { AnalysisProtocolError } from "../domain/analysisErrorCore.js";

/** Normalize an IDA hexadecimal coordinate without passing through a JavaScript number. */
export const idaAddressSchema = z
  .string()
  .regex(/^(?:0x)?[0-9a-f]+$/iu)
  .transform(
    (value) =>
      `0x${BigInt(value.startsWith("0x") || value.startsWith("0X") ? value : `0x${value}`).toString(16)}`,
  );

/**
 * Function identity only. Upstream size is an enclosing span, not body coverage;
 * retain it in the raw observation rather than requiring it for identity.
 */
export const idaFunctionSchema = z.union([
  z.object({
    address: idaAddressSchema,
    name: z.string().min(1),
  }),
  z
    .object({
      addr: idaAddressSchema,
      name: z.string().min(1),
    })
    .transform(({ addr, ...rest }) => ({ address: addr, ...rest })),
]);
export type IdaFunction = z.infer<typeof idaFunctionSchema>;

/** Legacy metadata describes the recorded input, whereas modern health names live paths. */
export const legacyMetadataSchema = z
  .object({
    path: z.string().min(1),
    module: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/iu),
    base: idaAddressSchema,
  })
  .passthrough();
/** A worker that is still busy right after opening reports this transient shape instead of its identity. */
export const busyHealthSchema = z
  .object({
    status: z.literal("busy"),
    busy_tool: z.string().optional(),
  })
  .passthrough();
export const modernHealthSchema = z
  .object({
    status: z.literal("ok"),
    input_path: z.string().min(1),
    idb_path: z.string().nullable(),
    imagebase: idaAddressSchema,
    auto_analysis_ready: z.boolean().nullable(),
    module: z.string(),
  })
  .passthrough();

/** An upstream cursor must either finish or advance strictly to avoid replay loops. */
export const cursorSchema = z.union([
  z.object({ next: z.int().nonnegative() }),
  z.object({ done: z.literal(true) }),
]);
/** Both legacy pages and modern cursors must finish or advance strictly. */
export const nextPageOffset = (
  next: number | null,
  current: number,
): number | null => {
  if (next !== null && next <= current)
    throw new AnalysisProtocolError(
      "IDA MCP pagination did not advance its offset.",
    );
  return next;
};
export const nextOffset = (
  cursor: z.infer<typeof cursorSchema>,
  current: number,
): number | null =>
  nextPageOffset("done" in cursor ? null : cursor.next, current);

export const legacyPageSchema = z.object({
  data: z.array(jsonValueSchema),
  next_offset: z.int().nonnegative().nullable(),
});
export const modernPageSchema = z.array(legacyPageSchema).length(1);

const modernLookupRowSchema = z.object({
  query: z.string(),
  fn: idaFunctionSchema.nullable(),
  error: z.string().nullable(),
});
export const modernLookupBatchSchema = z.array(modernLookupRowSchema);
export const modernLookupSchema = modernLookupBatchSchema.length(1);

const instructionSchema = z.union([
  z.object({
    address: idaAddressSchema,
    instruction: z.string(),
    comments: z.array(z.string()).nullish(),
  }),
  z
    .object({
      addr: idaAddressSchema,
      instruction: z.string(),
      comments: z.array(z.string()).nullish(),
    })
    .transform(({ addr, ...rest }) => ({ address: addr, ...rest })),
]);
export const disassemblySchema = z.object({
  name: z.string(),
  start_ea: idaAddressSchema,
  lines: z.array(instructionSchema),
  return_type: z.string().nullish(),
  arguments: z
    .array(z.object({ name: z.string(), type: z.string() }))
    .nullish(),
});
export type IdaDisassembly = z.infer<typeof disassemblySchema>;
export const modernDisassemblySchema = z.object({
  asm: disassemblySchema.nullable(),
  error: z.string().optional(),
  cursor: cursorSchema,
});
export const modernDecompileSchema = z.object({
  code: z.string().nullable(),
  error: z.string().optional(),
  cursor: cursorSchema,
  line_count: z.int().nonnegative().optional(),
  total_lines: z.int().nonnegative().optional(),
});

export const legacyStringSchema = z.object({
  address: idaAddressSchema,
  string: z.string(),
  length: z.int().nonnegative(),
});
export const idaStringsPageSchema = z.object({
  matches: z.array(z.object({ addr: idaAddressSchema, string: z.string() })),
  cursor: cursorSchema,
  error: z.string().nullish(),
});
export const legacyXrefsSchema = z.array(
  z.object({
    address: idaAddressSchema,
    type: z.string(),
    function: idaFunctionSchema.nullable(),
  }),
);
export const modernXrefsSchema = z
  .array(
    z.object({
      xrefs: z
        .array(
          z.object({
            addr: idaAddressSchema,
            type: z.string(),
            fn: idaFunctionSchema.nullable(),
          }),
        )
        .nullable(),
      error: z.string().optional(),
      more: z.boolean().optional(),
    }),
  )
  .length(1);
export const modernCalleesSchema = z
  .array(
    z.object({
      callees: z
        .array(
          z.object({
            addr: idaAddressSchema,
            name: z.string(),
            type: z.enum(["internal", "external"]),
          }),
        )
        .nullable(),
      error: z.string().optional(),
      more: z.boolean().optional(),
    }),
  )
  .length(1);
/** Depth-one `callgraph` reply: one row per root, with function-only call edges. */
export const modernCallGraphSchema = z
  .array(
    z
      .object({
        root: z.string(),
        error: z.string().optional(),
        nodes: z.array(
          z.object({ addr: idaAddressSchema, name: z.string().nullable() }),
        ),
        edges: z.array(
          z.object({
            from: idaAddressSchema,
            to: idaAddressSchema,
            type: z.string(),
          }),
        ),
        truncated: z.boolean().optional(),
        limit_reason: z.string().nullable().optional(),
        max_edges_per_func: z.int().positive().optional(),
        per_func_capped: z.boolean().optional(),
      })
      .passthrough(),
  )
  .length(1);
export const legacyCalleesSchema = z.array(
  z.object({ address: idaAddressSchema, name: z.string() }).passthrough(),
);

/** Parsed database lifecycle observations retain explicit ownership information. */
export const openDatabaseSchema = z
  .object({
    success: z.literal(true),
    session: z
      .object({ session_id: z.string().min(1), input_path: z.string().min(1) })
      .passthrough(),
  })
  .passthrough();
/** Only an explicit completed rejection preserves legacy no-worker cleanup. */
export const rejectedOpenDatabaseSchema = z
  .object({
    error: z.string().min(1),
    success: z.never().optional(),
  })
  .passthrough();

export const databaseListSchema = z
  .object({
    sessions: z.array(
      z
        .object({
          session_id: z.string(),
          input_path: z.string(),
          owned: z.boolean(),
          backend: z.enum(["worker", "gui"]),
          is_active: z.boolean(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export const closeDatabaseSchema = z
  .object({
    success: z.literal(true),
    session_id: z.string(),
    saved: z.boolean().nullable().optional(),
    owned: z.boolean(),
    backend: z.enum(["worker", "gui"]),
  })
  .passthrough();
/** Supervisor response when the requested worker was already reaped. */
export const absentDatabaseCloseSchema = (sessionId: string) =>
  z
    .object({ error: z.literal(`Session not found: ${sessionId}`) })
    .passthrough();

// Piped, so a malformed coordinate is a schema issue and never reaches BigInt.
const hexCoordinate = z
  .string()
  .regex(/^0x[0-9a-f]+$/iu)
  .pipe(z.transform((value) => BigInt(value)));

/**
 * The minimal `survey_binary` reply, reduced to validated segment intervals
 * (exclusive ends). Any malformed, reversed or inconsistent fact rejects the
 * whole reply, because a membership answer needs every segment.
 */
export const surveySegmentsSchema = z
  .object({
    statistics: z
      .object({ total_segments: z.int().nonnegative().optional() })
      .passthrough()
      .optional(),
    segments: z
      .array(
        z
          .object({
            start: hexCoordinate,
            end: hexCoordinate,
            size: hexCoordinate.optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough()
  .superRefine(({ statistics, segments }, context) => {
    if (
      statistics?.total_segments !== undefined &&
      statistics.total_segments !== segments.length
    )
      context.addIssue({
        code: "custom",
        message: "survey segment count disagrees with its statistics",
      });
    for (const { start, end, size } of segments) {
      // A malformed row has already reported its own issue; refinements still run.
      if (typeof start !== "bigint" || typeof end !== "bigint") continue;
      if (start >= end || (size !== undefined && size !== end - start))
        context.addIssue({
          code: "custom",
          message: "survey segment bounds are reversed or inconsistent",
        });
    }
  });
