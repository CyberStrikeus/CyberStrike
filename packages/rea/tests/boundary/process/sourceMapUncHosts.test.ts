import { expect } from "vitest";

import { processTest } from "../../support/process/processFixture.js";

const cases = [
  {
    name: "soft hyphen U+00AD",
    source: "\\\\\u00ad\\share\\source.ts",
    expected: { kind: "unresolved" },
  },
  {
    name: "zero width non joiner U+200C",
    source: "\\\\\u200c\\share\\source.ts",
    expected: { kind: "unresolved" },
  },
  {
    name: "ASCII delimiter",
    source: "\\\\bad#host\\share\\source.ts",
    expected: { kind: "unresolved" },
  },
  {
    name: "empty host",
    source: "\\\\\\share\\source.ts",
    expected: { kind: "unresolved" },
  },
  {
    name: "normal host",
    source: "\\\\server\\share\\source.ts",
    expected: { kind: "suffix", path: "server/share/source.ts" },
  },
  {
    name: "valid IDNA host",
    source: "\\\\bücher.example\\share\\source.ts",
    expected: { kind: "suffix", path: "bücher.example/share/source.ts" },
  },
  {
    name: "nonempty normalized host",
    source: "\\\\\u00adserver\\share\\source.ts",
    expected: { kind: "suffix", path: "server/share/source.ts" },
  },
  {
    name: "localhost host",
    source: "\\\\localhost\\share\\source.ts",
    expected: { kind: "suffix", path: "share/source.ts" },
  },
  {
    name: "drive letter",
    source: "C:\\src\\source.ts",
    expected: { kind: "suffix", path: "C:/src/source.ts" },
  },
  {
    name: "soft hyphen source root",
    source: "source.ts",
    root: "\\\\\u00ad\\share",
    expected: { kind: "unresolved" },
  },
  {
    name: "zero width non joiner source root",
    source: "source.ts",
    root: "\\\\\u200c\\share",
    expected: { kind: "unresolved" },
  },
] as const;

processTest.for(cases)(
  "resolves $name in an owned subprocess without a native abort",
  async (scenario, { processes }) => {
    const sourceRoot = "root" in scenario ? scenario.root : null;
    // Import the built production helper in a child. A native assertion must
    // become a failed signal assertion here, never terminate the Vitest worker.
    const result = await processes.run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { resolveJavaScriptSourceMapReferences } from "./dist/domain/javascript/javascriptSourceMapPaths.js";
       const [source, root] = JSON.parse(process.argv[1]);
       console.log(JSON.stringify(resolveJavaScriptSourceMapReferences([source], root, "maps/main.js.map")[0]));`,
        JSON.stringify([scenario.source, sourceRoot]),
      ],
      { timeoutMs: 10_000 },
    );
    expect(result.signal, result.stderr).toBeNull();
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      source_name: scenario.source,
      source_root: sourceRoot,
      map_path: "maps/main.js.map",
      resolution: scenario.expected,
    });
  },
);
