import { createHash } from "node:crypto";
import { apkSignatureAdmission } from "./ApkSignatureAdmission.js";

import { createAnalysisExecution } from "../application/AnalysisProvider.js";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type {
  ApkSignatureExecution,
  ApkSignaturePort,
} from "../application/apkSignature/ApkSignaturePort.js";
import { readStableArtifact } from "../artifacts/readStableArtifact.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  assertArtifactReadActive,
  bindArtifactFileCleanup,
} from "../artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  APK_BLOCK_ID,
  locateApkSigningBlock,
  parseZipTail,
  type ApkSigningBlock,
  type ZipTail,
} from "../domain/apkSignature/apkSigningBlock.js";
import {
  contentDigestAlgorithm,
  decodeRotationLineage,
  decodeSigners,
  decodeSourceStampCertificate,
  PROOF_OF_ROTATION_ATTR_ID,
  type ApkLineageNode,
  type ApkSchemeError,
  type ApkSchemeVersion,
  type ApkSigner,
} from "../domain/apkSignature/apkSignatureSchemes.js";
import {
  APK_SIGNATURE_LIMITATIONS,
  deriveApkPosture,
  apkSignatureUninterpretedBytes,
  type ApkPostureSigner,
  type ApkSignatureResult,
} from "../domain/apkSignature/apkSignatureReport.js";
import {
  computeApkContentDigest,
  type HashFactory,
} from "../domain/apkSignature/apkContentDigest.js";
import {
  centralDirectoryV1SignatureEntries,
  detectV1Signature,
  MAX_V1_SIGNERS,
  type ApkDuplicateName,
  type ApkDuplicateNameSample,
  type ApkDuplicateNames,
  type ApkV1Signature,
} from "../domain/apkSignature/apkV1Signature.js";
import { err, ok, type Result } from "../domain/result.js";
import { zipPackageFormatForPath } from "../domain/zipPackageFormat.js";
import {
  apkOutputBudgetError,
  apkSignatureFailure,
  mapApkBlockError,
  mapApkSchemeError,
  mapCentralDirectoryError,
  v1SignerCapacityError,
} from "./apkSignatureFailures.js";
import {
  APK_SIGNATURE_LIMITS,
  APK_SIGNATURE_PROVIDER_IDENTITY,
} from "./ApkSignatureRelease.js";
import {
  certificateBytes,
  certificateFacts,
  jsonStringBytes,
} from "./apkCertificateFacts.js";
import {
  decodeV1Signer,
  projectedV1SignerBytes,
  v1PostureFingerprint,
  v1SignerFacts,
  v1SignerNotes,
  type DecodedV1Signer,
} from "./apkV1Signers.js";

const OPERATION = "inspect_apk_signature";

type Signer = ApkSignatureResult["schemes"]["v2"]["signers"][number];
type SignerV3 = ApkSignatureResult["schemes"]["v3"]["signers"][number];

/** Compares a signed digest with the recomputed content digest; null when not computable. */
interface DigestMatcher {
  readonly match: (algorithmId: number, signed: Uint8Array) => boolean | null;
  /** True once a SHA-256/512 digest was requested but the layout prevented recomputing it. */
  readonly layoutPreventedRecompute: () => boolean;
}

const nodeHash: HashFactory = (algorithm) => {
  const hash = createHash(algorithm);
  return {
    update: (data) => {
      hash.update(data);
    },
    digest: () => new Uint8Array(hash.digest()),
  };
};

/** Recompute each content digest at most once per algorithm, lazily. */
const digestMatcher = (
  bytes: Uint8Array,
  tail: ZipTail,
  blockStart: number | null,
): DigestMatcher => {
  const cache = new Map<"sha256" | "sha512", Uint8Array | null>();
  return {
    match: (algorithmId, signed) => {
      const algorithm = contentDigestAlgorithm(algorithmId);
      // verity (fs-verity Merkle) digests and unknown algorithms are not recomputed.
      if (
        blockStart === null ||
        (algorithm !== "sha256" && algorithm !== "sha512")
      )
        return null;
      if (!cache.has(algorithm))
        cache.set(
          algorithm,
          computeApkContentDigest(
            bytes,
            { tail, blockStart, algorithm },
            nodeHash,
          ),
        );
      const computed = cache.get(algorithm) ?? null;
      return computed === null ? null : Buffer.from(computed).equals(signed);
    },
    layoutPreventedRecompute: () =>
      [...cache.values()].some((value) => value === null),
  };
};

