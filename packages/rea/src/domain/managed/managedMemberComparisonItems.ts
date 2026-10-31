import canonicalize from "canonicalize";

import { digestCanonicalValue } from "../canonicalDigest.js";
import type { ManagedMemberInspection } from "./managedArtifact.js";
import type { ManagedMemberComparisonResult } from "./managedMemberComparison.js";
import type {
  ManagedFieldMatches,
  ManagedMethodMatches,
} from "./managedMemberComparisonMatch.js";
import { signatureIdentity } from "./managedMemberSignatureIdentity.js";
import { isManagedMemberReferenceInstruction } from "./managedMemberInstructionFacts.js";
import type { ManagedComparisonScope } from "./managedMemberComparisonCoverage.js";

type Method = ManagedMemberInspection["methods"][number];
type Field = ManagedMemberInspection["fields"][number];
type CallEdgesByCaller = ReadonlyMap<
  string,
  readonly ManagedMemberInspection["call_edges"][number][]
>;
type FieldAccessesByCaller = ReadonlyMap<
  string,
  readonly ManagedMemberInspection["field_accesses"][number][]
>;
type MethodItem = ManagedMemberComparisonResult["methods"][number];
type FieldItem = ManagedMemberComparisonResult["fields"][number];
type UnmatchedComparison = Extract<
  MethodItem["match"],
  { readonly status: "unmatched" }
>;

type OneSided<Item> =
  | { readonly left: Item; readonly right?: never }
  | { readonly left?: never; readonly right: Item };

interface ComparisonItemContext {
  readonly leftEvidenceId: string;
  readonly rightEvidenceId: string;
  readonly leftComplete: boolean;
  readonly rightComplete: boolean;
  readonly leftMethodsComplete: boolean;
  readonly rightMethodsComplete: boolean;
  readonly scope: ManagedComparisonScope;
  /** Whether matching keyed signatures by resolved digests, not raw bytes. */
  readonly signatureResolutionExamined: boolean;
  readonly sameArtifact: boolean;
  readonly leftAssembly: ManagedMemberInspection["assembly"];
  readonly rightAssembly: ManagedMemberInspection["assembly"];
  readonly leftCallEdgesByCaller: CallEdgesByCaller;
  readonly rightCallEdgesByCaller: CallEdgesByCaller;
  readonly leftFieldAccessesByCaller: FieldAccessesByCaller;
  readonly rightFieldAccessesByCaller: FieldAccessesByCaller;
}

/** Whether an inventory observed every member of this member's declaring type. */
const inventoryCovers = (
  complete: boolean,
  observes: (member: Method | Field) => boolean,
  member: Method | Field,
): boolean => complete && observes(member);

/**
 * Declared type and name of each unpaired member, per side, whose signature
 * was not decoded, or was decoded but not resolved while matching keyed
 * resolved signatures.
 */
interface UndecodedOneSidedNames {
  readonly resolved: boolean;
  readonly undecoded: Readonly<Record<"left" | "right", ReadonlySet<string>>>;
  readonly unresolved: Readonly<Record<"left" | "right", ReadonlySet<string>>>;
  readonly unknownOwners: Readonly<
    Record<"left" | "right", ReadonlySet<string>>
  >;
}

