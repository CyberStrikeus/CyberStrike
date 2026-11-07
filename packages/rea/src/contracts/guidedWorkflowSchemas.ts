import { z } from "zod";

/** Transport-independent request grammar; rendering never executes a workflow. */
export const guidedWorkflowsInputSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({
    action: z.literal("render"),
    workflow_id: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0)
      .describe("Exact guided workflow identifier from the list result"),
    arguments: z
      .record(z.string(), z.string())
      .optional()
      .describe("Caller-supplied string values for the selected workflow"),
  }),
]);

const guidedWorkflowItemSchema = z.strictObject({
  workflow_id: z.string(),
  description: z.string(),
  arguments: z.array(
    z.strictObject({
      name: z.string(),
      description: z.string(),
      required: z.boolean(),
    }),
  ),
});
// Every alternative is an object; declare that root for older MCP codecs too.
export const guidedWorkflowsOutputSchema = z
  .discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("list"),
      workflows: z.array(guidedWorkflowItemSchema),
    }),
    z.strictObject({
      action: z.literal("render"),
      workflow_id: z.string(),
      rendered_prompt: z.string(),
    }),
  ])
  .meta({ type: "object" });
export type GuidedWorkflowsResult = z.infer<typeof guidedWorkflowsOutputSchema>;