/** Proof-of-rotation capability bits (apksig SigningCertificateLineage). */
const capabilities = (
  flags: number,
): SignerV3["rotation"]["lineage"][number]["capabilities"] => ({
  installed_data: (flags & 0x1) !== 0,
  shared_uid: (flags & 0x2) !== 0,
  permission: (flags & 0x4) !== 0,
  rollback: (flags & 0x8) !== 0,
  auth: (flags & 0x10) !== 0,
});

/** A decoded signer plus its decoded (or failed) declared lineage. */
interface DecodedSigner {
  readonly signer: ApkSigner;
  readonly rotation:
    | { readonly present: false }
    | { readonly present: true; readonly nodes: readonly ApkLineageNode[] }
    | { readonly present: true; readonly decodeError: string };
}

interface DecodedScheme {
  readonly uninterpretedBytes: number;
  readonly present: boolean;
  readonly signers: readonly DecodedSigner[];
}

const lineageOf = (
  signer: ApkSigner,
): Result<DecodedSigner["rotation"], ApkSchemeError> => {
  const attribute = signer.attributes.find(
    (a) => a.id === PROOF_OF_ROTATION_ATTR_ID,
  );
  if (attribute === undefined) return ok({ present: false });
  const nodes = decodeRotationLineage(attribute.value);
  if (nodes.ok) return ok({ present: true, nodes: nodes.value });
  // A malformed lineage is reported, not dropped; an over-cap lineage is refused.
  return nodes.error.kind === "malformed-signer"
    ? ok({ present: true, decodeError: nodes.error.detail })
    : nodes;
};

/**
 * Upper bound on the result size from decoded counts, before materialising
 * any of it. The stamp certificate is no larger than its block value.
 */
const projectedOutputBytes = (
  schemes: readonly DecodedScheme[],
  v1: ApkV1Signature,
  v1Decoded: readonly DecodedV1Signer[],
  stamp: Uint8Array | undefined,
): number => {
  let total = 4096 + certificateBytes(stamp);
  for (const name of [...v1.signatureFiles, ...v1.blockFiles])
    total += 1 + jsonStringBytes(name);
  for (const signer of v1Decoded) total += projectedV1SignerBytes(signer);
  for (const scheme of schemes)
    for (const { signer, rotation } of scheme.signers) {
      total += 512 + certificateBytes(signer.certificates[0]);
      for (const digest of signer.digests)
        total += 160 + 2 * digest.digest.length;
      total += 160 * signer.signatures.length;
      if (rotation.present && "nodes" in rotation)
        for (const node of rotation.nodes)
          total += 192 + certificateBytes(node.certificate);
    }
  return total;
};

const digestsOf = (
  signer: ApkSigner,
  matcher: DigestMatcher,
): Signer["digests"] =>
  signer.digests.map((d) => ({
    signature_algorithm_id: d.algorithmId,
    uninterpreted_bytes: d.uninterpretedBytes,
    algorithm: contentDigestAlgorithm(d.algorithmId) ?? "unknown",
    declared_digest_hex: Buffer.from(
      d.digest.buffer,
      d.digest.byteOffset,
      d.digest.byteLength,
    ).toString("hex"),
    matches_apk: matcher.match(d.algorithmId, d.digest),
  }));

const baseSigner = (signer: ApkSigner, matcher: DigestMatcher): Signer => ({
  certificate: signer.certificates[0]
    ? certificateFacts(signer.certificates[0])
    : null,
  digests: digestsOf(signer, matcher),
  uninterpreted_signed_data_bytes: signer.uninterpretedSignedDataBytes,
  uninterpreted_signer_bytes: signer.uninterpretedSignerBytes,
  signatures: signer.signatures.map(
    ({ algorithmId, signature, uninterpretedBytes }) => ({
      signature_algorithm_id: algorithmId,
      algorithm: contentDigestAlgorithm(algorithmId) ?? "unknown",
      signature_bytes: signature.length,
      uninterpreted_bytes: uninterpretedBytes,
    }),
  ),
  public_key_bytes: signer.publicKey.length,
  min_sdk: signer.minSdk,
  max_sdk: signer.maxSdk,
});

const rotationFacts = (
  rotation: DecodedSigner["rotation"],
): SignerV3["rotation"] => {
  if (!rotation.present)
    return { present: false, lineage: [], decode_error: null };
  if ("decodeError" in rotation)
    return { present: true, lineage: [], decode_error: rotation.decodeError };
  return {
    present: true,
    lineage: rotation.nodes.map((node) => ({
      certificate: certificateFacts(node.certificate),
      flags: node.flags,
      capabilities: capabilities(node.flags),
    })),
    decode_error: null,
  };
};