const methodDimensions = (
  left: Method,
  right: Method,
  leftCallEdgesByCaller: CallEdgesByCaller,
  rightCallEdgesByCaller: CallEdgesByCaller,
  leftFieldAccessesByCaller: FieldAccessesByCaller,
  rightFieldAccessesByCaller: FieldAccessesByCaller,
  leftAssembly: ManagedMemberInspection["assembly"],
  rightAssembly: ManagedMemberInspection["assembly"],
): {
  readonly dimensions: MethodItem["dimensions"];
  readonly bodyUnknown: boolean;
  readonly callTargetUnknown: boolean;
  readonly fieldTargetUnknown: boolean;
  readonly exceptionTargetUnknown: boolean;
} => {
  const dimensions: MethodItem["dimensions"] = [];
  const headerFields = ["max_stack", "init_locals"] as const;
  const headerChanged = headerFields.some(
    (field) =>
      left.body[field] !== null &&
      right.body[field] !== null &&
      left.body[field] !== right.body[field],
  );
  const localsPresenceChanged =
    left.body.status === "present" &&
    right.body.status === "present" &&
    (left.body.local_var_sig_token !== null) !==
      (right.body.local_var_sig_token !== null);
  if (
    left.flags !== right.flags ||
    left.impl_flags !== right.impl_flags ||
    headerChanged ||
    localsPresenceChanged
  )
    dimensions.push("metadata");
  if (signatureIdentity(left.signature) !== signatureIdentity(right.signature))
    dimensions.push("signature");
  const leftBodyComplete =
    left.body.status === "present" && left.body.truncated_instructions === 0;
  const rightBodyComplete =
    right.body.status === "present" && right.body.truncated_instructions === 0;
  const bothAbsent =
    left.body.status === "absent" && right.body.status === "absent";
  if (
    (left.body.status === "absent" && rightBodyComplete) ||
    (right.body.status === "absent" && leftBodyComplete)
  )
    dimensions.push("availability");
  if (bothAbsent)
    return {
      dimensions,
      bodyUnknown: false,
      callTargetUnknown: false,
      fieldTargetUnknown: false,
      exceptionTargetUnknown: false,
    };
  const sameCallShape =
    callShape(left.body.anchors) === callShape(right.body.anchors);
  const callTargets = sameCallShape
    ? compareCallTargets(
        left,
        right,
        leftCallEdgesByCaller.get(left.token) ?? [],
        rightCallEdgesByCaller.get(right.token) ?? [],
      )
    : { changed: false, unknown: false };
  const sameFieldShape =
    fieldShape(left.body.anchors) === fieldShape(right.body.anchors);
  const fieldTargets = sameFieldShape
    ? compareFieldTargets(
        left,
        right,
        leftFieldAccessesByCaller.get(left.token) ?? [],
        rightFieldAccessesByCaller.get(right.token) ?? [],
      )
    : { changed: false, unknown: false };
  const sameExceptionShape =
    exceptionShape(left.body.exception_regions) ===
    exceptionShape(right.body.exception_regions);
  const exceptionTargets = sameExceptionShape
    ? compareExceptionTargets(
        left.body.exception_regions,
        right.body.exception_regions,
        leftAssembly,
        rightAssembly,
      )
    : { changed: false, unknown: false };
  if (callTargets.changed) dimensions.push("call-target");
  if (fieldTargets.changed) dimensions.push("field-target");
  if (exceptionTargets.changed) dimensions.push("exception-target");
  if (!leftBodyComplete || !rightBodyComplete)
    return {
      dimensions,
      bodyUnknown: true,
      callTargetUnknown: callTargets.unknown,
      fieldTargetUnknown: fieldTargets.unknown,
      exceptionTargetUnknown: exceptionTargets.unknown,
    };
  if (!sameCallShape) dimensions.push("call-shape");
  // The decoded fingerprint omits switch targets and is not exact CIL identity.
  if (
    left.body.il_sha256 !== right.body.il_sha256 ||
    left.body.normalized_il_sha256 !== right.body.normalized_il_sha256
  )
    dimensions.push("cil");
  if (
    canonicalize(left.body.opcode_counts) !==
    canonicalize(right.body.opcode_counts)
  )
    dimensions.push("opcode-shape");
  if (!sameFieldShape) dimensions.push("field-shape");
  if (!sameExceptionShape) dimensions.push("exception-shape");
  return {
    dimensions,
    callTargetUnknown: callTargets.unknown,
    fieldTargetUnknown: fieldTargets.unknown,
    exceptionTargetUnknown: exceptionTargets.unknown,
    bodyUnknown: headerFields.some(
      (field) => left.body[field] === null || right.body[field] === null,
    ),
  };
};

const exceptionShape = (regions: Method["body"]["exception_regions"]): string =>
  JSON.stringify(
    regions.map(
      ({
        flags,
        try_offset,
        try_length,
        handler_offset,
        handler_length,
        filter_offset,
      }) => [
        flags,
        try_offset,
        try_length,
        handler_offset,
        handler_length,
        filter_offset,
      ],
    ),
  );

