/**
 * Public contract shape for `inspect_apk_signature` and the pure signing
 * posture derivation. The domain owns the schema so CLI and MCP present
 * identical, validated facts. Certificate facts are plain data extracted by the
 * adapter (via the platform X.509 parser); this module never parses DER itself.
 */
import { z } from "zod";

import type { EvidenceSubjectTarget } from "../evidence.js";
import { digestSchema as digest } from "../digests.js";

/**
 * A signer certificate. `sha256_fingerprint` is always SHA-256 over the raw
 * embedded DER (exactly what apksig/apksigner hash); the parsed X.509 facts are
 * individually null when the platform parser cannot read the DER. The whole
 * object is null only when the signer carries no certificate at all.
 */
const certificate = z
  .strictObject({
    sha256_fingerprint: digest,
    subject: z.string().nullable(),
    issuer: z.string().nullable(),
    serial_number: z.string().nullable(),
    /** ISO 8601. */
    not_before: z.string().nullable(),
    /** ISO 8601. */
    not_after: z.string().nullable(),
    public_key_algorithm: z.string().nullable(),
  })
  .nullable();

const digestEntry = z.strictObject({
  uninterpreted_bytes: z.int().nonnegative(),
  signature_algorithm_id: z.int().min(0).max(0xffffffff),
  algorithm: z.enum(["sha256", "sha512", "verity-sha256", "unknown"]),
  declared_digest_hex: z.string().regex(/^(?:[a-f0-9]{2})*$/),
  /**
   * Whether the DECLARED content digest equals the digest recomputed over the
   * current bytes; null when not recomputed. Not a signature verification:
   * anyone who changes the bytes can recompute and replace the declared digest.
   */
  matches_apk: z.boolean().nullable(),
});

export const apkSignerSchema = z.strictObject({
  uninterpreted_signed_data_bytes: z.int().nonnegative(),
  uninterpreted_signer_bytes: z.int().nonnegative(),
  certificate,
  digests: z.array(digestEntry),
  signatures: z.array(
    z.strictObject({
      signature_algorithm_id: z.int().min(0).max(0xffffffff),
      algorithm: digestEntry.shape.algorithm,
      signature_bytes: z.int().nonnegative(),
      uninterpreted_bytes: z.int().nonnegative(),
    }),
  ),
  public_key_bytes: z.int().nonnegative(),
  min_sdk: z.number().int().nullable(),
  max_sdk: z.number().int().nullable(),
});

const lineageNode = z.strictObject({
  certificate,
  /**
   * Raw capability flags RETAINED by this node's own certificate after the
   * rotation (kept raw so unknown future bits are preserved).
   */
  flags: z.number().int().nonnegative(),
  capabilities: z.strictObject({
    installed_data: z.boolean(),
    shared_uid: z.boolean(),
    permission: z.boolean(),
    rollback: z.boolean(),
    auth: z.boolean(),
  }),
});

export const apkSignerV3Schema = apkSignerSchema.extend({
  /**
   * The proof-of-rotation lineage the APK DECLARES, oldest signer first. Node
   * signatures are not verified. `decode_error` is set (and `lineage` empty)
   * when the attribute is present but could not be decoded.
   */
  rotation: z.strictObject({
    present: z.boolean(),
    lineage: z.array(lineageNode),
    decode_error: z.string().nullable(),
  }),
});

/**
 * A v1 (JAR) signer: one signature block, its `.SF` partner and what the
 * block's PKCS#7 SignedData declares. Nothing is verified.
 */
const v1Signer = z.strictObject({
  signature_file: z.string(),
  block_file: z.string(),
  /**
   * The certificate the block's one SignerInfo names (by issuerAndSerialNumber
   * or subjectKeyIdentifier), with the same facts as a v2/v3 signer. Null when
   * the block could not be decoded, has other than one SignerInfo, or its
   * SignerInfo names no certificate the block carries (identity unknown).
   */
  certificate,
  /** Every certificate the SignedData carries, in block order. */
  certificates: z.array(
    z.strictObject({
      sha256_fingerprint: digest,
      subject: z.string().nullable(),
    }),
  ),
  signer_infos: z.array(
    z.strictObject({
      identified_by: z.enum(["issuer-and-serial", "subject-key-identifier"]),
      /** The named certificate's fingerprint; null when none in the block matches. */
      certificate_sha256: digest.nullable(),
      digest_algorithm_oid: z.string(),
      signature_algorithm_oid: z.string(),
    }),
  ),
  /** Why the block could not be read (malformed, unsupported or over a bound); never silently empty. */
  decode_error: z.string().nullable(),
});

