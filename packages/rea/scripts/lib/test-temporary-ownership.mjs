const OWNED_ENTRY = /^(?:rea-|bb-session-)/u;
const SAFE_PREFIX = /^[A-Za-z0-9][A-Za-z0-9._-]*-$/u;

/** Recognize test resources independently of their readiness or contents. */
export const isOwnedTestTemporaryName = (name) => OWNED_ENTRY.test(name);

/** Preserve caller labels while making every shared fixture root recognizable. */
export function normalizeTestTemporaryPrefix(prefix) {
  if (
    typeof prefix !== "string" ||
    !SAFE_PREFIX.test(prefix) ||
    prefix.length > 80
  )
    throw new TypeError(
      "Test temporary directory prefixes must be safe basenames ending in '-'",
    );
  return isOwnedTestTemporaryName(prefix) ? prefix : `rea-${prefix}`;
}
