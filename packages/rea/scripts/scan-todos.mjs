#!/usr/bin/env node

import { globSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

// Native globSync is available throughout the Node versions in package.engines.
// Its exclusion option is `exclude`; `ignore` and `nodir` belong to npm glob.
const sourceFiles = globSync(
  [
    "src/**/*.ts",
    "tests/**/*.ts",
    "scripts/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
    "bridge/**/*.py",
    "bridge/**/*.java",
  ],
  {
    cwd: root,
    exclude: (path) => path.split(/[\\/]/u).includes("node_modules"),
  },
);

const patterns = [
  { regex: /TODO(?::\s*(.*))?$/gm, label: "TODO" },
  { regex: /FIXME(?::\s*(.*))?$/gm, label: "FIXME" },
  { regex: /HACK(?::\s*(.*))?$/gm, label: "HACK" },
];

let count = 0;

for (const file of sourceFiles) {
  const content = readFileSync(resolve(root, file), "utf-8");
  for (const { regex, label } of patterns) {
    for (const match of content.matchAll(regex)) {
      const comment = (match[1] ?? "").trim();
      const line = content.slice(0, match.index).split("\n").length;
      console.log(
        `${relative(root, resolve(root, file))}:${line}: ${label}${comment ? ` - ${comment}` : ""}`,
      );
      count++;
    }
  }
}

if (count > 0) {
  console.log(`\n${count} tech-debt marker(s) found.`);
  process.exitCode = 1;
} else {
  console.log("No tech-debt markers found.");
}
