import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureGeneratedFile } from "./lib/generated-file.mjs";
import {
  createProductCatalog,
  serializeProductCatalog,
} from "./lib/product-catalog.mjs";

const arguments_ = new Set(process.argv.slice(2));
for (const argument of arguments_)
  if (argument !== "--check")
    throw new Error(`Unknown product catalog option: ${argument}`);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = await createProductCatalog(root);
const path = join(root, "docs/public/product-catalog.json");
if (!arguments_.has("--check")) await mkdir(dirname(path), { recursive: true });
await ensureGeneratedFile({
  path,
  source: await serializeProductCatalog(catalog),
  check: arguments_.has("--check"),
  generateCommand: "npm run docs:generate",
});