const compareExceptionTargets = (
  left: Method["body"]["exception_regions"],
  right: Method["body"]["exception_regions"],
  leftAssembly: ManagedMemberInspection["assembly"],
  rightAssembly: ManagedMemberInspection["assembly"],
): { readonly changed: boolean; readonly unknown: boolean } => {
  let changed = false;
  let unknown = false;
  for (let index = 0; index < left.length; index += 1) {
    const leftRegion = left[index];
    const rightRegion = right[index];
    if (leftRegion === undefined || rightRegion === undefined) {
      unknown = true;
      continue;
    }
    if (leftRegion.flags !== 0) continue;
    const leftName = leftRegion.class_type_name_sha256;
    const rightName = rightRegion.class_type_name_sha256;
    if (leftName !== null && rightName !== null && leftName !== rightName) {
      changed = true;
      if (
        leftRegion.class_type_identity_resolved !== true ||
        rightRegion.class_type_identity_resolved !== true
      )
        unknown = true;
      continue;
    }
    if (leftName === null || rightName === null) {
      if (
        leftRegion.class_type !== null &&
        rightRegion.class_type !== null &&
        leftRegion.class_type !== rightRegion.class_type
      )
        changed = true;
      unknown = true;
      continue;
    }
    if (
      leftRegion.class_type_identity_resolved !== true ||
      rightRegion.class_type_identity_resolved !== true ||
      leftAssembly === null ||
      rightAssembly === null
    ) {
      unknown = true;
      continue;
    }
    if (!sameAssemblyIdentity(leftAssembly, rightAssembly)) changed = true;
  }
  return { changed, unknown };
};

const sameAssemblyIdentity = (
  left: NonNullable<ManagedMemberInspection["assembly"]>,
  right: NonNullable<ManagedMemberInspection["assembly"]>,
): boolean =>
  left.name.toLowerCase() === right.name.toLowerCase() &&
  left.version === right.version &&
  left.culture?.toLowerCase() === right.culture?.toLowerCase() &&
  (left.flags & 0x0f00) === (right.flags & 0x0f00) &&
  left.public_key.kind === right.public_key.kind &&
  left.public_key.sha256 === right.public_key.sha256 &&
  left.public_key.token === right.public_key.token;

interface ReferenceTarget {
  readonly offset: number | null;
  readonly opcode: string;
  readonly token: string;
  readonly identity: string | null;
}

/** Join each edge to its instruction site, then compare aligned instructions. */
const compareReferenceTargets = (
  left: Method,
  right: Method,
  kind: "field" | "method",
  leftTargets: readonly ReferenceTarget[],
  rightTargets: readonly ReferenceTarget[],
): { readonly changed: boolean; readonly unknown: boolean } => {
  const align = (method: Method, targets: readonly ReferenceTarget[]) => {
    const anchors = method.body.anchors.filter(
      (anchor) =>
        isManagedMemberReferenceInstruction(anchor) &&
        anchor.operand_kind === kind,
    );
    const byOffset = new Map<number | null, ReferenceTarget | null>();
    for (const target of targets)
      byOffset.set(target.offset, byOffset.has(target.offset) ? null : target);
    let unknown = targets.length !== anchors.length;
    const aligned = anchors.map((anchor) => {
      const target = byOffset.get(anchor.il_offset);
      if (
        target == null ||
        target.opcode !== anchor.opcode ||
        target.token !== anchor.operand
      ) {
        unknown = true;
        return null;
      }
      return target;
    });
    return { aligned, unknown };
  };
  const a = align(left, leftTargets);
  const b = align(right, rightTargets);
  let changed = false;
  let unknown = a.unknown || b.unknown || a.aligned.length !== b.aligned.length;
  for (
    let index = 0;
    index < Math.max(a.aligned.length, b.aligned.length);
    index += 1
  ) {
    const leftIdentity = a.aligned[index]?.identity;
    const rightIdentity = b.aligned[index]?.identity;
    if (leftIdentity == null || rightIdentity == null) unknown = true;
    else if (leftIdentity !== rightIdentity) changed = true;
  }
  return { changed, unknown };
};

