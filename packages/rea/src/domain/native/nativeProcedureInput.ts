import { z } from "zod";

/** Selected procedure for function dossier and native API analysis. */
export const nativeProcedureInputSchema = z.strictObject({
  procedure: z.string().describe("A procedure name or address"),
});
