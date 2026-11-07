import { writeFileSync } from "node:fs";

// Keep argument boundaries intact so verifier consumers never parse shell display text.
writeFileSync(
  process.env.REA_NPX_LOG,
  JSON.stringify(process.argv.slice(2)) + "\n",
);
process.stdout.write("│ ✓ Cursor: isolated │\n");
