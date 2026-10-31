import { hasStableNativeSymbol } from "./native/nativeSymbol.js";
import { canonicalJson } from "./comparisonSemantics.js";
import {
  compareFunctionRelationships,
  type FunctionRelationshipComparison,
} from "./functionRelationshipComparison.js";
import { diffLines } from "diff";

import type {
  FunctionSnapshot,
  FunctionSnapshotCoordinateContext,
} from "./functionDossierEvidence.js";
import {
  commentProjection,
  identityProjection,
  nameAndSwiftProjection,
  normalizeCfg,
  referencedStringProjection,
  sorted,
  swiftLiteralCoverage,
  swiftLiteralSitesConflict,
} from "./functionComparisonNormalization.js";
import type {
  DimensionName,
  FunctionDimension,
} from "./functionComparisonSchemas.js";
import {
  dimensionResult,
  unresolvedDimension,
  type DimensionResultInput,
} from "./functionComparisonResults.js";

type ComparisonContext = Pick<
  DimensionResultInput,
  "links" | "providersDiffer"
> & {
  readonly sameEntry: boolean;
  readonly coordinateContext: FunctionSnapshotCoordinateContext;
};

export const compareDimensions = (
  left: FunctionSnapshot,
  right: FunctionSnapshot,
  context: ComparisonContext,
): FunctionDimension[] => {
  const relationships = compareFunctionRelationships(
    left,
    right,
    context.coordinateContext,
  );
  return [
    compareIdentity(left, right, context),
    compareText(
      "pseudocode",
      left.dossier.pseudocode,
      right.dossier.pseudocode,
      context,
    ),
    compareText(
      "assembly",
      left.dossier.assembly.join("\n"),
      right.dossier.assembly.join("\n"),
      context,
    ),
    compareComments(left, right, context),
    compareCalls(left, right, relationships.calls, context),
    compareReferences(relationships.references, context),
    compareStringsAndNames(left, right, context),
    compareCfg(left, right, context),
  ].map((result) => {
    const limitations = [
      ...facetLimitations(left, result.dimension).map(
        (reason) => `Left: ${reason}`,
      ),
      ...facetLimitations(right, result.dimension).map(
        (reason) => `Right: ${reason}`,
      ),
    ];
    return limitations.length === 0
      ? result
      : unresolvedDimension({
          dimension: result.dimension,
          links: context.links,
          leftCount: null,
          rightCount: null,
          limitations: [...result.limitations, ...limitations],
        });
  });
};

/** An empty undeclared facet is not evidence of observed absence. */
const facetLimitations = (
  snapshot: FunctionSnapshot,
  dimension: DimensionName,
): string[] => {
  const { dossier } = snapshot;
  const fields = {
    identity: [],
    pseudocode: [["pseudocode", dossier.pseudocode.length]],
    assembly: [["assembly", dossier.assembly.length]],
    comments: [["comments", dossier.comments.length]],
    calls: [
      ["callers", dossier.callers.length],
      ["callees", dossier.callees.length],
    ],
    references: [
      [
        "references",
        dossier.incoming_references.length + dossier.outgoing_references.length,
      ],
    ],
    strings_names: [
      [
        "strings_names",
        dossier.referenced_strings.length +
          dossier.referenced_names.length +
          (dossier.swift_string_literals?.length ?? 0),
      ],
    ],
    cfg: [["cfg", dossier.basic_blocks.length]],
  } satisfies Record<
    DimensionName,
    [keyof NonNullable<typeof dossier.facet_availability>, number][]
  >;
  return fields[dimension].flatMap(([field, count]) => {
    const availability = dossier.facet_availability?.[field];
    if (availability?.available === false)
      return [`${field}: ${availability.reason}`];
    return availability === undefined && count === 0
      ? [`${field}: Provider did not declare coverage for this empty facet.`]
      : [];
  });
};

