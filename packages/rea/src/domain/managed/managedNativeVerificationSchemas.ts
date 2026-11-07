import { z } from "zod";

import { emptyArraySchema } from "../emptyArraySchema.js";
import { evidenceSchema } from "../evidence.js";
import { evidenceInputSchema } from "../evidenceReference.js";
import {
  cliMetadataGuidSchema,
  managedNativeImportSchema,
} from "./managedArtifact.js";
import { digestSchema, prefixedDigestSchema } from "../digests.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const textSchema = z.string().min(1);

const nativeSymbolSchema = z.strictObject({
  evidence_id: evidenceIdSchema,
  operation: z.string().min(1),
  name: z.string().min(1),
  address: z.string().nullable(),
  module_name: z.string().nullable(),
  module_path: z.string().nullable(),
  source: z.enum(["macho-export", "function-dossier"]),
});

export type NativeSymbol = z.infer<typeof nativeSymbolSchema>;

const verifiedManagedDeclarationSchema = managedNativeImportSchema
  .pick({
    token: true,
    member_token: true,
    member_name: true,
    import_name: true,
    import_scope_name: true,
    no_mangle: true,
    char_set: true,
    call_convention: true,
  })
  .extend({
    declaration_verification: managedNativeImportSchema.shape.verification,
  })
  .strict();

const pinvokeVerificationContextShape = {
  item_id: prefixedDigestSchema("mnv_pinvoke"),
  managed: verifiedManagedDeclarationSchema,
  evidence_links: z.array(evidenceIdSchema).min(1),
  limitations: z.array(textSchema),
};

const observedCandidatesSchema = z
  .tuple([nativeSymbolSchema], nativeSymbolSchema)
  .check(z.minLength(1));

export const pinvokeVerificationSchema = z.union([
  z.strictObject({
    ...pinvokeVerificationContextShape,
    status: z.literal("verified"),
    basis: z.enum(["exact-export-name", "exact-function-name"]),
    confidence: z.literal("observed"),
    matched_native: nativeSymbolSchema,
    candidates: observedCandidatesSchema,
  }),
  z.strictObject({
    ...pinvokeVerificationContextShape,
    status: z.literal("inferred"),
    basis: z.literal("decorated-name-candidate"),
    confidence: z.literal("inferred"),
    matched_native: nativeSymbolSchema,
    candidates: observedCandidatesSchema,
  }),
  z.strictObject({
    ...pinvokeVerificationContextShape,
    status: z.literal("unresolved"),
    basis: z.enum(["no-native-candidate", "unsupported-native-evidence"]),
    confidence: z.literal("unknown"),
    matched_native: z.null(),
    candidates: emptyArraySchema,
  }),
  z.strictObject({
    ...pinvokeVerificationContextShape,
    status: z.literal("unresolved"),
    basis: z.literal("module-identity-unknown"),
    confidence: z.literal("unknown"),
    matched_native: nativeSymbolSchema,
    candidates: observedCandidatesSchema,
  }),
  z.strictObject({
    ...pinvokeVerificationContextShape,
    status: z.literal("contradicted"),
    basis: z.literal("module-mismatch"),
    confidence: z.literal("unknown"),
    matched_native: nativeSymbolSchema,
    candidates: observedCandidatesSchema,
  }),
]);

export type PinvokeVerification = z.infer<typeof pinvokeVerificationSchema>;

const nativeVerificationShape = <Source extends z.ZodType>(source: Source) => ({
  managed_boundaries: source,
  native_observations: z
    .array(source)
    .min(1)
    .describe("Native function or export Evidence records"),
});

