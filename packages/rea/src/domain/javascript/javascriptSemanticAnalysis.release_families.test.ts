import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

/**
 * Node's own objects expose different teardown members per acquisition, so a
 * member call that Node rejects must not be reported as a release. Every row is
 * a pair that throws at the call site on Node 24.22.1.
 */
const rejected = [
  [
    "a numeric descriptor from fs.openSync",
    `import { openSync } from "node:fs";
     const fd = openSync("input.txt", "r");
     fd.close();`,
  ],
  [
    "a numeric descriptor released with destroy",
    `import { openSync } from "node:fs";
     const fd = openSync("input.txt", "r");
     fd.destroy();`,
  ],
  [
    "the callback form of fs.open",
    `import { open } from "node:fs";
     const pending = open("input.txt", "r", () => {});
     pending.close();`,
  ],
  [
    "a read stream's byte-offset field",
    `import { createReadStream } from "node:fs";
     const stream = createReadStream("input.txt");
     stream.end();`,
  ],
  [
    "a FileHandle without a release member",
    `import { open } from "node:fs/promises";
     const handle = await open("input.txt");
     handle.destroy();`,
  ],
  [
    "a socket without close",
    `import { connect } from "node:net";
     const socket = connect(9);
     socket.close();`,
  ],
  [
    "a TLS socket without close",
    `import { connect } from "node:tls";
     const socket = connect(9);
     socket.close();`,
  ],
];

it.each(rejected)("emits no release for %s", (_name, source) => {
  expect(
    analyzeJavaScriptSemantics(source)
      .resourceOperations.filter(({ kind }) => kind === "release")
      .map(({ method }) => method),
  ).toEqual([]);
});

/** The pairs Node does support stay complete, so the filter is pure narrowing. */
const accepted = [
  [
    "a FileHandle closed",
    `import { open } from "node:fs/promises";
     const handle = await open("input.txt");
     handle.close();`,
    "close",
  ],
  [
    "a read stream destroyed",
    `import { createReadStream } from "node:fs";
     const stream = createReadStream("input.txt");
     stream.destroy();`,
    "destroy",
  ],
  [
    "a socket ended",
    `import { connect } from "node:net";
     const socket = connect(9);
     socket.end();`,
    "end",
  ],
];

it.each(accepted)("keeps %s complete", (_name, source, method) => {
  expect(
    analyzeJavaScriptSemantics(source)
      .resourceOperations.filter(({ kind }) => kind === "release")
      .map(({ method: released, resolution }) => ({
        method: released,
        resolution,
      })),
  ).toEqual([{ method, resolution: "complete" }]);
});

/**
 * A binding that can hold more than one acquisition stays partial even when a
 * method is admissible for one of them: the release is only certain if the
 * binding held exactly one acquisition before the filter ran.
 */
it.each([
  [
    "a FileHandle or a socket, released with close",
    `import { open } from "node:fs/promises";
     import { connect } from "node:net";
     let handle;
     if (flag) { handle = await open("input.txt"); }
     else { handle = connect(9); }
     handle.close();`,
    [{ method: "close", linked: 1, resolution: "partial" }],
  ],
  [
    "a read stream or a write stream, released with end",
    `import { createReadStream, createWriteStream } from "node:fs";
     let stream;
     if (flag) { stream = createReadStream("input.txt"); }
     else { stream = createWriteStream("output.txt"); }
     stream.end();`,
    [{ method: "end", linked: 1, resolution: "partial" }],
  ],
])("keeps %s partial", (_name, source, expected) => {
  expect(
    analyzeJavaScriptSemantics(source)
      .resourceOperations.filter(({ kind }) => kind === "release")
      .map(({ method, linkedResourceIds, resolution }) => ({
        method,
        linked: linkedResourceIds.length,
        resolution,
      })),
  ).toEqual(expected);
});
