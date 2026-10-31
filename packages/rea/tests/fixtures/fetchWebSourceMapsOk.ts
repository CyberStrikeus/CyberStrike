import { fetchWebSourceMaps } from "../../src/browser/WebSourceMapFetcher.js";
import type { WebSourceMaps } from "../../src/domain/webBundleAnalysis.js";

/** Assert the successful producer branch in tests of completed map collections. */
export const fetchWebSourceMapsOk = async (
  ...args: Parameters<typeof fetchWebSourceMaps>
): Promise<WebSourceMaps> => {
  const result = await fetchWebSourceMaps(...args);
  if (!result.ok) throw result.error;
  return result.value;
};