const compareFieldTargets = (
  left: Method,
  right: Method,
  leftAccesses: readonly ManagedMemberInspection["field_accesses"][number][],
  rightAccesses: readonly ManagedMemberInspection["field_accesses"][number][],
) =>
  compareReferenceTargets(
    left,
    right,
    "field",
    leftAccesses.map((edge) => ({
      offset: edge.il_offset,
      opcode: edge.opcode,
      token: edge.field_token,
      identity: edge.target_identity_sha256,
    })),
    rightAccesses.map((edge) => ({
      offset: edge.il_offset,
      opcode: edge.opcode,
      token: edge.field_token,
      identity: edge.target_identity_sha256,
    })),
  );

const compareCallTargets = (
  left: Method,
  right: Method,
  leftEdges: readonly ManagedMemberInspection["call_edges"][number][],
  rightEdges: readonly ManagedMemberInspection["call_edges"][number][],
) =>
  compareReferenceTargets(
    left,
    right,
    "method",
    leftEdges.map((edge) => ({
      offset: edge.il_offset,
      opcode: edge.opcode,
      token: edge.target_token,
      identity: edge.target_identity_sha256,
    })),
    rightEdges.map((edge) => ({
      offset: edge.il_offset,
      opcode: edge.opcode,
      token: edge.target_token,
      identity: edge.target_identity_sha256,
    })),
  );

const callShape = (anchors: Method["body"]["anchors"]): string =>
  JSON.stringify(
    anchors
      .filter(
        (instruction) =>
          isManagedMemberReferenceInstruction(instruction) &&
          instruction.operand_kind === "method",
      )
      .map(({ opcode, operand_kind }) => [opcode, operand_kind]),
  );

const fieldShape = (anchors: Method["body"]["anchors"]): string =>
  JSON.stringify(
    anchors
      .filter(
        (instruction) =>
          isManagedMemberReferenceInstruction(instruction) &&
          instruction.operand_kind === "field",
      )
      .map(({ opcode, operand_kind }) => [opcode, operand_kind]),
  );

const methodIdentity = (item: Method): NonNullable<MethodItem["left"]> => ({
  token: item.token,
  declaring_type: item.declaring_type,
  name: item.name,
  signature_sha256: item.signature.raw_sha256,
  normalized_il_sha256: item.body.normalized_il_sha256,
});

const fieldIdentity = (item: Field): NonNullable<FieldItem["left"]> => ({
  token: item.token,
  declaring_type: item.declaring_type,
  name: item.name,
  signature_sha256: item.signature.raw_sha256,
});

const unmatchedComparison = (): UnmatchedComparison => ({
  status: "unmatched",
  basis: "none",
  confidence: "unknown",
  candidate_left_tokens: [],
  candidate_right_tokens: [],
});

const methodOnlyItem = (
  member: OneSided<Method>,
  identity: string,
  identityUnavailable: boolean,
  context: ComparisonItemContext,
  undecoded: UndecodedOneSidedNames,
): MethodItem => {
  if (member.left !== undefined) {
    const limitations = absenceLimitations(member.left, identity, {
      oppositeComplete: inventoryCovers(
        context.rightMethodsComplete,
        context.scope.inRight,
        member.left,
      ),
      unpaired: undecoded,
      ownIdentityUnavailable: identityUnavailable,
      opposite: "right",
      inventory: "method",
    });
    return {
      item_id: `mmc_method_${digestCanonicalValue({ token: member.left.token, side: "left" }, "Managed comparison")}`,
      status: limitations.length === 0 ? "removed" : "unknown",
      left: methodIdentity(member.left),
      right: null,
      match: unmatchedComparison(),
      dimensions: ["availability"],
      evidence_links: [context.leftEvidenceId, context.rightEvidenceId],
      limitations,
    };
  }

  const limitations = absenceLimitations(member.right, identity, {
    oppositeComplete: inventoryCovers(
      context.leftMethodsComplete,
      context.scope.inLeft,
      member.right,
    ),
    unpaired: undecoded,
    ownIdentityUnavailable: identityUnavailable,
    opposite: "left",
    inventory: "method",
  });
  return {
    item_id: `mmc_method_${digestCanonicalValue({ token: member.right.token, side: "right" }, "Managed comparison")}`,
    status: limitations.length === 0 ? "added" : "unknown",
    left: null,
    right: methodIdentity(member.right),
    match: unmatchedComparison(),
    dimensions: ["availability"],
    evidence_links: [context.leftEvidenceId, context.rightEvidenceId],
    limitations,
  };
};

