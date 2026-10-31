import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Record built-in catalog profile digests into the compiled runtime. Run after
// `tsc` and before bundling, so the digests come from the same compiled
// contracts and pinned schema converter that the runtime serves.
const compiledRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist",
);
const { createCatalogDigestProfiles } = await import(
  pathToFileURL(join(compiledRoot, "catalogIdentity.js")).href
);
// Retain only hashes, with every shared record frozen. Schemas remain owned by
// the compiled contracts and are converted once for all six identities.
const profiles = Object.entries(createCatalogDigestProfiles())
  .map(
    ([input, outputs]) =>
      `${JSON.stringify(input)}: Object.freeze({${Object.entries(outputs)
        .map(
          ([output, digests]) =>
            `${JSON.stringify(output)}: Object.freeze(${JSON.stringify(digests)})`,
        )
        .join(",")}})`,
  )
  .join(",");
await writeFile(
  join(compiledRoot, "recordedCatalogDigests.js"),
  `/** Recorded from compiled catalog profiles by scripts/record-catalog-digests.mjs; do not edit. */\nexport const RECORDED_CATALOG_DIGEST_PROFILES = Object.freeze({${profiles}});\n`,
  "utf8",
);