const compareText = (
  dimension: "pseudocode" | "assembly",
  left: string,
  right: string,
  context: ComparisonContext,
): FunctionDimension => {
  const limitations = [
    "Exact provider text is compared without address or generated-name normalization; layout-only differences do not establish a behavior change.",
    ...(dimension === "assembly"
      ? [
          "Assembly is opaque provider text; relocation normalization is unavailable.",
        ]
      : []),
  ];
  if (context.providersDiffer)
    return unresolvedDimension({
      dimension,
      links: context.links,
      leftCount: [...left].length,
      rightCount: [...right].length,
      limitations: [
        ...limitations,
        "Exact text comparison requires one provider identity.",
      ],
    });
  const changes = diffLines(left, right, {
    timeout: 100,
    maxEditLength: 10_000,
  });
  if (changes === undefined)
    return unresolvedDimension({
      dimension,
      links: context.links,
      leftCount: [...left].length,
      rightCount: [...right].length,
      limitations: [
        ...limitations,
        "Bounded line diff exceeded its time or edit-distance limit.",
      ],
    });
  const delta = changes.reduce(
    (summary, change) => ({
      added_lines:
        summary.added_lines + (change.added ? (change.count ?? 0) : 0),
      removed_lines:
        summary.removed_lines + (change.removed ? (change.count ?? 0) : 0),
      hunks: summary.hunks + (change.added || change.removed ? 1 : 0),
    }),
    { added_lines: 0, removed_lines: 0, hunks: 0 },
  );
  return dimensionResult({
    dimension,
    status: delta.hunks === 0 ? "unchanged" : "changed",
    left,
    right,
    ...context,
    leftCount: [...left].length,
    rightCount: [...right].length,
    textDelta: delta,
    limitations,
  });
};

const compareComments = (
  left: FunctionSnapshot,
  right: FunctionSnapshot,
  context: ComparisonContext,
): FunctionDimension => {
  const leftValues = commentProjection(left);
  const rightValues = commentProjection(right);
  if (leftValues === null || rightValues === null)
    return unresolvedDimension({
      dimension: "comments",
      links: context.links,
      leftCount: left.dossier.comments.length,
      rightCount: right.dossier.comments.length,
      limitations: [
        "Comment locations could not be normalized relative to the function.",
      ],
    });
  return compareValues("comments", leftValues, rightValues, context);
};

const compareStringsAndNames = (
  left: FunctionSnapshot,
  right: FunctionSnapshot,
  context: ComparisonContext,
): FunctionDimension => {
  const complete =
    swiftLiteralCoverage(left) === swiftLiteralCoverage(right) &&
    swiftLiteralCoverage(left) !== "partial";
  const leftStrings = referencedStringProjection(left);
  const rightStrings = referencedStringProjection(right);
  const stringFacts = compareReferencedStrings(leftStrings, rightStrings);
  const leftNamesAndLiterals = nameAndSwiftProjection(left, complete);
  const rightNamesAndLiterals = nameAndSwiftProjection(right, complete);
  if (stringFacts.changed)
    return stringsAndNamesResult({
      leftStrings,
      rightStrings,
      leftNamesAndLiterals,
      rightNamesAndLiterals,
      context,
      status: "changed",
      limitations: [
        ...stringFacts.limitations,
        ...(leftNamesAndLiterals === null || rightNamesAndLiterals === null
          ? [
              "Reference source locations could not be normalized to function offsets.",
            ]
          : []),
        ...(complete
          ? []
          : [
              "Swift String literal coverage differs or is partial; complete coverage does not establish a differing literal.",
            ]),
      ],
    });
  if (leftNamesAndLiterals === null || rightNamesAndLiterals === null)
    return unresolvedDimension({
      dimension: "strings_names",
      links: context.links,
      leftCount: null,
      rightCount: null,
      limitations: [
        "Reference source locations could not be normalized to function offsets.",
      ],
    });
  const compared = compareValues(
    "strings_names",
    leftNamesAndLiterals,
    rightNamesAndLiterals,
    context,
  );
  if (compared.status === "changed")
    return stringsAndNamesResult({
      leftStrings,
      rightStrings,
      leftNamesAndLiterals,
      rightNamesAndLiterals,
      context,
      status: "changed",
      limitations: stringFacts.limitations,
    });
  // A retained literal differs only when the opposite dossier establishes its absence.
  if (swiftLiteralSitesConflict(left, right)) {
    const leftAll = nameAndSwiftProjection(left);
    const rightAll = nameAndSwiftProjection(right);
    if (leftAll !== null && rightAll !== null) {
      const literalComparison = compareValues(
        "strings_names",
        leftAll,
        rightAll,
        context,
      );
      if (literalComparison.status === "changed")
        return stringsAndNamesResult({
          leftStrings,
          rightStrings,
          leftNamesAndLiterals: leftAll,
          rightNamesAndLiterals: rightAll,
          context,
          status: "changed",
          limitations: stringFacts.limitations,
        });
    }
  }
  const limitations = [
    ...stringFacts.limitations,
    ...(complete
      ? []
      : [
          "Swift String literal coverage differs or is partial; complete coverage does not establish a differing literal.",
        ]),
  ];
  if (limitations.length === 0)
    return stringsAndNamesResult({
      leftStrings,
      rightStrings,
      leftNamesAndLiterals,
      rightNamesAndLiterals,
      context,
      status: "unchanged",
    });
  return unresolvedDimension({
    dimension: "strings_names",
    links: context.links,
    leftCount: null,
    rightCount: null,
    limitations,
  });
};