/**
 * Why a one-sided member's absence from the other inventory was not
 * observed: that inventory is incomplete, the member's own signature was not
 * decoded, so no shape round could seek a changed counterpart, or the other
 * inventory has an unpaired (one-sided or ambiguous) same-named member whose
 * signature was not decoded, which may be this member with a changed
 * signature. A decoded signature that names a type REA could not name, while
 * the comparison otherwise keys resolved signatures, is compared by raw bytes
 * that name types by build-local row, so it is treated the same way.
 */
const absenceLimitations = (
  member: Method | Field,
  identity: string,
  opposite: {
    readonly oppositeComplete: boolean;
    readonly ownIdentityUnavailable: boolean;
    readonly unpaired: UndecodedOneSidedNames;
    readonly opposite: "left" | "right";
    readonly inventory: "method" | "field";
  },
): string[] => [
  ...(opposite.ownIdentityUnavailable
    ? [
        "declaring-type-name-not-resolved: Declared type identity could not be resolved; a bare display name cannot establish a counterpart or absence.",
      ]
    : []),
  ...(opposite.unpaired.unknownOwners[opposite.opposite].has(member.name)
    ? [
        `counterpart-declaring-type-name-not-resolved: The ${opposite.opposite} ${opposite.inventory} inventory has an unpaired same-named member with unresolved enclosing-name identity, so absence was not established.`,
      ]
    : []),
  ...(opposite.oppositeComplete
    ? []
    : [
        `unknown-within-incomplete-metadata: The ${opposite.opposite} ${opposite.inventory} inventory is incomplete, so absence was not observed.`,
      ]),
  ...(member.signature.parse_status === "decoded"
    ? []
    : [
        `signature-not-decoded: The member's ${member.signature.parse_status} signature was compared only by exact declared type, name, and signature bytes, so a changed or renamed counterpart could not be sought.`,
      ]),
  ...(member.signature.parse_status === "decoded" &&
  opposite.unpaired.undecoded[opposite.opposite].has(identity)
    ? [
        `counterpart-signature-not-decoded: The ${opposite.opposite} ${opposite.inventory} inventory has an unpaired member with the same declared type and name whose signature was not decoded, so it may be this member with a changed signature.`,
      ]
    : []),
  ...(unresolved(member, opposite.unpaired.resolved)
    ? [
        `signature-not-resolved: The member's signature names a type REA could not name, so it was compared by raw bytes, which name types by build-local metadata row; a counterpart whose referenced type moved rows could not be found.`,
      ]
    : []),
  ...(member.signature.parse_status === "decoded" &&
  !unresolved(member, opposite.unpaired.resolved) &&
  opposite.unpaired.unresolved[opposite.opposite].has(identity)
    ? [
        `counterpart-signature-not-resolved: The ${opposite.opposite} ${opposite.inventory} inventory has an unpaired member with the same declared type and name whose signature names a type REA could not name, so it may be this member.`,
      ]
    : []),
];

/** A known signature form whose type operands still compare by raw bytes. */
const unresolved = (member: Method | Field, resolved: boolean): boolean =>
  resolved &&
  member.signature.kind !== "unknown" &&
  member.signature.resolved_sha256 === null;

/** Exact bytes retain a pair without establishing a valid or resolved signature. */
const pairedSignatureLimitations = (
  left: Method | Field,
  right: Method | Field,
  examined: boolean,
): string[] => {
  if (
    left.signature.parse_status === "malformed" ||
    right.signature.parse_status === "malformed"
  )
    return [
      "signature-malformed: At least one signature is malformed; equal signature bytes do not establish an unchanged member signature.",
    ];
  return unresolved(left, examined) || unresolved(right, examined)
    ? [
        "signature-not-resolved: At least one signature names a type REA could not resolve; equal build-local row bytes do not establish equivalent signature types.",
      ]
    : [];
};

/**
 * Declared names of unpaired members whose signature was not decoded: one-sided
 * members and candidates of ambiguous groups, which also remain unpaired.
 */
interface Unpaired {
  readonly item: Method | Field;
  readonly identity: string;
  readonly identityUnavailable: boolean;
}

