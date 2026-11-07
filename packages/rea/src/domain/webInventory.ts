import { digestCanonicalValue } from "./canonicalDigest.js";

import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";

export interface WebInventoryResourceInput {
  readonly url: string;
  readonly origin: string | null;
  readonly type: string;
  readonly mime_type: string;
  readonly content_size: number | null;
}

export interface WebInventoryScriptInput {
  readonly url: string;
  readonly cdp_hash: string | null;
  readonly length: number | null;
  readonly is_module: boolean | null;
  readonly language: string | null;
  readonly source_map_url: string | null;
}

export interface StableWebResource extends WebInventoryResourceInput {
  readonly resource_key: string;
}

export type WebResourceReconciliation =
  | { readonly status: "exact"; readonly resource_key: string }
  | { readonly status: "ambiguous"; readonly candidate_resource_keys: string[] }
  | { readonly status: "unmatched"; readonly reason: "no_exact_sanitized_url" };

/**
 * Comparison identity excludes optional size evidence while preserving the
 * source inventory key.
 */
export const webResourceComparisonIdentity = (
  resource: WebInventoryResourceInput,
): string =>
  `resg_${digestCanonicalValue(
    {
      url: resource.url,
      origin: resource.origin,
      type: resource.type,
      mime_type: resource.mime_type,
    },
    "Web resource comparison identity",
  )}`;

/** Assign deterministic identities to a bounded resource inventory. */
export const stableWebResources = (
  resources: readonly WebInventoryResourceInput[],
): StableWebResource[] => {
  const keyed = resources.map((resource) => ({
    ...resource,
    resource_key: `res_${digestCanonicalValue(resource, "Web inventory")}`,
  }));
  return [
    ...new Map(
      keyed.map((resource) => [resource.resource_key, resource]),
    ).values(),
  ].sort(
    (left, right) =>
      compareUnicodeCodePoints(left.resource_key, right.resource_key) ||
      compareUnicodeCodePoints(left.url, right.url),
  );
};

/** Index one capture's observations without merging duplicate raw URLs. */
export const createCapturedWebScriptReconciler = (
  rawResources: readonly (WebInventoryResourceInput & {
    readonly rawUrl: string;
  })[],
  resources: readonly StableWebResource[],
): ((
  script: WebInventoryScriptInput & {
    readonly rawUrl: string;
  },
) => WebResourceReconciliation) => {
  // null means multiple observations, even when their public facts deduplicate.
  const rawByUrl = new Map<string, (typeof rawResources)[number] | null>();
  for (const resource of rawResources)
    rawByUrl.set(
      resource.rawUrl,
      rawByUrl.has(resource.rawUrl) ? null : resource,
    );
  const keysByUrl = new Map<string, string[]>();
  for (const resource of resources) {
    const keys = keysByUrl.get(resource.url);
    if (keys === undefined)
      keysByUrl.set(resource.url, [resource.resource_key]);
    else keys.push(resource.resource_key);
  }
  for (const [url, keys] of keysByUrl)
    if (keys.length > 1) keysByUrl.set(url, [...new Set(keys)].sort());
  return (script) => {
    const resource = rawByUrl.get(script.rawUrl);
    if (resource !== undefined && resource !== null) {
      const { rawUrl: _rawUrl, ...publicResource } = resource;
      const stable = stableWebResources([publicResource])[0];
      if (stable !== undefined)
        return { status: "exact", resource_key: stable.resource_key };
    }
    const candidates = keysByUrl.get(script.url);
    if (candidates !== undefined)
      return {
        status: "ambiguous",
        candidate_resource_keys: [...candidates],
      };
    return { status: "unmatched", reason: "no_exact_sanitized_url" };
  };
};

/** Stable script identity excludes target IDs, CDP script IDs, and timestamps. */
export const stableWebScriptKey = (script: WebInventoryScriptInput): string =>
  `scr_${digestCanonicalValue(
    {
      url: script.url,
      cdp_hash: script.cdp_hash,
      length: script.length,
      is_module: script.is_module,
      language: script.language,
      source_map_url: script.source_map_url,
    },
    "Web inventory",
  )}`;
