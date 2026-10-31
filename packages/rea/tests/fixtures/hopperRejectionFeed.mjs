/** Deterministic feed boundary for the package verifier's deliberately foreign launcher.
 * This fixture never authorizes a Hopper build or simulates successful cryptography.
 */
import { HOPPER_RELEASES_URL } from "../../dist/application/HopperReleaseFeed.js";

const systemFetch = globalThis.fetch;
const row = (suffix) => ({
  version: "fixture-current",
  filename: `https://www.hopperapp.com:443/downloader/public/Hopper-fixture-current-Linux-demo.${suffix}`,
  file_length: "1",
  file_hash: "0".repeat(40),
  main_exe_hash: "0".repeat(64),
  signature: "AQ==",
  public: "1",
  beta: "0",
});

globalThis.fetch = (input, options) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url !== HOPPER_RELEASES_URL) return systemFetch(input, options);
  options?.signal?.throwIfAborted();
  return Promise.resolve(
    new Response(
      JSON.stringify({
        "Ubuntu / Mint": row("deb"),
        Fedora: row("rpm"),
        Arch: row("pkg.tar.xz"),
      }),
    ),
  );
};