const undecodedOneSidedNames = (
  members: {
    readonly leftOnly: readonly Unpaired[];
    readonly rightOnly: readonly Unpaired[];
    readonly ambiguous: readonly {
      readonly left: readonly Unpaired[];
      readonly right: readonly Unpaired[];
    }[];
  },
  resolved: boolean,
): UndecodedOneSidedNames => {
  const sides = {
    left: [
      ...members.leftOnly,
      ...members.ambiguous.flatMap(({ left }) => left),
    ],
    right: [
      ...members.rightOnly,
      ...members.ambiguous.flatMap(({ right }) => right),
    ],
  };
  const names = (
    side: readonly Unpaired[],
    keep: (item: Method | Field) => boolean,
  ) =>
    new Set(
      side.filter(({ item }) => keep(item)).map(({ identity }) => identity),
    );
  const undecoded = (item: Method | Field) =>
    item.signature.parse_status !== "decoded";
  const notResolved = (item: Method | Field) => unresolved(item, resolved);
  return {
    resolved,
    unknownOwners: {
      left: new Set(
        sides.left.filter((x) => x.identityUnavailable).map((x) => x.item.name),
      ),
      right: new Set(
        sides.right
          .filter((x) => x.identityUnavailable)
          .map((x) => x.item.name),
      ),
    },
    undecoded: {
      left: names(sides.left, undecoded),
      right: names(sides.right, undecoded),
    },
    unresolved: {
      left: names(sides.left, notResolved),
      right: names(sides.right, notResolved),
    },
  };
};

const fieldOnlyItem = (
  member: OneSided<Field>,
  identity: string,
  identityUnavailable: boolean,
  context: ComparisonItemContext,
  undecoded: UndecodedOneSidedNames,
): FieldItem => {
  if (member.left !== undefined) {
    const limitations = absenceLimitations(member.left, identity, {
      oppositeComplete: inventoryCovers(
        context.rightComplete,
        context.scope.inRight,
        member.left,
      ),
      unpaired: undecoded,
      ownIdentityUnavailable: identityUnavailable,
      opposite: "right",
      inventory: "field",
    });
    return {
      item_id: `mmc_field_${digestCanonicalValue({ token: member.left.token, side: "left" }, "Managed comparison")}`,
      status: limitations.length === 0 ? "removed" : "unknown",
      left: fieldIdentity(member.left),
      right: null,
      match: unmatchedComparison(),
      evidence_links: [context.leftEvidenceId, context.rightEvidenceId],
      limitations,
    };
  }

  const limitations = absenceLimitations(member.right, identity, {
    oppositeComplete: inventoryCovers(
      context.leftComplete,
      context.scope.inLeft,
      member.right,
    ),
    unpaired: undecoded,
    ownIdentityUnavailable: identityUnavailable,
    opposite: "left",
    inventory: "field",
  });
  return {
    item_id: `mmc_field_${digestCanonicalValue({ token: member.right.token, side: "right" }, "Managed comparison")}`,
    status: limitations.length === 0 ? "added" : "unknown",
    left: null,
    right: fieldIdentity(member.right),
    match: unmatchedComparison(),
    evidence_links: [context.leftEvidenceId, context.rightEvidenceId],
    limitations,
  };
};

/**
 * Name only evidence shared by the whole group. Exact-signature ambiguities
 * include both declared-identity collisions and unresolved signature choices.
 */
const ambiguityLimitation = (
  members: "methods" | "fields",
  basis: MethodItem["match"]["basis"],
  identityUnavailable: boolean,
): string =>
  identityUnavailable
    ? "declaring-type-name-not-resolved: Declared type identity remains unresolved; REA did not guess a counterpart from display names, signatures or CIL."
    : basis === "exact-signature"
      ? `Multiple managed ${members} share the same signature; REA did not guess declared ownership or a token remap.`
      : basis === "exact-il-signature"
        ? "Multiple managed methods share the same CIL and signature; REA did not guess a token remap."
        : members === "methods"
          ? "Multiple managed methods share the same structural shape; REA did not guess a token remap."
          : "Multiple managed fields share the same signature; REA did not guess a token remap.";

