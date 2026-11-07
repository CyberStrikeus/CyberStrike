import { z } from "zod";

/** Coverage metadata for the bounded projection of candidate relationships. */
export const bridgeCandidateCoverageSchema = z.strictObject({
  status: z.enum(["complete", "partial"]),
  total_candidates: z.int().nonnegative(),
  emitted_candidates: z.int().nonnegative(),
  omitted_candidates: z.int().nonnegative(),
});

// The serialized candidate array is the retained representation; accounting
// its exact UTF-8 JSON size bounds both array objects and repeated path strings.
/** Maximum UTF-8 JSON size of a retained candidate array. */
export const MAX_BRIDGE_CANDIDATE_JSON_BYTES = 2 * 1024 * 1024;

type PathComponent = { readonly path: string };

const jsonText = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new TypeError("Bridge candidate is not JSON serializable");
  return serialized;
};

/** Retain a deterministic prefix of grouped Cartesian candidates within a byte budget. */
export const projectCartesianCandidates = <
  TLeft extends PathComponent,
  TRight extends PathComponent,
  TCandidate,
>(input: {
  readonly groups: readonly {
    readonly left: readonly TLeft[];
    readonly right: readonly TRight[];
  }[];
  readonly createCandidate: (leftPath: string, right: TRight) => TCandidate;
}) => {
  const total = input.groups.reduce(
    (sum, group) => sum + group.left.length * group.right.length,
    0,
  );
  const preparedGroups = input.groups.map((group) => ({
    left: group.left.map((value) => ({
      value,
      pathBytes: Buffer.byteLength(jsonText(value.path)),
    })),
    right: group.right.map((value) => {
      const emptyLeftCandidate = jsonText(input.createCandidate("", value));
      return {
        value,
        rowOverhead: Buffer.byteLength(emptyLeftCandidate) - 2,
      };
    }),
  }));
  let estimatedFullBytes = 2 + Math.max(0, total - 1); // JSON array brackets and commas.
  for (const group of preparedGroups) {
    estimatedFullBytes +=
      group.left.length *
        group.right.reduce((sum, { rowOverhead }) => sum + rowOverhead, 0) +
      group.right.length *
        group.left.reduce((sum, { pathBytes }) => sum + pathBytes, 0);
  }

  const shouldEmitAll = estimatedFullBytes <= MAX_BRIDGE_CANDIDATE_JSON_BYTES;
  const candidates: TCandidate[] = [];
  let estimatedRetainedBytes = 2;
  candidateLoop: for (const group of preparedGroups) {
    for (const left of group.left) {
      for (const right of group.right) {
        const candidateBytes = right.rowOverhead + left.pathBytes;
        const additionalBytes =
          candidateBytes + (candidates.length > 0 ? 1 : 0);
        if (
          !shouldEmitAll &&
          estimatedRetainedBytes + additionalBytes >
            MAX_BRIDGE_CANDIDATE_JSON_BYTES
        )
          break candidateLoop;
        candidates.push(input.createCandidate(left.value.path, right.value));
        estimatedRetainedBytes += additionalBytes;
      }
    }
  }

  return {
    candidates,
    coverage: {
      status:
        candidates.length === total
          ? ("complete" as const)
          : ("partial" as const),
      total_candidates: total,
      emitted_candidates: candidates.length,
      omitted_candidates: total - candidates.length,
    },
  };
};
