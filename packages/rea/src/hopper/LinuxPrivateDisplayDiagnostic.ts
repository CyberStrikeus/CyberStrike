import { z } from "zod";

import {
  DEFAULT_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
  HOPPER_DEMO_DIALOG_TIMEOUT_SETTING,
  isHopperStartupFailureCode,
  MAXIMUM_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
  MINIMUM_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
  type HopperStartupDiagnostic,
} from "../domain/hopperStartupFailure.js";
import { safeParseJson } from "../domain/safeJson.js";

export const LINUX_PRIVATE_DISPLAY_DIAGNOSTIC_PREFIX = "REA_X11_DIAGNOSTIC=";

const diagnosticContextSchema = z.object({
  component: z.literal("hopper_private_display"),
  operation: z.enum(["probe", "launch"]),
  reason: z.string().regex(/^[a-z0-9_]+$/u),
  socket_directory: z.literal("/tmp/.X11-unix"),
  socket_directory_mode: z
    .string()
    .regex(/^[0-7]{4}$/u)
    .nullable(),
  mount_read_only: z.boolean().nullable(),
  effective_socket_directory_mode: z
    .string()
    .regex(/^[0-7]{4}$/u)
    .nullable(),
  effective_mount_read_only: z.boolean().nullable(),
  wsl: z.boolean(),
  strategy: z.enum(["direct", "user-mount-namespace", "unavailable"]),
  fallback_reason: z
    .string()
    .regex(/^[a-z0-9_]+$/u)
    .nullable(),
  xvfb_stderr_bytes: z.int().nonnegative().safe(),
});

const dialogTimeoutSchema = z
  .object({
    setting: z.literal(HOPPER_DEMO_DIALOG_TIMEOUT_SETTING),
    value: z.string().max(128),
    source: z.literal("setting"),
    minimum_ms: z.literal(MINIMUM_HOPPER_DEMO_DIALOG_TIMEOUT_MS),
    maximum_ms: z.literal(MAXIMUM_HOPPER_DEMO_DIALOG_TIMEOUT_MS),
    default_ms: z.literal(DEFAULT_HOPPER_DEMO_DIALOG_TIMEOUT_MS),
  })
  .strict();

const failureCodeSchema = z.string().transform((value, context) => {
  if (isHopperStartupFailureCode(value)) return value;
  context.addIssue({
    code: "custom",
    message: "Unknown startup failure code",
  });
  return z.NEVER;
});

const diagnosticSchema = z.discriminatedUnion("status", [
  diagnosticContextSchema
    .extend({ status: z.literal("ready"), failure_code: z.null() })
    .strict(),
  diagnosticContextSchema
    .extend({
      status: z.literal("error"),
      failure_code: failureCodeSchema,
      dialog_timeout: dialogTimeoutSchema.optional(),
    })
    .strict(),
]);

export type LinuxPrivateDisplayDiagnosticParse =
  | { readonly ok: true; readonly value: HopperStartupDiagnostic }
  | {
      readonly ok: false;
      readonly reason:
        | "diagnostic_missing"
        | "diagnostic_multiple"
        | "diagnostic_malformed";
    };

/** Parse exactly one helper diagnostic from stderr. */
export const parseLinuxPrivateDisplayDiagnostic = (
  stderr: string,
): LinuxPrivateDisplayDiagnosticParse => {
  const records = stderr
    .split("\n")
    .filter((line) => line.startsWith(LINUX_PRIVATE_DISPLAY_DIAGNOSTIC_PREFIX));
  if (records.length === 0) return { ok: false, reason: "diagnostic_missing" };
  if (records.length !== 1) return { ok: false, reason: "diagnostic_multiple" };
  const record = records[0];
  if (record === undefined) return { ok: false, reason: "diagnostic_missing" };
  const decoded = safeParseJson(
    record.slice(LINUX_PRIVATE_DISPLAY_DIAGNOSTIC_PREFIX.length),
  );
  if (!decoded.ok) return { ok: false, reason: "diagnostic_malformed" };
  const parsed = diagnosticSchema.safeParse(decoded.value);
  if (!parsed.success) return { ok: false, reason: "diagnostic_malformed" };
  const value = parsed.data;
  if (value.status === "error" && value.dialog_timeout === undefined) {
    const { dialog_timeout: _omitted, ...diagnostic } = value;
    return { ok: true, value: diagnostic };
  }
  return { ok: true, value };
};