const v3Signer = (
  decoded: DecodedSigner,
  matcher: DigestMatcher,
): SignerV3 => ({
  ...baseSigner(decoded.signer, matcher),
  rotation: rotationFacts(decoded.rotation),
});

/** All recomputed digests agree → true; any mismatch → false; none computed → null. */
const selfConsistency = (
  signers: readonly { readonly digests: Signer["digests"] }[],
): boolean | null => {
  const results = signers
    .flatMap((s) => s.digests.map((d) => d.matches_apk))
    .filter((m): m is boolean => m !== null);
  if (results.length === 0) return null;
  return results.every(Boolean);
};

/** A reported block-scheme signer as the posture derivation reads it. */
const postureSigner = (signer: Signer | SignerV3): ApkPostureSigner => {
  const fingerprint = signer.certificate?.sha256_fingerprint ?? null;
  if (!("rotation" in signer) || !signer.rotation.present)
    return { fingerprint, lineage: { kind: "absent" } };
  if (signer.rotation.decode_error !== null)
    return { fingerprint, lineage: { kind: "undecoded" } };
  return {
    fingerprint,
    lineage: {
      kind: "decoded",
      fingerprints: signer.rotation.lineage.map(
        (node) => node.certificate?.sha256_fingerprint ?? null,
      ),
    },
  };
};

/** Longest name prefix a limitation quotes; the stored length is stated past it. */
const NAME_DISPLAY_BYTES = 256;

/**
 * A duplicated name as a limitation shows it: JSON-quoted, and cut at a
 * UTF-8 boundary within NAME_DISPLAY_BYTES with its stored length.
 */
const displayName = ({ name, storedBytes }: ApkDuplicateName): string => {
  const encoded = Buffer.from(name, "utf8");
  if (encoded.length <= NAME_DISPLAY_BYTES) return JSON.stringify(name);
  let cut = NAME_DISPLAY_BYTES;
  while (cut > 0 && ((encoded[cut] ?? 0) & 0xc0) === 0x80) cut -= 1;
  const prefix = encoded.subarray(0, cut).toString("utf8");
  return `${JSON.stringify(prefix)}… (${String(storedBytes)}-byte name)`;
};

const listed = ({ count, sample }: ApkDuplicateNameSample): string => {
  const more = count - sample.length;
  return `${sample.map(displayName).join(", ")}${more > 0 ? ` and ${String(more)} more` : ""}`;
};

const plural = (count: number): string =>
  `${String(count)} ${count === 1 ? "name" : "names"}`;

/** Why apksig would reject the v1 signature of an archive with duplicate names. */
const duplicateEntriesLimitation = (
  duplicates: ApkDuplicateNames,
): string | null => {
  const { count, records, apksigRecords, unread } = duplicates;
  if (count === 0 && unread.count === 0) return null;
  const partial = apksigRecords < records;
  const scope = partial
    ? `apksig reads only the first ${String(apksigRecords)} of the ${String(records)} central-directory records (it takes the count from the classic end-of-central-directory record's 16-bit field and ignores the Zip64 count). `
    : "";
  const within =
    count > 0
      ? `${partial ? "Among those, the" : "The"} central directory holds ${plural(count)} more than once (${listed(duplicates)}); apksig rejects the v1 signature of an archive with any duplicate entry ("Duplicate entry"). A v1 signer whose signature block, .SF or META-INF/MANIFEST.MF name is duplicated carries decode_error; other v1 signers are reported as declared.`
      : "";
  const beyond =
    unread.count > 0
      ? `${count > 0 ? " " : ""}${plural(unread.count)} (${listed(unread)}) ${unread.count === 1 ? "is" : "are"} duplicated only by records past those, which apksig does not read.`
      : "";
  return `${scope}${within}${beyond}`;
};

const LAYOUT_LIMITATION =
  "The content digest was not recomputed because the central directory is not immediately followed by the end-of-central-directory record (declared size mismatch or an intervening Zip64 record); matches_apk is null for those digests.";

