import { z } from "zod";

/** Provider-neutral input for a function's complete raw instruction list. */
export const functionInstructionInputSchema = z.object({
  procedure: z.string().describe("The procedure name or address"),
  document: z.string().optional().describe("The document name"),
});
