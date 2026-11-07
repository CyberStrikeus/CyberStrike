import { createHmac } from "node:crypto";

/**
 * SHA-256 over `parts` in order.
 *
 * Each part is updated on its own. The Cutter proof prefix plus an exact-limit
 * request or response does not fit in one Node string.
 */
export const cutterBridgeMac = (
  token: string,
  parts: readonly [string, ...string[]],
): Buffer => {
  const mac = createHmac("sha256", token);
  for (const part of parts) mac.update(part);
  return mac.digest();
};
