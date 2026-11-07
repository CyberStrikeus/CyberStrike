import { z } from "zod";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const md5 = z.string().regex(/^[a-f0-9]{32}$/u);
const crc32 = z.string().regex(/^[a-f0-9]{8}$/u);

/** A container's claim is distinct from the SHA-256 identity of observed bytes. */
export const artifactIntegrityClaimSchema = z.discriminatedUnion("algorithm", [
  z.strictObject({ algorithm: z.literal("sha256"), digest: sha256 }),
  z.strictObject({ algorithm: z.literal("md5"), digest: md5 }),
]);
export type ArtifactIntegrityClaim = z.infer<
  typeof artifactIntegrityClaimSchema
>;

// Keep existing SHA-256 Evidence and its identities unchanged.
export const artifactSha256PairSchema = z.object({
  declared_sha256: sha256,
  observed_sha256: sha256,
});
export const artifactMd5PairSchema = z.object({
  algorithm: z.literal("md5"),
  declared_md5: md5,
  observed_md5: md5,
});
/**
 * A container's DFU suffix checksum over its own bytes before `dwCRC`: CRC-32
 * without the final inversion, as the suffix stores it.
 */
export const artifactDfuCrc32PairSchema = z.object({
  algorithm: z.literal("dfu-crc32"),
  declared_crc32: crc32,
  observed_crc32: crc32,
});
/** A checksum a container declares over its own bytes, with the observed value. */
export type ArtifactContainerIntegrityPair = z.infer<
  typeof artifactDfuCrc32PairSchema
>;
export type ArtifactIntegrityPair =
  | z.infer<typeof artifactSha256PairSchema>
  | z.infer<typeof artifactMd5PairSchema>
  | ArtifactContainerIntegrityPair;

/** The canonical portable fields shared by inventory and inspection findings. */
export const artifactIntegrityPair = (
  claim: ArtifactIntegrityClaim,
  observed: string,
): ArtifactIntegrityPair =>
  claim.algorithm === "sha256"
    ? { declared_sha256: claim.digest, observed_sha256: observed }
    : { algorithm: "md5", declared_md5: claim.digest, observed_md5: observed };

/** Select only digest facts from an authenticated inventory contradiction. */
export const artifactIntegrityPairOf = (
  pair: ArtifactIntegrityPair,
): ArtifactIntegrityPair => {
  if ("declared_sha256" in pair)
    return {
      declared_sha256: pair.declared_sha256,
      observed_sha256: pair.observed_sha256,
    };
  return pair.algorithm === "md5"
    ? {
        algorithm: pair.algorithm,
        declared_md5: pair.declared_md5,
        observed_md5: pair.observed_md5,
      }
    : {
        algorithm: pair.algorithm,
        declared_crc32: pair.declared_crc32,
        observed_crc32: pair.observed_crc32,
      };
};

export type ArtifactIntegrityDetails = {
  readonly logicalPath: string;
  readonly unpacked: boolean;
} & (
  | {
      readonly declaredSha256: string | null;
      readonly calculatedSha256: string | null;
    }
  | {
      readonly algorithm: "md5";
      readonly declaredMd5: string;
      readonly calculatedMd5: string | null;
    }
  | {
      readonly algorithm: "dfu-crc32";
      readonly declaredCrc32: string;
      readonly calculatedCrc32: string | null;
    }
);

/** Preserve the existing error carrier while naming non-SHA digest algorithms. */
export const artifactIntegrityDetails = (
  logicalPath: string,
  claim: ArtifactIntegrityClaim | null,
  observed: string | null,
  unpacked: boolean,
): ArtifactIntegrityDetails => ({
  logicalPath,
  unpacked,
  ...(claim?.algorithm === "md5"
    ? {
        algorithm: "md5" as const,
        declaredMd5: claim.digest,
        calculatedMd5: observed,
      }
    : { declaredSha256: claim?.digest ?? null, calculatedSha256: observed }),
});

/** Error details for a container checksum that disagrees with its own bytes. */
export const artifactContainerIntegrityDetails = (
  logicalPath: string,
  pair: ArtifactContainerIntegrityPair,
): ArtifactIntegrityDetails => ({
  logicalPath,
  unpacked: false,
  algorithm: pair.algorithm,
  declaredCrc32: pair.declared_crc32,
  calculatedCrc32: pair.observed_crc32,
});

const projectedDigests = (details: ArtifactIntegrityDetails) => {
  if ("declaredSha256" in details)
    return {
      declared_sha256: details.declaredSha256,
      calculated_sha256: details.calculatedSha256,
    };
  return details.algorithm === "md5"
    ? {
        algorithm: details.algorithm,
        declared_md5: details.declaredMd5,
        calculated_md5: details.calculatedMd5,
      }
    : {
        algorithm: details.algorithm,
        declared_crc32: details.declaredCrc32,
        calculated_crc32: details.calculatedCrc32,
      };
};

export const projectArtifactIntegrityDetails = (
  details: ArtifactIntegrityDetails,
) => ({
  logical_path: details.logicalPath,
  ...projectedDigests(details),
  unpacked: details.unpacked,
});
