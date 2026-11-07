import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";

/** Header facts admitted before an unsupported table layout was identified. */
export interface ManagedMetadataHeaderFacts {
  readonly version: string;
  readonly streamNames: readonly string[];
}

/** Bounded format or applicability failure retained as managed coverage. */
export class ManagedReaderFailure extends Error {
  readonly metadataHeader: ManagedMetadataHeaderFacts | null;

  constructor(
    readonly issue: ManagedParseIssue,
    options?: ErrorOptions & {
      readonly metadataHeader?: ManagedMetadataHeaderFacts;
    },
  ) {
    super(issue.detail, options);
    this.metadataHeader = options?.metadataHeader ?? null;
  }
}

/** A resource or unsupported layout leaves metadata unknown, not malformed. */
export const managedMetadataFailureStatus = (
  issue: ManagedParseIssue,
): "partial" | "malformed" =>
  issue.code === "resource-limit" || issue.code === "unsupported-metadata"
    ? "partial"
    : "malformed";

/** Malformed selected metadata is input failure for every inspection workflow. */
export const managedInspectionInputFailure = (
  operation: string,
  path: string,
  cause: unknown,
  inputField: "path" | "leftPath" | "rightPath" = "path",
): AnalysisInputError | undefined =>
  cause instanceof ManagedReaderFailure &&
  managedMetadataFailureStatus(cause.issue) === "malformed"
    ? new AnalysisInputError(operation, { cause }, [
        {
          path: [inputField],
          reason: "invalid_format",
          message: `Selected artifact ${path}: ${cause.issue.detail}`,
        },
      ])
    : undefined;

/** Construct a typed managed parse failure at an exact byte location. */
export const managedFailure = (
  code: ManagedParseIssue["code"],
  scope: string,
  detail: string,
  offset: number | null = null,
): ManagedReaderFailure =>
  new ManagedReaderFailure({ code, scope, offset, detail });

/** Retain one malformed item's location while allowing independent items to be read. */
export const readManagedValue = <Value>(
  operation: () => Value,
  issues: ManagedParseIssue[],
): Value | undefined => {
  try {
    return operation();
  } catch (cause: unknown) {
    if (
      !(cause instanceof ManagedReaderFailure) ||
      managedMetadataFailureStatus(cause.issue) === "partial"
    )
      throw cause;
    issues.push(cause.issue);
    return undefined;
  }
};

/** Preserve issue order while collapsing the same malformed producer fact across facets. */
export const uniqueManagedParseIssues = (
  issues: readonly ManagedParseIssue[],
): readonly ManagedParseIssue[] => [
  ...new Map(issues.map((issue) => [JSON.stringify(issue), issue])).values(),
];

/**
 * Append issue lists one issue at a time. Spreading a list into `push` passes
 * one argument per issue, which overflows the stack on large malformed inputs.
 */
export const appendManagedParseIssues = (
  issues: ManagedParseIssue[],
  ...found: readonly (readonly ManagedParseIssue[])[]
): void => {
  for (const list of found) for (const issue of list) issues.push(issue);
};
