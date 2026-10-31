/** Exact upstream release whose producer output is admitted by this adapter. */
export const WABT_VERSION = "1.0.42";
export const WABT_PROVIDER_IDENTITY = {
  id: "wabt-artifact",
  name: "REA WABT artifact adapter",
  version: `wabt@${WABT_VERSION}`,
} as const;
export const WABT_LIMITS = {
  inputBytes: 8 * 1024 * 1024,
  toolBytes: 64 * 1024 * 1024,
  outputBytes: 32 * 1024 * 1024,
} as const;
