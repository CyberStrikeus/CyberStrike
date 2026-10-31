import canonicalize from "canonicalize";

/** Whether an inventory can support a claim that an item is absent. */
export const absenceClaimable = (coverage: {
  readonly status: string;
  readonly truncated?: boolean;
  readonly omitted_count?: number | null;
}): boolean =>
  coverage.status === "complete" &&
  coverage.truncated !== true &&
  (coverage.omitted_count === undefined || coverage.omitted_count === 0);

/** Canonical JSON used for deterministic tie breaking and stable digests. */
export const canonicalJson = (
  value: unknown,
  context = "Comparison",
): string => {
  const encoded = canonicalize(value);
  if (encoded === undefined)
    throw new TypeError(`${context} could not canonicalize data`);
  return encoded;
};