/** Local signature bytes prove identity only without metadata or declaring-context dependencies. */
const compareLocalSignatures = (
  left: Method,
  right: Method,
  sameArtifact: boolean,
): { readonly changed: boolean; readonly unknown: boolean } => {
  const leftPresent = left.body.local_var_sig_token !== null;
  const rightPresent = right.body.local_var_sig_token !== null;
  if (!leftPresent || !rightPresent) return { changed: false, unknown: false };
  // The same method row of the same authenticated artifact names the same source bytes.
  if (sameArtifact && left.token === right.token)
    return { changed: false, unknown: false };
  const a = left.body.local_var_signature;
  const b = right.body.local_var_signature;
  if (
    a === null ||
    b === null ||
    a.has_context_dependent_types ||
    b.has_context_dependent_types
  )
    return { changed: false, unknown: true };
  return { changed: a.raw_sha256 !== b.raw_sha256, unknown: false };
};

export const buildMethodItems = (
  matches: ManagedMethodMatches,
  context: ComparisonItemContext,
): MethodItem[] => {
  const items: MethodItem[] = [];
  for (const pair of matches.pairs) {
    const signatureLimitations = pairedSignatureLimitations(
      pair.left.item,
      pair.right.item,
      context.signatureResolutionExamined,
    );
    const locals = compareLocalSignatures(
      pair.left.item,
      pair.right.item,
      context.sameArtifact,
    );
    const {
      dimensions: observedDimensions,
      bodyUnknown,
      callTargetUnknown,
      fieldTargetUnknown,
      exceptionTargetUnknown,
    } = methodDimensions(
      pair.left.item,
      pair.right.item,
      context.leftCallEdgesByCaller,
      context.rightCallEdgesByCaller,
      context.leftFieldAccessesByCaller,
      context.rightFieldAccessesByCaller,
      context.leftAssembly,
      context.rightAssembly,
    );
    if (locals.changed && !observedDimensions.includes("metadata"))
      observedDimensions.push("metadata");
    const dimensions = [
      ...observedDimensions,
      ...(bodyUnknown ? (["body-coverage"] as const) : []),
      ...(callTargetUnknown ||
      fieldTargetUnknown ||
      exceptionTargetUnknown ||
      locals.unknown
        ? (["availability"] as const)
        : []),
    ];
    const observedChange = observedDimensions.length > 0;
    items.push({
      item_id: `mmc_method_${digestCanonicalValue(
        {
          left: pair.left.item.token,
          right: pair.right.item.token,
          basis: pair.basis,
        },
        "Managed comparison",
      )}`,
      status: observedChange
        ? "changed"
        : bodyUnknown ||
            callTargetUnknown ||
            fieldTargetUnknown ||
            exceptionTargetUnknown ||
            locals.unknown ||
            signatureLimitations.length > 0
          ? "unknown"
          : "unchanged",
      left: methodIdentity(pair.left.item),
      right: methodIdentity(pair.right.item),
      match: {
        status: "matched",
        basis: pair.basis,
        confidence: pair.confidence,
        candidate_left_tokens: [],
        candidate_right_tokens: [],
      },
      dimensions,
      evidence_links: [context.leftEvidenceId, context.rightEvidenceId],
      limitations: [
        ...signatureLimitations,
        ...(locals.unknown
          ? [
              "Local variable signature identity is unknown because validated context-free signature facts are unavailable or the signature requires metadata or declaring context; build-local tokens and raw bytes do not establish equivalent local types across artifacts.",
            ]
          : []),
        ...(locals.changed
          ? [
              "The validated context-free LocalVarSig bytes changed; this records an encoding difference without asserting a semantic type change.",
            ]
          : []),
        ...(bodyUnknown
          ? [
              "Method body facets are unknown because at least one side has unavailable or partial body data.",
            ]
          : []),
        ...(callTargetUnknown
          ? [
              "One or more call targets are unavailable because the observed method edges do not cover aligned call instructions or lack a resolved nominal target identity or instruction site.",
            ]
          : []),
        ...(fieldTargetUnknown
          ? [
              "One or more field targets are unavailable because observed field accesses do not cover aligned field instructions or lack a resolved nominal target identity or instruction site.",
            ]
          : []),
        ...(exceptionTargetUnknown
          ? [
              "One or more catch type identities are unavailable because local tokens or TypeRef resolution scopes do not establish cross-build identity.",
            ]
          : []),
      ],
    });
  }
  for (const ambiguous of matches.ambiguous) {
    items.push({
      item_id: `mmc_method_${digestCanonicalValue(
        {
          left: ambiguous.left.map(({ item }) => item.token),
          right: ambiguous.right.map(({ item }) => item.token),
          basis: ambiguous.basis,
        },
        "Managed comparison",
      )}`,
      status: "unknown",
      left: null,
      right: null,
      match: {
        status: "ambiguous",
        basis: ambiguous.basis,
        confidence: "unknown",
        candidate_left_tokens: ambiguous.left.map(({ item }) => item.token),
        candidate_right_tokens: ambiguous.right.map(({ item }) => item.token),
      },
      dimensions: ["availability"],
      evidence_links: [context.leftEvidenceId, context.rightEvidenceId],
      limitations: [
        ambiguityLimitation(
          "methods",
          ambiguous.basis,
          ambiguous.left.some((item) => item.identityUnavailable) ||
            ambiguous.right.some((item) => item.identityUnavailable),
        ),
      ],
    });
  }
  const undecoded = undecodedOneSidedNames(
    matches,
    context.signatureResolutionExamined,
  );
  for (const item of matches.leftOnly)
    items.push(
      methodOnlyItem(
        { left: item.item },
        item.identity,
        item.identityUnavailable,
        context,
        undecoded,
      ),
    );
  for (const item of matches.rightOnly)
    items.push(
      methodOnlyItem(
        { right: item.item },
        item.identity,
        item.identityUnavailable,
        context,
        undecoded,
      ),
    );
  return items;
};

