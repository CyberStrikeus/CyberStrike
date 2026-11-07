import type { CatalogDigestProfiles } from "./catalogIdentity.js";

/**
 * Digests of the six built-in input/output schema profiles, recorded
 * from the compiled contracts by `scripts/record-catalog-digests.mjs` after
 * compilation. Source runs leave this undefined and compute them on first use.
 */
export const RECORDED_CATALOG_DIGEST_PROFILES:
  | CatalogDigestProfiles
  | undefined = undefined;
