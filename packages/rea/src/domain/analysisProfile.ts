import { z } from "zod";

import { digestCanonicalValue } from "./canonicalDigest.js";
import { jsonObjectSchema, type JsonValue } from "./jsonValue.js";
import { digestSchema } from "./../domain/digests.js";

/** Concrete provider identity committed by an analysis profile. */
export const committedProviderSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
});

const unsignedAnalysisProfileSchema = z.strictObject({
  provider: committedProviderSchema,
  parameters: jsonObjectSchema,
});

/** Canonical, provider-neutral commitment to analysis-affecting semantics. */
export const analysisProfileSchema = unsignedAnalysisProfileSchema
  .extend({ digest: digestSchema })
  .superRefine((profile, context) => {
    const { digest: _digest, ...unsigned } = profile;
    if (profileDigest(unsigned) !== profile.digest)
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Analysis profile digest does not match its parameters",
      });
  });

export type CommittedProviderIdentity = z.infer<typeof committedProviderSchema>;
export type AnalysisProfileCommitment = z.infer<typeof analysisProfileSchema>;

/** Create a validated RFC 8785 profile commitment at a provider boundary. */
export const createAnalysisProfile = (
  provider: CommittedProviderIdentity,
  parameters: Readonly<Record<string, JsonValue>>,
): AnalysisProfileCommitment => {
  const unsigned = unsignedAnalysisProfileSchema.parse({
    provider: {
      id: provider.id,
      name: provider.name,
      version: provider.version,
    },
    parameters,
  });
  return analysisProfileSchema.parse({
    ...unsigned,
    digest: profileDigest(unsigned),
  });
};

/** Exact provider identity, including unknown Evidence versions, without interpreting parameters. */
export const committedProvidersEqual = (
  left: Readonly<{ id: string; name: string; version: string | null }>,
  right: Readonly<{ id: string; name: string; version: string | null }>,
): boolean =>
  left.id === right.id &&
  left.name === right.name &&
  left.version === right.version;

/** Compare two already-validated commitments without interpreting parameters. */
export const analysisProfilesEqual = (
  left: AnalysisProfileCommitment,
  right: AnalysisProfileCommitment,
): boolean =>
  left.digest === right.digest &&
  committedProvidersEqual(left.provider, right.provider);

const profileDigest = (
  profile: z.infer<typeof unsignedAnalysisProfileSchema>,
): string => digestCanonicalValue(profile, "Analysis profile");