/** Read exactly the selected APK bytes and report its signature schemes. */
export class ApkSignatureProvider implements ApkSignaturePort {
  /** Owns the selected file's descriptor, retaining it when closing fails. */
  readonly #resources = new ArtifactResourceScope();

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      if (
        !(cause instanceof ArtifactReaderFailure) ||
        cause.cleanup === undefined
      )
        throw cause;
      const error = new ProviderCleanupError(
        APK_SIGNATURE_PROVIDER_IDENTITY.id,
        cause.cleanup.resources,
        { reason: cause.cleanup.reason },
        { cause, operation: OPERATION },
      );
      bindArtifactFileCleanup(cause, error);
      throw error;
    }
  }

  async inspect(
    input: { readonly path: string },
    options?: ExecutionOptions,
  ): Promise<Result<ApkSignatureExecution, AnalysisError>> {
    try {
      return await this.#resources.run(async () => {
        const release = await apkSignatureAdmission.acquire(options?.signal);
        try {
          const selected = await readStableArtifact(
            input.path,
            APK_SIGNATURE_LIMITS.inputBytes,
            options?.signal,
            undefined,
            this.#resources,
          );
          assertArtifactReadActive(options?.signal);
          const analyzed = this.#analyze(selected.bytes, {
            path: input.path,
            sha256: selected.sha256,
            bytes: selected.bytes.length,
          });
          assertArtifactReadActive(options?.signal);
          return analyzed;
        } finally {
          release();
        }
      });
    } catch (cause: unknown) {
      return err(apkSignatureFailure(cause, input.path));
    }
  }

  #analyze(
    bytes: Uint8Array,
    artifact: { path: string; sha256: string; bytes: number },
  ): Result<ApkSignatureExecution, AnalysisError> {
    const tail = parseZipTail(bytes);
    if (!tail.ok) return err(mapApkBlockError(tail.error, artifact.path));
    const block = locateApkSigningBlock(bytes, tail.value);
    if (!block.ok) return err(mapApkBlockError(block.error, artifact.path));

    const v1Read = readV1(bytes, tail.value, block.value);
    if (!v1Read.ok) return v1Read;
    const { v1, decoded: v1Decoded, duplicates } = v1Read.value;

    const v2 = decodeScheme(block.value, APK_BLOCK_ID.signatureV2, "v2");
    if (!v2.ok) return err(v2.error);
    const v3 = decodeScheme(block.value, APK_BLOCK_ID.signatureV3, "v3");
    if (!v3.ok) return err(v3.error);
    const v31 = decodeScheme(block.value, APK_BLOCK_ID.signatureV31, "v3.1");
    if (!v31.ok) return err(v31.error);

    // Account for representation expansion before allocating the report.
    const projected = projectedOutputBytes(
      [v2.value, v3.value, v31.value],
      v1,
      v1Decoded,
      sourceStampPair(block.value)?.value,
    );
    if (projected > APK_SIGNATURE_LIMITS.outputBytes)
      return err(apkOutputBudgetError(projected));

    const matcher = digestMatcher(
      bytes,
      tail.value,
      block.value?.blockStart ?? null,
    );
    const v1signers = v1Decoded.map(v1SignerFacts);
    const v2signers = v2.value.signers.map((s) =>
      baseSigner(s.signer, matcher),
    );
    const v3signers = v3.value.signers.map((s) => v3Signer(s, matcher));
    const v31signers = v31.value.signers.map((s) => v3Signer(s, matcher));

    const sourceStamp = sourceStampFacts(block.value);
    const derived = deriveApkPosture({
      v1Present: v1.present,
      v2Present: v2.value.present,
      v3Present: v3.value.present,
      v31Present: v31.value.present,
      sourceStampPresent: sourceStamp.present,
      blockSchemes: [
        { scheme: "v2", signers: v2signers.map(postureSigner) },
        { scheme: "v3", signers: v3signers.map(postureSigner) },
        { scheme: "v3.1", signers: v31signers.map(postureSigner) },
      ],
      v1SignerFingerprints: v1signers.map(v1PostureFingerprint),
      selfConsistent: selfConsistency([
        ...v2signers,
        ...v3signers,
        ...v31signers,
      ]),
    });

    const result: ApkSignatureResult = {
      artifact,
      schemes: {
        v1: {
          present: v1.present,
          has_manifest: v1.hasManifest,
          signature_files: [...v1.signatureFiles],
          block_files: [...v1.blockFiles],
          signers: v1signers,
        },
        v2: {
          present: v2.value.present,
          signers: v2signers,
          uninterpreted_bytes: v2.value.uninterpretedBytes,
        },
        v3: {
          present: v3.value.present,
          signers: v3signers,
          uninterpreted_bytes: v3.value.uninterpretedBytes,
        },
        "v3.1": {
          present: v31.value.present,
          signers: v31signers,
          uninterpreted_bytes: v31.value.uninterpretedBytes,
        },
      },
      source_stamp: sourceStamp,
      posture: derived.posture,
      runtime_execution: "not-performed",
    };

    const uninterpreted = apkSignatureUninterpretedBytes(result);
    const limitations = [
      ...(uninterpreted === 0
        ? []
        : [
            `${String(uninterpreted)} bytes outside known signing fields were not interpreted; suffixes do not by themselves establish malformed signing.`,
          ]),
      ...APK_SIGNATURE_LIMITATIONS,
      ...(matcher.layoutPreventedRecompute() ? [LAYOUT_LIMITATION] : []),
      ...[duplicateEntriesLimitation(duplicates)].filter(
        (note): note is string => note !== null,
      ),
      ...v1SignerNotes(v1Decoded),
      ...derived.notes,
    ];
    // The budget covers everything emitted: limitations repeat archive names.
    const serialized = Buffer.byteLength(
      JSON.stringify({ result, limitations }),
    );
    if (serialized > APK_SIGNATURE_LIMITS.outputBytes)
      return err(apkOutputBudgetError(serialized));

    const format =
      (zipPackageFormatForPath(artifact.path) ?? "zip") === "apk"
        ? "apk"
        : "zip";
    return ok(
      createAnalysisExecution(result, APK_SIGNATURE_PROVIDER_IDENTITY, {
        subject: { path: artifact.path, format, sha256: artifact.sha256 },
        locations: [{ kind: "artifact-path", path: artifact.path }],
        limitations,
      }) as ApkSignatureExecution,
    );
  }
}

