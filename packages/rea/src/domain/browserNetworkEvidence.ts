import { createHash } from "node:crypto";
import { z } from "zod";

export const PLAYWRIGHT_RESPONSE_BODY_PROVENANCE_LIMITATION =
  "Captured response-body bytes are the result of Playwright's Response.body() API. Playwright may satisfy that API with a credentialed follow-up load of the request URL when CDP has no body, so transaction and event links do not verify that retained bytes came from the original network transaction.";

/** Resolved network content selection recorded by a capture. */
export const browserNetworkContentSelectionValuesSchema = z.strictObject({
  request_body: z.boolean(),
  response_body: z.boolean(),
  header_values: z.boolean(),
});

/** Caller omission selects metadata alone; individual content facets remain optional. */
export const browserNetworkContentSelectionSchema =
  browserNetworkContentSelectionValuesSchema
    .extend({
      request_body: z.boolean().default(false),
      response_body: z.boolean().default(false),
      header_values: z.boolean().default(false),
    })
    .default({
      request_body: false,
      response_body: false,
      header_values: false,
    });

/** Self-verifying retained bytes, after any declared-secret redaction. */
const unavailableBrowserNetworkBodySchema = z.discriminatedUnion("reason", [
  z.strictObject({
    state: z.literal("unavailable"),
    reason: z.enum([
      "request-failed",
      "response-unfinished",
      "body-read-failed",
      "body-read-timeout",
      "cancelled",
      "capture-ended",
    ]),
    message: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("unavailable"),
    reason: z.literal("body-size-limit"),
    message: z.string().min(1),
    limit_bytes: z.int().positive().safe(),
    observed_bytes: z.int().positive().safe(),
  }),
  z.strictObject({
    state: z.literal("unavailable"),
    reason: z.literal("body-allocation-limit"),
    message: z.string().min(1),
    limit_allocation_bytes: z.int().positive().safe(),
    observed_allocation_bytes: z.int().positive().safe(),
  }),
]);

export const browserNetworkBodySchema = z.union([
  z.strictObject({ state: z.literal("not_requested") }),
  z.strictObject({ state: z.literal("not_exposed") }),
  unavailableBrowserNetworkBodySchema,
  z
    .strictObject({
      state: z.literal("captured"),
      representation: z.enum([
        "browser-exposed-request-bytes",
        "playwright-response-body-bytes",
        // Retained for captures produced before response-body provenance was
        // narrowed to the bytes Playwright exposes through Response.body().
        "browser-decoded-response-bytes",
      ]),
      encoding: z.literal("base64"),
      content: z.string(),
      bytes: z.int().min(0),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      media_type: z.string().nullable(),
      redacted: z.boolean(),
    })
    .superRefine((artifact, context) => {
      const bytes = Buffer.from(artifact.content, "base64");
      if (bytes.toString("base64") !== artifact.content)
        context.addIssue({
          code: "custom",
          path: ["content"],
          message: "Network body must use canonical base64",
        });
      if (bytes.length !== artifact.bytes)
        context.addIssue({
          code: "custom",
          path: ["bytes"],
          message: "Network body byte count disagrees with retained bytes",
        });
      if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256)
        context.addIssue({
          code: "custom",
          path: ["sha256"],
          message: "Network body digest disagrees with retained bytes",
        });
    }),
]);

/** Headers retain producer order and duplicates, with credential values removed. */
export const browserNetworkHeadersSchema = z.union([
  z.strictObject({ state: z.literal("not_requested") }),
  z.strictObject({
    state: z.literal("unavailable"),
    message: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("captured"),
    items: z.array(
      z.strictObject({
        name: z.string().min(1),
        value: z.string().nullable(),
        redacted: z.boolean(),
      }),
    ),
  }),
]);

export type BrowserNetworkContentSelection = z.infer<
  typeof browserNetworkContentSelectionSchema
>;
export type BrowserNetworkBody = z.infer<typeof browserNetworkBodySchema>;
export type BrowserNetworkHeaders = z.infer<typeof browserNetworkHeadersSchema>;
