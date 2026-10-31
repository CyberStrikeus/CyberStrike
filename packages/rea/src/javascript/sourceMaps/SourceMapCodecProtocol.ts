import { z } from "zod";
import {
  webSourceMapReportSchema,
  webSourcePositionSchema,
} from "../../domain/webSourceLocation.js";

/** Trusted codec process input; captured application code is never evaluated. */
export const sourceMapCodecInputSchema = z.strictObject({
  text: z.string(),
  url: z.string().min(1),
  position: webSourcePositionSchema,
});

/** Codec success or a specific producer/resource constraint. */
export const sourceMapCodecReplySchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("success"),
    report: webSourceMapReportSchema,
  }),
  z.strictObject({
    state: z.literal("failure"),
    reason: z.enum(["format", "unsupported", "limit"]),
    message: z.string(),
  }),
]);
