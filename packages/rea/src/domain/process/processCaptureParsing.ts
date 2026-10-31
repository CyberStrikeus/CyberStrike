import { z } from "zod";

import { processCaptureSchema } from "./processCapture.js";

declare const processCaptureProof: unique symbol;
const verifiedProcessCaptureSchema =
  processCaptureSchema.brand<typeof processCaptureProof>();

/** Semantically verified process capture value. */
export type ProcessCapture = z.output<typeof verifiedProcessCaptureSchema>;

/** Parse a boundary value while retaining Zod's expected validation failure. */
export const safeParseProcessCapture = (input: unknown) =>
  verifiedProcessCaptureSchema.safeParse(input);

/**
 * Parse unknown input and reject invalid commitments or semantics. Failures
 * throw the schema's ZodError so structural and semantic issues stay together.
 */
export const parseProcessCapture = (input: unknown): ProcessCapture =>
  verifiedProcessCaptureSchema.parse(input);