const stringsAndNamesResult = ({
  leftStrings,
  rightStrings,
  leftNamesAndLiterals,
  rightNamesAndLiterals,
  context,
  status,
  limitations = [],
}: {
  readonly leftStrings: readonly ReferencedStringFact[];
  readonly rightStrings: readonly ReferencedStringFact[];
  readonly leftNamesAndLiterals: readonly unknown[] | null;
  readonly rightNamesAndLiterals: readonly unknown[] | null;
  readonly context: ComparisonContext;
  readonly status: "changed" | "unchanged";
  readonly limitations?: readonly string[];
}): FunctionDimension =>
  dimensionResult({
    dimension: "strings_names",
    status,
    left: {
      referenced_strings: leftStrings,
      names_and_literals: leftNamesAndLiterals,
    },
    right: {
      referenced_strings: rightStrings,
      names_and_literals: rightNamesAndLiterals,
    },
    ...context,
    leftCount: leftStrings.length + (leftNamesAndLiterals?.length ?? 0),
    rightCount: rightStrings.length + (rightNamesAndLiterals?.length ?? 0),
    textDelta: null,
    limitations,
  });

type ReferencedStringFact = ReturnType<
  typeof referencedStringProjection
>[number];

const compareReferencedStrings = (
  left: readonly ReferencedStringFact[],
  right: readonly ReferencedStringFact[],
): { readonly changed: boolean; readonly limitations: readonly string[] } => {
  const leftGroups = groupStringsByOffset(left);
  const rightGroups = groupStringsByOffset(right);
  const leftUnlocated = leftGroups.get(null) !== undefined;
  const rightUnlocated = rightGroups.get(null) !== undefined;
  const limitations = new Set(
    [...left, ...right].flatMap(({ decoding_reason }) =>
      decoding_reason === null
        ? []
        : [`Referenced string decoding unavailable: ${decoding_reason}`],
    ),
  );
  let changed = false;
  for (const offset of new Set([...leftGroups.keys(), ...rightGroups.keys()])) {
    const leftRows = leftGroups.get(offset);
    const rightRows = rightGroups.get(offset);
    if (offset === null) {
      limitations.add(
        "Referenced string source location could not be normalized.",
      );
      continue;
    }
    if (leftRows === undefined || rightRows === undefined) {
      if (leftUnlocated || rightUnlocated)
        limitations.add(
          `Referenced string membership at source offset ${offset} is ambiguous because another source location is unavailable.`,
        );
      else changed = true;
      continue;
    }
    if (leftRows.length !== 1 || rightRows.length !== 1) {
      const repeated = compareRepeatedStringRows(leftRows, rightRows);
      if (repeated !== null) {
        changed ||= repeated.changed;
        for (const limitation of repeated.limitations)
          limitations.add(limitation);
        continue;
      }
      limitations.add(
        `Multiple referenced strings at source offset ${offset} cannot be paired without ambiguity.`,
      );
      continue;
    }
    const leftRow = leftRows[0];
    const rightRow = rightRows[0];
    if (leftRow === undefined || rightRow === undefined) continue;
    if (
      leftRow.content !== null &&
      rightRow.content !== null &&
      leftRow.content !== rightRow.content
    )
      changed = true;
    if (
      leftRow.metadata !== null &&
      rightRow.metadata !== null &&
      (leftRow.metadata.encoding !== rightRow.metadata.encoding ||
        leftRow.metadata.termination !== rightRow.metadata.termination ||
        leftRow.metadata.byte_length !== rightRow.metadata.byte_length)
    )
      changed = true;
    if ((leftRow.metadata === null) !== (rightRow.metadata === null))
      limitations.add(
        `Typed string metadata is unavailable at source offset ${offset}.`,
      );
    if (leftRow.content === null || rightRow.content === null) {
      if (leftRow.content !== null || rightRow.content !== null)
        limitations.add(
          `Referenced string content is unavailable on one side at source offset ${offset}.`,
        );
    }
  }
  return { changed, limitations: [...limitations] };
};

