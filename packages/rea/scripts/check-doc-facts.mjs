import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertDocumentationFacts } from "./lib/docs-facts.mjs";
import { createProductCatalog } from "./lib/product-catalog.mjs";

if (process.argv.length > 2)
  throw new Error(`Unknown documentation check option: ${process.argv[2]}`);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await assertDocumentationFacts(root, await createProductCatalog(root));
