/**
 * Shared aggregate plaintext-work ceiling for archive-backed operations.
 * ZIP compression and PCK aliases can both multiply hashing and output bytes.
 * Charge every readable logical occurrence, including repeated physical ranges.
 *
 * Keep the existing ZIP policy: a 256 MiB floor and 500 times the encoded archive
 * size. Large real packages retain proportionally large budgets without granting
 * a fixed per-member allowance. PCK callers use the actual pack span, excluding
 * an embedded executable carrier. The safe-integer ceiling preserves exact byte
 * accounting at the JSON/number boundary.
 */
export const ARTIFACT_EXPANSION_RATIO = 500;
export const MINIMUM_ARTIFACT_EXPANDED_BYTES = 256 * 1024 * 1024;

/** Largest total readable plaintext bytes for this encoded archive span. */
export const artifactExpansionBudgetBytes = (archiveBytes: number): number =>
  Math.max(
    MINIMUM_ARTIFACT_EXPANDED_BYTES,
    Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.floor(archiveBytes) * ARTIFACT_EXPANSION_RATIO,
    ),
  );
