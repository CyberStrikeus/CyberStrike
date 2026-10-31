import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { importReferenceSource } from "../../support/referenceSourceResourceScope.js";

const hashedSourceEntry = (path: string, source: string) => ({
  path,
  kind: "file",
  sha256: createHash("sha256").update(source).digest("hex"),
  size: Buffer.byteLength(source),
  language: "JavaScript",
  classifications: ["source"],
  content_state: "hashed",
  limitations: [],
});

const memberFixtures = [
  "require",
  "require.resolve",
  'require["resolve"]',
  "require.main",
  'require["main"]',
  'require[("resolve")]',
  'require["res\\u006flve"]',
  "require?.",
  "require.resolve?.",
  'require["resolve"]?.',
  "require?.resolve",
  'require?.["resolve"]',
  "(require?.resolve)",
].map((callee, index, callees) => ({
  callee,
  path: `member-${String(index).padStart(String(callees.length - 1).length, "0")}.cjs`,
}));

it("distinguishes computed require member values from literal members in source evidence", async () => {
  const root = await createTestTempDirectory("rea-reference-require-members-");
  const ignoredSources = [
    'require[resolve]("./dep.js");',
    'require[main]("./dep.js");',
    'const resolve = "toString"; require[resolve]("./dep.js");',
    'const main = "toString"; require[main]("./dep.js");',
    'const resolve = "resolve"; require[resolve]("./dep.js");',
    'const main = "main"; require[main]("./dep.js");',
    'const method = "resolve"; require[method]("./dep.js");',
    'require[`resolve`]("./dep.js");',
    'require["re" + "solve"]("./dep.js");',
    ...[
      "require.main?.",
      'require["main"]?.',
      "require?.[resolve]",
      "require?.main",
      'require?.["main"]',
      "require?.[main]",
      "require.resolve.call",
      "require.main.require",
      "module.require",
      "other.resolve",
      "other.require",
      "require.toString",
      'require["toString"]',
    ].map((callee) => `${callee}("./dep.js");`),
  ];
  const sources: Record<string, string> = {
    "computed.cjs": [
      'const resolve = "toString";',
      'const main = "toString";',
      'const value = require[resolve]("./dep.js");',
      'require[main]("./dep.js");',
      "console.log(typeof value);",
    ].join("\n"),
    "literal.cjs": 'console.log(require["resolve"]("./dep.js"));\n',
    "dep.js": 'throw new Error("The dependency must not execute");\n',
    "ignored.cjs": ignoredSources.map((source) => `{ ${source} }`).join("\n"),
    "unknown.cjs": [
      "function load(target) {",
      ...memberFixtures.flatMap(({ callee }) => [
        `  ${callee}(target);`,
        `  ${callee}(\`./dep.js\`);`,
        `  ${callee}(getTarget());`,
        `  ${callee}();`,
      ]),
      "  return import(target);",
      "}",
    ].join("\n"),
  };
  for (const { path, callee } of memberFixtures)
    sources[path] = `${callee}("./dep.js");\n`;
  await Promise.all(
    Object.entries(sources).map(([path, source]) =>
      writeFile(join(root, path), source),
    ),
  );

  // These owned producers demonstrate the member's runtime meaning without
  // loading the throwing dependency. The importer itself never executes them.
  const runNode = promisify(execFile);
  for (const [path, stdout] of [
    ["computed.cjs", "string\n"],
    ["literal.cjs", `${join(root, "dep.js")}\n`],
  ] as const) {
    const executed = await runNode(process.execPath, [join(root, path)], {
      cwd: root,
      timeout: 5_000,
    });
    expect(executed.stdout).toBe(stdout);
    expect(executed.stderr).toBe("");
  }

  const result = await importReferenceSource({
    root,
    caller: "reference-require-members-test",
    policy: { secretPatterns: [] },
  });
  if (!result.ok) throw result.error;
  const graph = result.value;
  expect(graph.parse_failures).toEqual([]);
  expect(graph.relationships).toEqual([
    {
      from_path: "ignored.cjs",
      to: "./dep.js",
      kind: "requires",
      resolution: "unknown",
      parse_state: "partial",
    },
    {
      from_path: "literal.cjs",
      to: "dep.js",
      kind: "requires",
      resolution: "internal",
      parse_state: "parsed",
    },
    ...memberFixtures.flatMap(({ callee, path }) =>
      callee === "require.main" || callee === 'require["main"]'
        ? []
        : [
            {
              from_path: path,
              to: "dep.js",
              kind: "requires",
              resolution: "internal",
              parse_state: "parsed",
            },
          ],
    ),
    {
      from_path: "unknown.cjs",
      to: "./dep.js",
      kind: "requires",
      resolution: "unknown",
      parse_state: "partial",
    },
    {
      from_path: "unknown.cjs",
      to: "<dynamic-import>",
      kind: "imports",
      resolution: "unknown",
      parse_state: "partial",
    },
    {
      from_path: "unknown.cjs",
      to: "dep.js",
      kind: "requires",
      resolution: "internal",
      parse_state: "parsed",
    },
  ]);
  expect(graph.entries).toHaveLength(Object.keys(sources).length);
  for (const [path, source] of Object.entries(sources))
    expect(graph.entries).toContainEqual(hashedSourceEntry(path, source));
});
