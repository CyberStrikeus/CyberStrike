import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

const releases = (source: string) =>
  analyzeJavaScriptSemantics(source)
    .resourceOperations.filter(({ kind }) => kind === "release")
    .map(({ method, linkedResourceIds, resolution }) => ({
      method,
      linked: linkedResourceIds.length,
      resolution,
    }));

it.each([
  [
    "a declaration",
    `import { createReadStream } from "node:fs";
     const stream = createReadStream("input.txt");`,
  ],
  [
    "a later assignment",
    `import { createReadStream } from "node:fs";
     let stream;
     stream = createReadStream("input.txt");`,
  ],
  [
    "an awaited handle",
    `import { open } from "node:fs/promises";
     const stream = await open("input.txt");`,
  ],
  [
    "a nullish placeholder before the acquisition",
    `import { open } from "node:fs/promises";
     let stream = null;
     try { stream = await open("input.txt"); } finally {}`,
  ],
])(
  "keeps a release complete when the handle holds only %s",
  (_name, acquire) => {
    expect(releases(`${acquire}\nstream.close();`)).toEqual([
      { method: "close", linked: 1, resolution: "complete" },
    ]);
  },
);

it.each([
  ["an unconditional replacement", "stream = { destroy() {} };"],
  ["a conditional replacement", "if (flag) stream = { destroy() {} };"],
  ["a destructuring replacement", "({ stream } = other);"],
])("keeps a release partial after %s", (_name, replacement) => {
  expect(
    releases(`
      import { createReadStream } from "node:fs";
      let stream = createReadStream("input.txt");
      ${replacement}
      stream.destroy();
    `),
  ).toEqual([{ method: "destroy", linked: 1, resolution: "partial" }]);
});