const SCHEME = z.enum(["none", "v1", "v2", "v3", "v3.1"]);

export const apkSignatureResultSchema = z.strictObject({
  artifact: z.strictObject({
    path: z.string().min(1),
    sha256: digest,
    bytes: z.number().int().nonnegative(),
  }),
  schemes: z.strictObject({
    v1: z.strictObject({
      /** Structural: META-INF signature files exist (not platform applicability). */
      present: z.boolean(),
      has_manifest: z.boolean(),
      signature_files: z.array(z.string()),
      block_files: z.array(z.string()),
      /** Signature blocks paired with their `.SF` file, in central-directory order. */
      signers: z.array(v1Signer),
    }),
    v2: z.strictObject({
      present: z.boolean(),
      signers: z.array(apkSignerSchema),
      uninterpreted_bytes: z.int().nonnegative(),
    }),
    v3: z.strictObject({
      present: z.boolean(),
      signers: z.array(apkSignerV3Schema),
      uninterpreted_bytes: z.int().nonnegative(),
    }),
    "v3.1": z.strictObject({
      present: z.boolean(),
      signers: z.array(apkSignerV3Schema),
      uninterpreted_bytes: z.int().nonnegative(),
    }),
  }),
  /**
   * The source stamp the APK declares (V2 block preferred over V1, as apksig
   * does). `certificate` is the declared stamp certificate; it is null when no
   * stamp is present or when `decode_error` says why it could not be read.
   * Stamp signatures are not verified.
   */
  source_stamp: z.strictObject({
    present: z.boolean(),
    certificate,
    decode_error: z.string().nullable(),
  }),
  /** Derived from the observed and declared facts above; not separately observed. */
  posture: z.strictObject({
    /**
     * v1 present and no v2/v3/v3.1 block. The v1 X-Android-APK-Signed marker
     * is not read, so this cannot distinguish a v1-only APK from one whose
     * v2/v3 block was removed.
     */
    v1_only: z.boolean(),
    /**
     * Observed: every present block scheme (v2/v3/v3.1) presents the same set
     * of signer certificates. Null when no block scheme has a signer, or when
     * any signer carries no certificate (identity unknown).
     */
    schemes_agree_on_signer: z.boolean().nullable(),
    /**
     * Declared: the signers differ, but every one appears in a rotation
     * lineage the APK declares. Unverified — an APK can declare any lineage.
     * Null when a signer's identity is unknown, or when the signers differ and
     * a declared lineage could not be decoded.
     */
    signer_change_declared_by_rotation: z.boolean().nullable(),
    /**
     * Observed: the set of v1 signer certificates equals what the lowest
     * present block scheme with signers (v2, else v3, else v3.1) expects v1 to
     * carry: its signer set, or, for a v3/v3.1 signer that declares a rotation
     * lineage, that lineage's first (original) certificate, as apksig requires.
     * False is notable: the JAR signature names a different key. Null when v1
     * or a block scheme is absent, any signer's identity is unknown
     * (including a v1 SignerInfo identified by subjectKeyIdentifier, which
     * apksig cannot resolve), or a declared lineage's original certificate
     * cannot be identified (a limitation then says why).
     */
    v1_signers_match_block_signers: z.boolean().nullable(),
    rotation_present: z.boolean(),
    source_stamp_present: z.boolean(),
    strongest_scheme: SCHEME,
    /**
     * Every recomputed declared content digest equals the current bytes; null
     * when none was recomputed. Not a signature verification.
     */
    self_consistent: z.boolean().nullable(),
  }),
  runtime_execution: z.literal("not-performed"),
});
export type ApkSignatureResult = z.infer<typeof apkSignatureResultSchema>;

/** Counts disjoint unparsed suffixes; it does not classify their validity or meaning. */
export const apkSignatureUninterpretedBytes = (
  report: ApkSignatureResult,
): number => {
  let total = 0;
  for (const scheme of [
    report.schemes.v2,
    report.schemes.v3,
    report.schemes["v3.1"],
  ]) {
    total += scheme.uninterpreted_bytes;
    for (const signer of scheme.signers)
      total +=
        signer.uninterpreted_signed_data_bytes +
        signer.uninterpreted_signer_bytes +
        signer.digests.reduce(
          (n, record) => n + record.uninterpreted_bytes,
          0,
        ) +
        signer.signatures.reduce(
          (n, record) => n + record.uninterpreted_bytes,
          0,
        );
  }
  return total;
};

