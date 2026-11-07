import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { analysisErrorJsonSchema } from "../dist/contracts/errorSchemas.js";
import { formatGeneratedFile } from "./lib/format-generated-file.mjs";
import { ensureGeneratedFile } from "./lib/generated-file.mjs";

const arguments_ = new Set(process.argv.slice(2));
for (const argument of arguments_)
  if (argument !== "--check")
    throw new Error(`Unknown error schema option: ${argument}`);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await ensureGeneratedFile({
  path: join(root, "docs/error-contract.schema.json"),
  source: await formatGeneratedFile(
    "docs/error-contract.schema.json",
    JSON.stringify(analysisErrorJsonSchema),
  ),
  check: arguments_.has("--check"),
  generateCommand: "npm run docs:generate",
});
