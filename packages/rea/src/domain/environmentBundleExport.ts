import { z } from "zod";

import { environmentCoverageSchema } from "./analysisView/environmentCoverageView.js";
import { TEMPLATE_RULES } from "./analysisView/environmentManifestRules.js";
import { prefixedDigestSchema } from "./digests.js";
import { retainedEvidenceReferenceSchema } from "./evidenceReference.js";
import { absoluteLocalPathStringSchema } from "./localPath.js";

/** Capture Evidence retained in this session, or one capture Evidence file on this host. */
const environmentCaptureSourceSchema = z.discriminatedUnion("kind", [
  retainedEvidenceReferenceSchema.describe(
    "Capture Evidence this session retained, such as a capture_browser_scenario or inspect_web_network_capture result.",
  ),
  z.strictObject({
    kind: z.literal("evidence-file"),
    path: absoluteLocalPathStringSchema.describe(
      "Absolute path of one capture Evidence JSON file, copied byte for byte into the bundle.",
    ),
  }),
]);

export const exportEnvironmentBundleInputSchema = z.strictObject({
  source: environmentCaptureSourceSchema.describe(
    "The capture the environment is built from: capture_browser_scenario Evidence, or HAR inspect_web_network_capture Evidence.",
  ),
  output_directory: absoluteLocalPathStringSchema.describe(
    "Absolute, absent output directory for the bundle folder; parent must exist.",
  ),
  name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Env folder and env id (kebab-case). Default: the manifest's name; required when the capture's origin is a loopback or IP address.",
    ),
  template_rules: z
    .array(z.enum(TEMPLATE_RULES))
    .optional()
    .describe(
      "Opt-in template rules, each at most once; [] applies only the format rules. Default: after-uid-literal, opaque-token, sibling-variance and prefix-variance.",
    ),
  package_tarball: absoluteLocalPathStringSchema
    .optional()
    .describe(
      "Absolute path of a packed rea-agents tarball the bundle installs instead of the registry package of this version.",
    ),
  dry_run: z
    .boolean()
    .default(false)
    .describe("Report what the bundle would hold without writing anything."),
});
export type ExportEnvironmentBundleInput = z.infer<
  typeof exportEnvironmentBundleInputSchema
>;

/** What a built or planned bundle serves and holds; environment-build prints the same report. */
export const environmentBuildReportSchema = z.strictObject({
  status: z.enum(["built", "planned"]),
  directory: z.string().nullable(),
  name: z.string(),
  capture: z.strictObject({
    evidence_id: prefixedDigestSchema("ev"),
    operation: z.string(),
    records: z.int().nonnegative(),
    input: z.enum(["har", "evidence"]),
  }),
  manifest: z.strictObject({
    evidence_id: prefixedDigestSchema("ev"),
    tools: z.int().nonnegative(),
    excluded_groups: z.int().nonnegative(),
    template_rules: z.array(z.enum(TEMPLATE_RULES)),
  }),
  state: z
    .union([
      z.strictObject({
        served: z.literal(true),
        evidence_id: z.string(),
      }),
      z.strictObject({
        served: z.literal(false),
        reason: z.literal("unavailable"),
        code: z.string(),
        message: z.string(),
      }),
    ])
    .describe(
      "Whether the bundle serves from the derived state, or replays and why.",
    ),
  coverage: environmentCoverageSchema
    .nullable()
    .describe(
      "Read tools answered from the state or replayed, and write tools served or withheld; null when the bundle serves replay.",
    ),
  tool_count: z.int().nonnegative(),
  package_source: z.union([
    z.strictObject({ kind: z.literal("registry"), specifier: z.string() }),
    z.strictObject({ kind: z.literal("tarball"), path: z.string() }),
  ]),
  files: z.array(
    z.strictObject({ path: z.string(), bytes: z.int().nonnegative() }),
  ),
  warnings: z.array(
    z.strictObject({
      code: z.enum([
        "name-from-file",
        "credential-named-members",
        "credential-scan-incomplete",
        "credential-named-saved-values",
      ]),
      message: z.string(),
      pointers: z
        .array(z.string())
        .describe(
          "Where the warning applies, such as record pointers; never values.",
        ),
    }),
  ),
  next: z.array(z.string()),
});
export type EnvironmentBuildReport = z.infer<
  typeof environmentBuildReportSchema
>;