export const APK_SIGNATURE_LIMITATIONS: readonly string[] = [
  "Static structural inspection only. No Android code executes, no device or adb is involved, and odex/vdex/oat/cdex are not read.",
  "No signature is verified: signer, rotation-lineage and source-stamp signatures are NOT cryptographically checked, and certificate chains, revocation and authenticity are NOT evaluated. Certificates and lineages are what the APK declares.",
  "matches_apk and self_consistent only show that the declared content digest equals the digest of the current bytes. This is not a signature verification: anyone who changes the bytes can recompute the digest and write it into the signed data. SHA-256 identifies the exact bytes, not the producer.",
  "v1 signers are what each signature block's outer PKCS#7 SignedData declares. Signer unsigned attributes, including nested signatures and timestamps, are not decoded; signatures, the .SF and MANIFEST.MF digests and entry coverage are NOT verified.",
  "Not read: v4 .apk.idsig, verity digests (matches_apk null), and the v1 X-Android-APK-Signed marker, so v1_only cannot distinguish a v1-only APK from one whose v2/v3 block was removed.",
];

/** A block-scheme signer's declared rotation lineage, oldest certificate first. */
export type ApkPostureLineage =
  | { readonly kind: "absent" }
  | {
      readonly kind: "decoded";
      /** Per node, its certificate fingerprint; `null` when unknown. */
      readonly fingerprints: readonly (string | null)[];
    }
  | { readonly kind: "undecoded" };

/** One block-scheme signer as the posture derivation sees it. */
export interface ApkPostureSigner {
  /** `null` for a signer that carries no certificate (identity unknown). */
  readonly fingerprint: string | null;
  readonly lineage: ApkPostureLineage;
}

export type ApkBlockScheme = "v2" | "v3" | "v3.1";

/** Inputs to the pure posture derivation (scheme presence + agreement facts). */
export interface ApkPostureInput {
  readonly v1Present: boolean;
  readonly v2Present: boolean;
  readonly v3Present: boolean;
  readonly v31Present: boolean;
  readonly sourceStampPresent: boolean;
  /** Per present block scheme, lowest first, its signers. */
  readonly blockSchemes: readonly {
    readonly scheme: ApkBlockScheme;
    readonly signers: readonly ApkPostureSigner[];
  }[];
  /** Per v1 signer, the certificate its SignerInfo names; `null` when unknown. */
  readonly v1SignerFingerprints: readonly (string | null)[];
  readonly selfConsistent: boolean | null;
}

/** The posture plus why a derived fact stayed unknown, where it is not self-evident. */
export interface ApkPostureDerivation {
  readonly posture: ApkSignatureResult["posture"];
  readonly notes: readonly string[];
}

const setKey = (fingerprints: readonly string[]): string =>
  [...new Set(fingerprints)].sort().join(",");

/** Unknown signer identity or an undecoded lineage can hide the answer. */
const signerChangeDeclared = (
  signerSetsDiffer: boolean | null,
  signers: ReadonlySet<string>,
  lineage: ReadonlySet<string>,
  lineageUnknown: boolean,
): boolean | null => {
  if (signerSetsDiffer === null) return null;
  if (!signerSetsDiffer || signers.size <= 1) return false;
  if ([...signers].every((fp) => lineage.has(fp))) return true;
  return lineageUnknown ? null : false;
};

type Expected =
  | { readonly ok: true; readonly fingerprint: string | null }
  | { readonly ok: false; readonly reason: string };

/**
 * The certificate v1 is expected to carry for one signer of the lowest block
 * scheme. A v3/v3.1 signer that declares a lineage rotated away from the key
 * v1 (and v2) keep, so apksig requires the v1 signer to be the lineage's first
 * node; without a lineage it requires the v3 signer itself.
 */
const expectedV1Certificate = (
  scheme: ApkBlockScheme,
  signer: ApkPostureSigner,
): Expected => {
  if (
    signer.fingerprint === null ||
    scheme === "v2" ||
    signer.lineage.kind === "absent"
  )
    return { ok: true, fingerprint: signer.fingerprint };
  if (signer.lineage.kind === "undecoded")
    return {
      ok: false,
      reason: `the ${scheme} signer's declared rotation lineage could not be decoded`,
    };
  const origin = signer.lineage.fingerprints[0];
  return origin === undefined || origin === null
    ? {
        ok: false,
        reason: `the ${scheme} signer's declared rotation lineage names no readable original certificate`,
      }
    : { ok: true, fingerprint: origin };
};