const distinctNativeSources = (
  input: {
    readonly managed_boundaries: { readonly evidence_id: string };
    readonly native_observations: readonly { readonly evidence_id: string }[];
  },
  context: z.RefinementCtx,
): void => {
  // Borrowing frames defer malformed carriers to the semantic source owner.
  if (
    typeof input.managed_boundaries?.evidence_id !== "string" ||
    input.native_observations.some(
      (evidence) => typeof evidence?.evidence_id !== "string",
    )
  )
    return;
  const ids = new Set<string>();
  for (const [index, evidence] of input.native_observations.entries()) {
    if (evidence.evidence_id === input.managed_boundaries.evidence_id)
      context.addIssue({
        code: "custom",
        path: ["native_observations", index],
        message:
          "Native observation Evidence must be distinct from managed boundary Evidence",
      });
    if (ids.has(evidence.evidence_id))
      context.addIssue({
        code: "custom",
        path: ["native_observations", index],
        message: "Native observation Evidence IDs must be unique",
      });
    ids.add(evidence.evidence_id);
  }
};

/** Complete record inputs used by the managed semantic owner and fixture builders. */
export const managedNativeVerificationInputSchema = z
  .strictObject(nativeVerificationShape(evidenceSchema))
  .superRefine(distinctNativeSources);

/** Public workflow sources may be inline records or exact retained identities. */
export const managedNativeVerificationRequestSchema = z
  .strictObject(nativeVerificationShape(evidenceInputSchema))
  .superRefine(distinctNativeSources);

const verificationCoverageSchema = z.strictObject({
  status: z.enum(["complete-within-inputs", "partial"]),
});

/** Provider-neutral managed/native verification result. */
export const managedNativeVerificationResultSchema = z
  .strictObject({
    verification_id: prefixedDigestSchema("mnv"),
    algorithm: z.strictObject({
      name: z.literal("rea-managed-native-verification"),
      token_identity: z.literal("build-local"),
      token_to_address_mapping: z.literal("not-inferred"),
    }),
    managed_boundary: z.strictObject({
      evidence_id: evidenceIdSchema,
      artifact_sha256: digestSchema,
      artifact_path: z.string().min(1),
      mvid: cliMetadataGuidSchema.nullable(),
      metadata_status: z.enum(["absent", "complete", "partial", "malformed"]),
      pinvoke_imports_total: z.int().min(0),
      native_implementations_total: z.int().min(0),
      coverage_state: z.enum(["complete", "partial", "unavailable"]),
    }),
    native_observations: z.strictObject({
      total: z.int().min(1),
      accepted: z.int().min(0),
      unsupported: z.int().min(0),
      symbols: z.int().min(0),
    }),
    summary: z.strictObject({
      verified: z.int().min(0),
      inferred: z.int().min(0),
      unresolved: z.int().min(0),
      contradicted: z.int().min(0),
      native_body_unresolved: z.int().min(0),
    }),
    pinvoke_imports: z.array(pinvokeVerificationSchema),
    native_implementations: z.strictObject({
      runtime_provided: z.int().nonnegative().nullable().default(null),
      unresolved: z.int().min(0),
      reason: textSchema,
    }),
    coverage: verificationCoverageSchema,
    evidence_links: z.array(evidenceIdSchema).min(2),
    limitations: z.array(textSchema),
  })
  .superRefine((result, context) => {
    const observedNativeCount =
      result.native_observations.accepted +
      result.native_observations.unsupported;
    if (observedNativeCount !== result.native_observations.total)
      context.addIssue({
        code: "custom",
        path: ["native_observations"],
        message: "Native observation counts must account for the total input",
      });
    for (const status of [
      "verified",
      "inferred",
      "unresolved",
      "contradicted",
    ] as const)
      if (
        result.summary[status] !==
        result.pinvoke_imports.filter((item) => item.status === status).length
      )
        context.addIssue({
          code: "custom",
          path: ["summary", status],
          message: `P/Invoke ${status} count must match the item results`,
        });
    if (
      result.summary.native_body_unresolved !==
      result.native_implementations.unresolved
    )
      context.addIssue({
        code: "custom",
        path: ["summary", "native_body_unresolved"],
        message: "Native body summary must match unresolved implementations",
      });
  })
  .describe(
    "Counts must agree across the result: native accepted plus unsupported equals total; each P/Invoke summary count equals the number of items with that status; and native_body_unresolved equals native_implementations.unresolved. REA checks these cross-field invariants after constructing the result.",
  );

export type ManagedNativeVerificationResult = z.infer<
  typeof managedNativeVerificationResultSchema
>;