/**
 * v1 signing from the central directory, with each paired block decoded. A
 * directory that cannot be walked leaves v1 unknown and is refused.
 */
const readV1 = (
  bytes: Uint8Array,
  tail: ZipTail,
  block: ApkSigningBlock | null,
): Result<
  {
    readonly v1: ApkV1Signature;
    readonly decoded: DecodedV1Signer[];
    readonly duplicates: ApkDuplicateNames;
  },
  AnalysisError
> => {
  const entries = centralDirectoryV1SignatureEntries(
    bytes,
    tail.centralDirectoryOffset,
    tail.centralDirectorySize,
    tail.totalEntries,
    tail.classicEntryCount,
  );
  if (!entries.ok) return err(mapCentralDirectoryError(entries.error));
  const v1 = detectV1Signature(entries.value.entries);
  if (v1.signers.length > MAX_V1_SIGNERS)
    return err(v1SignerCapacityError(MAX_V1_SIGNERS));
  // Entry data lies before the signing block, or the directory without one.
  const entriesEnd = block?.blockStart ?? tail.centralDirectoryOffset;
  return ok({
    v1,
    duplicates: entries.value.duplicates,
    decoded: v1.signers.map((signer) =>
      decodeV1Signer(bytes, signer, entriesEnd),
    ),
  });
};

/** The declared stamp certificate, preferring the V2 stamp block as apksig does. */
const sourceStampPair = (block: ApkSigningBlock | null) =>
  block?.pairs.find((p) => p.id === APK_BLOCK_ID.sourceStampV2) ??
  block?.pairs.find((p) => p.id === APK_BLOCK_ID.sourceStampV1);

const sourceStampFacts = (
  block: ApkSigningBlock | null,
): ApkSignatureResult["source_stamp"] => {
  const pair = sourceStampPair(block);
  if (pair === undefined)
    return { present: false, certificate: null, decode_error: null };
  const certificate = decodeSourceStampCertificate(pair.value);
  return certificate.ok
    ? {
        present: true,
        certificate: certificateFacts(certificate.value),
        decode_error: null,
      }
    : {
        present: true,
        certificate: null,
        decode_error:
          certificate.error.kind === "malformed-signer"
            ? certificate.error.detail
            : `more ${certificate.error.resource} than ${String(certificate.error.limit)}`,
      };
};

/** Decode one scheme's signers and their declared lineages, mapping failures by scheme. */
const decodeScheme = (
  block: ApkSigningBlock | null,
  id: number,
  version: ApkSchemeVersion,
): Result<DecodedScheme, AnalysisError> => {
  const pair = block?.pairs.find((p) => p.id === id);
  if (pair === undefined)
    return ok({ present: false, signers: [], uninterpretedBytes: 0 });
  const signers = decodeSigners(pair.value, version);
  if (!signers.ok) return err(mapApkSchemeError(signers.error, version));
  const decoded: DecodedSigner[] = [];
  for (const signer of signers.value.signers) {
    const rotation =
      version === "v2" ? ok({ present: false } as const) : lineageOf(signer);
    if (!rotation.ok) return err(mapApkSchemeError(rotation.error, version));
    decoded.push({ signer, rotation: rotation.value });
  }
  return ok({
    present: true,
    signers: decoded,
    uninterpretedBytes: signers.value.uninterpretedBytes,
  });
};
