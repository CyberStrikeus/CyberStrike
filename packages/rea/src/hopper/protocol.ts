import { z } from "zod";

import {
  HopperProtocolError,
  HopperRemoteError,
} from "../domain/hopperErrors.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import { safeParseJson } from "../domain/safeJson.js";

const remoteErrorSchema = z
  .object({
    code: z.int(),
    message: z.string(),
    type: z
      .enum([
        "remote",
        "authorization",
        "invalid_request",
        "capability_unavailable",
        "bridge_exception",
      ])
      .default("remote"),
  })
  .strict();

const responseSchema = z.union([
  z
    .object({
      id: z.int().nonnegative(),
      result: jsonValueSchema,
    })
    .strict(),
  z
    .object({
      id: z.int().nonnegative(),
      error: remoteErrorSchema,
    })
    .strict(),
]);

const eventSchema = z
  .object({
    id: z.int().nonnegative(),
    event: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("progress"),
          phase: z.string().min(1),
          completed: z.number().nonnegative().finite(),
          total: z.number().nonnegative().finite().nullable(),
          message: z.string().min(1),
          terminal: z.boolean().optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("diagnostic"),
          error: remoteErrorSchema,
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((message, context) => {
    if (
      message.event.type === "progress" &&
      message.event.total !== null &&
      message.event.completed > message.event.total
    ) {
      context.addIssue({
        code: "custom",
        message: "Progress total cannot be less than completed",
        path: ["event", "total"],
      });
    }
  });

const messageSchema = z.union([responseSchema, eventSchema]);

export type HopperResponse = z.infer<typeof responseSchema>;
export type HopperBridgeEvent = z.infer<typeof eventSchema>;
export type HopperBridgeMessage = z.infer<typeof messageSchema>;

/** Parse one complete Hopper NDJSON response or event line. */
export const parseBridgeMessageLine = (
  line: string,
): Result<HopperBridgeMessage, HopperProtocolError> => {
  const decodedResult = safeParseJson(line);
  if (!decodedResult.ok)
    return err(
      new HopperProtocolError("Hopper returned malformed JSON", {
        cause: decodedResult.cause,
      }),
    );
  const decoded: unknown = decodedResult.value;

  const parsed = messageSchema.safeParse(decoded);
  return parsed.success
    ? ok(parsed.data)
    : err(
        new HopperProtocolError(
          "Hopper returned a message outside the bridge contract",
          { cause: parsed.error },
        ),
      );
};

/** Project a parsed response into its result or expected remote failure. */
export const responseResult = (
  response: HopperResponse,
): Result<JsonValue, HopperRemoteError> =>
  "error" in response
    ? err(
        new HopperRemoteError(response.error.code, response.error.message, {
          diagnosticType: response.error.type,
        }),
      )
    : ok(response.result);