/** v1 against what the lowest block scheme with signers expects; unknown stays unknown. */
const v1MatchesBlockSigners = (
  v1: readonly (string | null)[],
  lowest: ApkPostureInput["blockSchemes"][number] | undefined,
): { readonly match: boolean | null; readonly notes: readonly string[] } => {
  if (v1.length === 0 || lowest === undefined || lowest.signers.length === 0)
    return { match: null, notes: [] };
  const notes = new Set<string>();
  if (v1.includes(null))
    notes.add(
      "v1_signers_match_block_signers is null: one or more v1 signer identities are unknown; inspect the v1 signer records for details.",
    );
  const expected: (string | null)[] = [];
  for (const signer of lowest.signers) {
    const one = expectedV1Certificate(lowest.scheme, signer);
    if (!one.ok) {
      notes.add(
        `v1_signers_match_block_signers is null: ${one.reason}, so the original certificate v1 is expected to carry is unknown.`,
      );
      continue;
    }
    if (one.fingerprint === null)
      notes.add(
        `v1_signers_match_block_signers is null: one or more ${lowest.scheme} signer identities are unknown; inspect the block signer records for details.`,
      );
    expected.push(one.fingerprint);
  }
  if (notes.size > 0) return { match: null, notes: [...notes] };
  return {
    match:
      setKey(v1 as readonly string[]) === setKey(expected as readonly string[]),
    notes: [],
  };
};

/** Derive the conservative signing posture from observed and declared scheme facts. */
export const deriveApkPosture = (
  input: ApkPostureInput,
): ApkPostureDerivation => {
  const blockPresent = input.v2Present || input.v3Present || input.v31Present;
  const strongest = input.v31Present
    ? "v3.1"
    : input.v3Present
      ? "v3"
      : input.v2Present
        ? "v2"
        : input.v1Present
          ? "v1"
          : "none";
  const present = input.blockSchemes.filter(({ scheme }) =>
    scheme === "v2"
      ? input.v2Present
      : scheme === "v3"
        ? input.v3Present
        : input.v31Present,
  );
  const sets = present.map(({ signers }) =>
    signers.map(({ fingerprint }) => fingerprint),
  );
  // A signer without a certificate has unknown identity: agreement is unknown,
  // never assumed.
  const identityUnknown = sets.some((fps) => fps.includes(null));
  const known = sets.map((fps) =>
    fps.filter((fp): fp is string => fp !== null),
  );
  const union = new Set(known.flat());
  const signerSetsDiffer = identityUnknown
    ? null
    : new Set(known.map(setKey)).size > 1;
  const lineages = present.flatMap(({ signers }) =>
    signers.map(({ lineage }) => lineage),
  );
  const lineage = new Set(
    lineages.flatMap((l) =>
      l.kind === "decoded"
        ? l.fingerprints.filter((fp): fp is string => fp !== null)
        : [],
    ),
  );
  const v1Match = input.v1Present
    ? v1MatchesBlockSigners(
        input.v1SignerFingerprints,
        present.find(({ signers }) => signers.length > 0),
      )
    : { match: null, notes: [] };
  return {
    posture: {
      v1_only: input.v1Present && !blockPresent,
      schemes_agree_on_signer:
        union.size === 0 || signerSetsDiffer === null
          ? null
          : !signerSetsDiffer,
      signer_change_declared_by_rotation: signerChangeDeclared(
        signerSetsDiffer,
        union,
        lineage,
        lineages.some((l) => l.kind === "undecoded"),
      ),
      v1_signers_match_block_signers: v1Match.match,
      rotation_present: lineages.some((l) => l.kind !== "absent"),
      source_stamp_present: input.sourceStampPresent,
      strongest_scheme: strongest,
      self_consistent: input.selfConsistent,
    },
    notes: v1Match.notes,
  };
};

/** Match semantic artifact identity; local subject paths are delivery metadata. */
export const apkSignatureMatchesSubject = (
  artifact: ApkSignatureResult["artifact"],
  subject: Pick<EvidenceSubjectTarget, "sha256" | "format">,
): boolean =>
  artifact.sha256 === subject.sha256 &&
  (subject.format === "file" ||
    subject.format === "apk" ||
    subject.format === "zip");
