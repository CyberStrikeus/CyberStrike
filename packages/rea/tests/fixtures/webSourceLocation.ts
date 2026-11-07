import { createHash } from "node:crypto";
import type { WebSourceLocationArtifacts } from "../../src/application/WebSourceLocationPorts.js";
import { webModuleArtifactsFixture } from "./webModuleTrace.js";
import { traceSourceMap } from "../../src/javascript/sourceMaps/TraceSourceMap.js";
import type { WebSourceMapPort } from "../../src/application/WebSourceLocationPorts.js";
import { ok } from "../../src/domain/result.js";

/** Inert codec seam for workflow tests; real process verification is separate. */
export const webSourceMapDecoderFixture: WebSourceMapPort = {
  trace: (input) =>
    Promise.resolve(ok(traceSourceMap(input.text, input.url, input.position))),
};

/** Source-owned map fixture with independent byte identity and retained capture context. */
export const webSourceLocationFixture = (
  text = JSON.stringify({
    version: 3,
    sources: ["original.ts"],
    sourcesContent: ["original"],
    names: [],
    mappings: "AAAA",
  }),
): WebSourceLocationArtifacts => {
  const { importMap: _importMap, ...script } =
    webModuleArtifactsFixture("generated");
  return {
    ...script,
    sourceMap: {
      file: {
        path: "/analysis/app.js.map",
        sha256: createHash("sha256").update(text).digest("hex"),
        bytes: Buffer.byteLength(text),
      },
      url: "https://app.test/app.js.map?v=1#context",
      text,
    },
  };
};

/** Explicit fixture pairing; no capture authenticity or execution is asserted. */
export const webSourceLocationArgs = {
  manifest_path: "/analysis/manifest.json",
  script_index: 0,
  source_map: {
    path: "/analysis/app.js.map",
    url: "https://app.test/app.js.map?v=1#context",
  },
  generated_position: { line: 1, column: 0 },
};