const compareRepeatedStringRows = (
  left: readonly ReferencedStringFact[],
  right: readonly ReferencedStringFact[],
): {
  readonly changed: boolean;
  readonly limitations: readonly string[];
} | null => {
  if (
    left.some(({ content }) => content === null) ||
    right.some(({ content }) => content === null)
  )
    return null;
  const leftByContent = groupStringsByContent(left);
  const rightByContent = groupStringsByContent(right);
  let changed = !sameMultiset(
    left.flatMap(({ content }) => (content === null ? [] : [content])),
    right.flatMap(({ content }) => (content === null ? [] : [content])),
  );
  const limitations = new Set<string>();
  for (const content of new Set([
    ...leftByContent.keys(),
    ...rightByContent.keys(),
  ])) {
    const leftRows = leftByContent.get(content) ?? [];
    const rightRows = rightByContent.get(content) ?? [];
    if (leftRows.length !== rightRows.length) continue;
    const leftMetadata = leftRows.map(({ metadata }) => metadata);
    const rightMetadata = rightRows.map(({ metadata }) => metadata);
    if (
      leftMetadata.every((metadata) => metadata === null) &&
      rightMetadata.every((metadata) => metadata === null)
    )
      continue;
    if (
      leftMetadata.some((metadata) => metadata === null) ||
      rightMetadata.some((metadata) => metadata === null)
    ) {
      limitations.add(
        "Typed string metadata is unavailable for repeated content at a source offset.",
      );
      continue;
    }
    changed ||= !sameMultiset(
      leftMetadata.map((metadata) => JSON.stringify(metadata)),
      rightMetadata.map((metadata) => JSON.stringify(metadata)),
    );
  }
  return { changed, limitations: [...limitations] };
};

const groupStringsByContent = (
  strings: readonly ReferencedStringFact[],
): Map<string, ReferencedStringFact[]> => {
  const groups = new Map<string, ReferencedStringFact[]>();
  for (const string of strings) {
    if (string.content === null) continue;
    const rows = groups.get(string.content);
    if (rows === undefined) groups.set(string.content, [string]);
    else rows.push(string);
  }
  return groups;
};

const sameMultiset = (
  left: Iterable<string>,
  right: Iterable<string>,
): boolean => {
  const leftValues = [...left].sort();
  const rightValues = [...right].sort();
  return (
    leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index])
  );
};

const groupStringsByOffset = (
  strings: readonly ReferencedStringFact[],
): Map<string | null, ReferencedStringFact[]> => {
  const groups = new Map<string | null, ReferencedStringFact[]>();
  for (const string of strings) {
    const rows = groups.get(string.source_offset);
    if (rows === undefined) groups.set(string.source_offset, [string]);
    else rows.push(string);
  }
  return groups;
};

