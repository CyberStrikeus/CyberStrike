import { z } from "zod";

import { jsonValueSchema } from "../jsonValue.js";
import { unknownRelationshipCoverageSchema } from "../relationshipCoverage.js";

/** Hopper bridge page allowance for one procedure in a caller scan. */
export const HOPPER_CALLER_PAGE_ALLOWANCE_BYTES = 512 * 1024;

/** Encoded scan facts retained for one reconciliation. */
export const HOPPER_CALLER_SCAN_RETENTION_BYTES = 4 * 1024 * 1024;

const hopperCallerScanStopSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("complete") }),
  z.strictObject({
    code: z.literal("work_budget"),
    budget_ms: z.int().positive(),
  }),
  z.strictObject({ code: z.literal("inventory_changed") }),
  z.strictObject({
    code: z.literal("page_allowance"),
    allowance_bytes: z.literal(HOPPER_CALLER_PAGE_ALLOWANCE_BYTES),
  }),
  z.strictObject({
    code: z.literal("retention_budget"),
    allowance_bytes: z.literal(HOPPER_CALLER_SCAN_RETENTION_BYTES),
  }),
  z.strictObject({ code: z.literal("cancelled") }),
  z.strictObject({ code: z.literal("page_failure") }),
  z.strictObject({ code: z.literal("invalid_page") }),
  z.strictObject({ code: z.literal("invalid_progress") }),
]);

/** Structured progress for one Hopper caller scan, separate from its wording. */
export const hopperCallerScanFactsSchema = z.strictObject({
  examined_procedures: z.int().nonnegative(),
  procedure_total: z.int().nonnegative().nullable(),
  retained_bytes: z.int().nonnegative(),
  stop: hopperCallerScanStopSchema,
  instructions_complete: z.boolean(),
  native_callers_complete: z.boolean().nullable(),
});

export type HopperCallerScanFacts = z.infer<typeof hopperCallerScanFactsSchema>;
export type HopperCallerScanStop = HopperCallerScanFacts["stop"];

/** Counts collected before instruction and native-caller flags are known. */
export type HopperCallerScanCounts = Omit<
  HopperCallerScanFacts,
  "instructions_complete" | "native_callers_complete"
>;

/** Native reply and forward scan facts retained when reconciliation stops. */
export const hopperCallerReconciliationPartialSchema = z.strictObject({
  kind: z.literal("hopper-caller-reconciliation"),
  native_result: jsonValueSchema,
  scan: hopperCallerScanFactsSchema.nullable(),
  forward_destinations: jsonValueSchema.nullable(),
  unread_page: jsonValueSchema.optional(),
  coverage: unknownRelationshipCoverageSchema,
});

export type HopperCallerReconciliationPartial = z.infer<
  typeof hopperCallerReconciliationPartialSchema
>;

const stopDetail = (stop: HopperCallerScanStop): string => {
  switch (stop.code) {
    case "complete":
      return "";
    case "work_budget":
      return `the ${String(stop.budget_ms)} ms reconciliation work budget was reached`;
    case "inventory_changed":
      return "the procedure inventory changed during reconciliation";
    case "page_allowance":
      return `a single procedure exceeded the ${String(HOPPER_CALLER_PAGE_ALLOWANCE_BYTES)} byte page allowance`;
    case "retention_budget":
      return `the ${String(stop.allowance_bytes)} byte reconciliation retention budget was reached`;
    case "cancelled":
      return "cancellation was observed after completed scan observations";
    case "page_failure":
      return "a later scan page failed";
    case "invalid_page":
      return "a scan page reply did not match the scan schema";
    case "invalid_progress":
      return "a scan page reported inconsistent progress";
  }
};

/** Wording for scan facts. Tests compare this formatter and the facts separately. */
export const formatHopperCallerScanReason = (
  facts: HopperCallerScanFacts,
): string => {
  const total =
    facts.procedure_total === null ? "unknown" : String(facts.procedure_total);
  const detail = stopDetail(facts.stop);
  let reason = `Hopper caller reconciliation examined ${String(facts.examined_procedures)} of ${total} procedures and retained ${String(facts.retained_bytes)} encoded bytes${detail === "" ? "" : `; ${detail}`}. Forward and reverse API coverage and consistency during the live scan remain unknown.`;
  if (!facts.instructions_complete)
    reason += ` Target instruction enumeration reached the ${String(HOPPER_CALLER_PAGE_ALLOWANCE_BYTES)} byte allowance; incoming call-site coverage is incomplete.`;
  if (facts.native_callers_complete === false)
    reason += ` Native caller enumeration reached the ${String(HOPPER_CALLER_PAGE_ALLOWANCE_BYTES)} byte allowance.`;
  return reason;
};
