import type { ManagedMemberInspection } from "./managedArtifact.js";
import type { ManagedMemberComparisonSide } from "./managedMemberComparison.js";

type Method = ManagedMemberInspection["methods"][number];
type Field = ManagedMemberInspection["fields"][number];

/**
 * The exact signature across builds: raw bytes with type operands resolved to
 * names. Raw bytes name types by build-local rows, so they stand in only when
 * REA could not resolve the operands, or for Evidence recorded before it did.
 * The kind is part of the key: an undecodable blob can hold another
 * signature's resolved preimage, so its raw digest can equal that resolved
 * digest without the two being the same signature.
 */
export const signatureIdentity = ({
  raw_sha256,
  resolved_sha256,
}: Method["signature"]): string =>
  resolved_sha256 === null
    ? `raw:${raw_sha256}`
    : `resolved:${resolved_sha256}`;

/**
 * The producer attests examination independently of whether it could resolve
 * any operands. A current inventory of only unresolved types is not legacy.
 */
export const hasSignatureResolution = (
  result: ManagedMemberInspection,
): boolean =>
  result.signature_resolution !== null ||
  (result.methods.length === 0 && result.fields.length === 0);

const withoutResolution = <Member extends Method | Field>(
  members: readonly Member[],
): Member[] =>
  members.map((member) => ({
    ...member,
    signature: { ...member.signature, resolved_sha256: null },
  }));

/**
 * Compare raw signatures on both sides when either observation predates
 * resolved digests; a resolved digest never equals a raw one for a signature
 * that names a type, so mixing them would lose pairs a raw comparison finds.
 */
export const comparableSides = (
  left: ManagedMemberComparisonSide,
  right: ManagedMemberComparisonSide,
): readonly [ManagedMemberComparisonSide, ManagedMemberComparisonSide] => {
  if (
    hasSignatureResolution(left.result) &&
    hasSignatureResolution(right.result)
  )
    return [left, right];
  const raw = (side: ManagedMemberComparisonSide) => ({
    ...side,
    result: {
      ...side.result,
      methods: withoutResolution(side.result.methods),
      fields: withoutResolution(side.result.fields),
    },
  });
  return [raw(left), raw(right)];
};
