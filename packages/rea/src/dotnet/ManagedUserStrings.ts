import {
  admitManagedProjection,
  managedDecodeBudget,
} from "./ManagedDecodeBudget.js";
import type {
  ManagedMemberInspection,
  ManagedParseIssue,
} from "../domain/managed/managedArtifact.js";
import type {
  DecodedMethod,
  ManagedUserString,
} from "./ManagedMemberInspectorCore.js";
import type { ManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import {
  readMetadataUserString,
  type MetadataTokenFact,
} from "./ManagedMetadataHeaps.js";
import { readManagedValue } from "./ManagedReaderFailure.js";

type UserStringInventory = NonNullable<ManagedMemberInspection["user_strings"]>;

/**
 * The literals with their own coverage, which never enters member coverage.
 * Issues are unique by construction, so they are not deduplicated: each
 * distinct token yields one failure or per-offset conformance issues, and a
 * missing stream is one issue.
 */
const inventory = (
  literals: ManagedUserString[],
  issues: ManagedParseIssue[],
  scanned: boolean,
): UserStringInventory => ({
  state: issues.length === 0 && scanned ? "complete" : "partial",
  literals,
  issues,
});

/** Bookkeeping per distinct ldstr token: its set entry and its sorted slot. */
const USER_STRING_TOKEN_BYTES = 128;

/** Decode each distinct #US literal an inspected method loads, in token order. */
export const parseUserStrings = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  parsed: {
    readonly methods: readonly DecodedMethod[];
    /** Methods that may be in scope but whose CIL was not fully scanned. */
    readonly unscannedMethods: number;
    /** Unreadable selected type names may hide a requested type. */
    readonly unreadableSelectedTypes?: number;
  },
): UserStringInventory => {
  const { methods } = parsed;
  const budget = managedDecodeBudget(layout);
  const scanned =
    parsed.unscannedMethods === 0 &&
    (parsed.unreadableSelectedTypes ?? 0) === 0;
  const userStrings: ManagedUserString[] = [];
  const issues: ManagedParseIssue[] = [];
  const tokens = new Map<number, MetadataTokenFact>();
  try {
    // Only ldstr loads a literal; a malformed ldtoken can carry a 0x70 token.
    for (const { tokenInstructions } of methods)
      for (const { opcode, reference } of tokenInstructions)
        if (opcode === "ldstr" && !tokens.has(reference.raw)) {
          budget.admitTransient(USER_STRING_TOKEN_BYTES, null);
          tokens.set(reference.raw, reference);
        }
    // Unsigned token order is the same as their fixed-width lowercase hex order.
    const references: MetadataTokenFact[] = [];
    for (const reference of [...tokens.values()].sort(
      (left, right) => left.raw - right.raw,
    )) {
      if (reference.table === 0x70) references.push(reference);
      else
        issues.push(
          admitManagedProjection(
            {
              code: "invalid-heap-index",
              scope: `metadata.#US:${reference.token}`,
              offset: null,
              detail: "ldstr operand does not name an item inside #US",
            },
            budget,
          ),
        );
    }
    if (references.length > 0 && layout.userStrings === null) {
      // A missing stream is one fact about the metadata, not one per token.
      issues.push(
        admitManagedProjection(
          {
            code: "missing-stream",
            scope: "metadata.#US",
            offset: null,
            detail: `${String(references.length)} distinct ldstr operand(s) reference #US, but the metadata has no #US stream`,
          },
          budget,
        ),
      );
      return inventory(userStrings, issues, scanned);
    }
    for (const reference of references) {
      const failures: ManagedParseIssue[] = [];
      readManagedValue(() => {
        const {
          offset,
          value,
          issues: observed,
        } = readMetadataUserString(bytes, layout, reference);
        for (const issue of observed) failures.push(issue);
        userStrings.push(
          admitManagedProjection(
            { token: reference.token, offset, value },
            budget,
          ),
        );
      }, failures);
      for (const failure of failures)
        issues.push(admitManagedProjection(failure, budget));
    }
    return inventory(userStrings, issues, scanned);
  } finally {
    budget.releaseTransient();
  }
};
