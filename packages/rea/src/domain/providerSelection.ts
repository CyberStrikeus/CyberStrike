import { z } from "zod";

/** Stable provider identifier accepted at CLI, MCP, and environment boundaries. */
export const analysisProviderIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9\x2d]*$/u)
  .refine((value) => value !== "auto", {
    message: "auto is reserved for provider selection",
  });

/** Explicit provider ID or the deterministic automatic-selection policy. */
export const analysisProviderSelectorSchema = z.union([
  z.literal("auto"),
  analysisProviderIdSchema,
]);

/** Stable reasons a deep provider cannot participate in target selection. */
export const PROVIDER_REJECTION_CODES = [
  "not_configured",
  "executable_missing",
  "runtime_missing",
  "runtime_unavailable",
  "unsupported_host",
  "unsupported_version",
  "target_kind_unsupported",
  "target_format_unsupported",
  "architecture_unsupported",
  "target_role_unsupported",
  "managed_target_unsupported",
  "open_options_invalid",
  "version_unresolved",
] as const;

export type AnalysisProviderSelector = z.infer<
  typeof analysisProviderSelectorSchema
>;

/** Stable reason a deep provider cannot participate in target selection. */
export type ProviderRejectionCode = (typeof PROVIDER_REJECTION_CODES)[number];
