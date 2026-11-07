import { z } from "zod";

const positiveSafeInteger = z.int().safe().positive();

export const DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS = {
  max_events: 10_000,
  max_event_allocation_bytes: 4 * 1024 * 1024,
  max_total_event_allocation_bytes: 16 * 1024 * 1024,
  max_network_transactions: 1024,
  max_network_body_bytes: 64 * 1024,
  max_network_body_allocation_bytes: 1024 * 1024,
  max_network_header_allocation_bytes: 1024 * 1024,
  max_network_metadata_allocation_bytes: 1024 * 1024,
} as const;

/** Caller-selected retained-output budgets; byte values are allocation-cost estimates. */
export const browserScenarioCaptureLimitsValuesSchema = z.strictObject({
  max_events: positiveSafeInteger,
  max_event_allocation_bytes: positiveSafeInteger,
  max_total_event_allocation_bytes: positiveSafeInteger,
  max_network_transactions: positiveSafeInteger,
  max_network_body_bytes: positiveSafeInteger,
  max_network_body_allocation_bytes: positiveSafeInteger,
  max_network_header_allocation_bytes: positiveSafeInteger,
  max_network_metadata_allocation_bytes: positiveSafeInteger,
});

/** Input budgets default omitted values; output evidence uses the values schema above. */
export const browserScenarioCaptureLimitsSchema =
  browserScenarioCaptureLimitsValuesSchema.extend({
    max_events:
      browserScenarioCaptureLimitsValuesSchema.shape.max_events.default(
        DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS.max_events,
      ),
    max_event_allocation_bytes:
      browserScenarioCaptureLimitsValuesSchema.shape.max_event_allocation_bytes.default(
        DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS.max_event_allocation_bytes,
      ),
    max_total_event_allocation_bytes:
      browserScenarioCaptureLimitsValuesSchema.shape.max_total_event_allocation_bytes.default(
        DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS.max_total_event_allocation_bytes,
      ),
    max_network_transactions:
      browserScenarioCaptureLimitsValuesSchema.shape.max_network_transactions.default(
        DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS.max_network_transactions,
      ),
    max_network_body_bytes:
      browserScenarioCaptureLimitsValuesSchema.shape.max_network_body_bytes.default(
        DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS.max_network_body_bytes,
      ),
    max_network_body_allocation_bytes:
      browserScenarioCaptureLimitsValuesSchema.shape.max_network_body_allocation_bytes.default(
        DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS.max_network_body_allocation_bytes,
      ),
    max_network_header_allocation_bytes:
      browserScenarioCaptureLimitsValuesSchema.shape.max_network_header_allocation_bytes.default(
        DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS.max_network_header_allocation_bytes,
      ),
    max_network_metadata_allocation_bytes:
      browserScenarioCaptureLimitsValuesSchema.shape.max_network_metadata_allocation_bytes.default(
        DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS.max_network_metadata_allocation_bytes,
      ),
  });

export type BrowserScenarioCaptureLimits = z.infer<
  typeof browserScenarioCaptureLimitsValuesSchema
>;