export const buildFieldItems = (
  matches: ManagedFieldMatches,
  context: ComparisonItemContext,
): FieldItem[] => {
  const items: FieldItem[] = [];
  for (const pair of matches.pairs) {
    const signatureLimitations = pairedSignatureLimitations(
      pair.left.item,
      pair.right.item,
      context.signatureResolutionExamined,
    );
    const changed =
      signatureIdentity(pair.left.item.signature) !==
        signatureIdentity(pair.right.item.signature) ||
      pair.left.item.flags !== pair.right.item.flags;
    items.push({
      item_id: `mmc_field_${digestCanonicalValue(
        {
          left: pair.left.item.token,
          right: pair.right.item.token,
        },
        "Managed comparison",
      )}`,
      status: changed
        ? "changed"
        : signatureLimitations.length > 0
          ? "unknown"
          : "unchanged",
      left: fieldIdentity(pair.left.item),
      right: fieldIdentity(pair.right.item),
      match: {
        status: "matched",
        basis: pair.basis,
        confidence: pair.confidence,
        candidate_left_tokens: [],
        candidate_right_tokens: [],
      },
      evidence_links: [context.leftEvidenceId, context.rightEvidenceId],
      limitations: signatureLimitations,
    });
  }
  for (const ambiguous of matches.ambiguous)
    items.push({
      item_id: `mmc_field_${digestCanonicalValue(
        {
          left: ambiguous.left.map(({ item }) => item.token),
          right: ambiguous.right.map(({ item }) => item.token),
        },
        "Managed comparison",
      )}`,
      status: "unknown",
      left: null,
      right: null,
      match: {
        status: "ambiguous",
        basis: ambiguous.basis,
        confidence: "unknown",
        candidate_left_tokens: ambiguous.left.map(({ item }) => item.token),
        candidate_right_tokens: ambiguous.right.map(({ item }) => item.token),
      },
      evidence_links: [context.leftEvidenceId, context.rightEvidenceId],
      limitations: [
        ambiguityLimitation(
          "fields",
          ambiguous.basis,
          ambiguous.left.some((item) => item.identityUnavailable) ||
            ambiguous.right.some((item) => item.identityUnavailable),
        ),
      ],
    });
  const undecoded = undecodedOneSidedNames(
    matches,
    context.signatureResolutionExamined,
  );
  for (const item of matches.leftOnly)
    items.push(
      fieldOnlyItem(
        { left: item.item },
        item.identity,
        item.identityUnavailable,
        context,
        undecoded,
      ),
    );
  for (const item of matches.rightOnly)
    items.push(
      fieldOnlyItem(
        { right: item.item },
        item.identity,
        item.identityUnavailable,
        context,
        undecoded,
      ),
    );
  return items;
};