const compareReferences = (
  compared: FunctionRelationshipComparison,
  context: ComparisonContext,
): FunctionDimension => {
  if (compared.status === "unknown")
    return unresolvedDimension({
      dimension: "references",
      links: context.links,
      leftCount: compared.leftCount,
      rightCount: compared.rightCount,
      limitations: compared.limitations,
    });
  return dimensionResult({
    dimension: "references",
    ...compared,
    ...context,
    textDelta: null,
  });
};

const compareIdentity = (
  left: FunctionSnapshot,
  right: FunctionSnapshot,
  context: ComparisonContext,
): FunctionDimension => {
  if (
    !context.sameEntry &&
    (!hasStableNativeSymbol(
      left.dossier.procedure.name,
      left.dossier.procedure.symbol,
    ) ||
      !hasStableNativeSymbol(
        right.dossier.procedure.name,
        right.dossier.procedure.symbol,
      ))
  )
    return unresolvedDimension({
      dimension: "identity",
      links: context.links,
      leftCount: null,
      rightCount: null,
      limitations: [
        "Empty names, generated symbols and unknown symbol origins do not establish cross-version identity.",
      ],
    });
  return compareValues(
    "identity",
    identityProjection(left),
    identityProjection(right),
    context,
  );
};

const compareCalls = (
  left: FunctionSnapshot,
  right: FunctionSnapshot,
  comparison: FunctionRelationshipComparison,
  context: ComparisonContext,
): FunctionDimension => {
  const coverageLimitations = [
    ...left.callCoverageBlockers.map((reason) => `Left: ${reason}`),
    ...right.callCoverageBlockers.map((reason) => `Right: ${reason}`),
  ];
  const coverageDiagnostics = [
    ...left.callCoverageDiagnostics.map((reason) => `Left: ${reason}`),
    ...right.callCoverageDiagnostics.map((reason) => `Right: ${reason}`),
  ];
  if (coverageLimitations.length > 0)
    return unresolvedDimension({
      dimension: "calls",
      links: context.links,
      leftCount: comparison.leftCount,
      rightCount: comparison.rightCount,
      limitations: [...coverageLimitations, ...coverageDiagnostics],
    });
  if (comparison.status === "unknown")
    return unresolvedDimension({
      dimension: "calls",
      links: context.links,
      leftCount: comparison.leftCount,
      rightCount: comparison.rightCount,
      limitations: [...comparison.limitations, ...coverageDiagnostics],
    });
  return dimensionResult({
    dimension: "calls",
    ...comparison,
    ...context,
    textDelta: null,
    limitations: [...comparison.limitations, ...coverageDiagnostics],
  });
};

const compareCfg = (
  left: FunctionSnapshot,
  right: FunctionSnapshot,
  context: ComparisonContext,
): FunctionDimension => {
  const leftBlocks = left.dossier.basic_blocks;
  const rightBlocks = right.dossier.basic_blocks;
  const leftGraph = normalizeCfg(leftBlocks);
  const rightGraph = normalizeCfg(rightBlocks);
  if (leftGraph === null || rightGraph === null)
    return unresolvedDimension({
      dimension: "cfg",
      links: context.links,
      leftCount: leftBlocks.length,
      rightCount: rightBlocks.length,
      limitations: [
        "CFG addresses could not be normalized to local block indices.",
      ],
    });
  return compareValues("cfg", leftGraph, rightGraph, context);
};

const compareValues = (
  dimension: DimensionName,
  left: unknown,
  right: unknown,
  context: ComparisonContext,
  limitations: readonly string[] = [],
): FunctionDimension => {
  const leftJson = canonicalJson(left, "Function comparison");
  const rightJson = canonicalJson(right, "Function comparison");
  return dimensionResult({
    dimension,
    status: leftJson === rightJson ? "unchanged" : "changed",
    left,
    right,
    ...context,
    leftCount: Array.isArray(left) ? left.length : null,
    rightCount: Array.isArray(right) ? right.length : null,
    textDelta: null,
    limitations,
  });
};
