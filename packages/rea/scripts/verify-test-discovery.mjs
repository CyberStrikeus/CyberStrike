import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { compareTestDiscovery } from "./lib/test-discovery.mjs";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");

const temporary = await mkdtemp(join(tmpdir(), "rea-test-discovery-"));
let discovered;
try {
  const output = join(temporary, "discovery.json");
  await execute(
    process.execPath,
    [
      join(root, "node_modules/vitest/vitest.mjs"),
      "list",
      "--filesOnly",
      `--json=${output}`,
    ],
    { cwd: root, maxBuffer: 8 * 1024 * 1024 },
  );
  const files = await execute(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "src",
      "tests",
    ],
    { cwd: root, maxBuffer: 8 * 1024 * 1024 },
  );
  const expected = [];
  for (const path of files.stdout
    .split("\0")
    .filter((path) => path.endsWith(".test.ts"))) {
    try {
      if ((await stat(join(root, path))).isFile()) expected.push(path);
    } catch (cause) {
      if (cause.code !== "ENOENT") throw cause;
    }
  }
  const report = compareTestDiscovery(
    expected,
    JSON.parse(await readFile(output, "utf8")),
    root,
  );
  if (
    report.missing.length ||
    report.unexpected.length ||
    report.duplicates.length
  ) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } else discovered = report.discovered;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
if (discovered !== undefined)
  console.log(`Discovered all ${discovered} test files exactly once.`);
