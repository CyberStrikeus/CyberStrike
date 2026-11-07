import { expect, it } from "vitest";

import { resolveArtifactPathByContext } from "./JavaScriptArtifactPathResolution.js";
import { JavaScriptJsonDocuments } from "./JavaScriptJsonDocuments.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";

const files = new Map(
  ["app/main.mjs", "shared/window.cjs", "rea-artifact/shared/window.cjs"].map(
    (path) => [
      path,
      {
        path,
        container_sha256: "a".repeat(64),
        sha256: "b".repeat(64),
        bytes: 0,
        inventory_artifact_id: path,
        kind: "javascript",
        unpacked: false,
        text: { included: true, value: "" },
      } satisfies JavaScriptArtifactFile,
    ],
  ),
);
const jsonDocuments = new JavaScriptJsonDocuments();

it.each([
  "../../rea-artifact/shared/window.cjs",
  "../%2e%2e/rea-artifact/shared/window.cjs",
  "%2e%2e/%2e%2e/rea-artifact/shared/window.cjs",
  "../../rea-artifact/shared/../shared/window.cjs",
])(
  "retains above-root traversal before synthetic URL normalization: %s",
  (declaredPath) => {
    const actual = new URL(declaredPath, "file:///selected-root/app/main.mjs");
    expect(actual.pathname.startsWith("/selected-root/")).toBe(false);
    expect(
      resolveArtifactPathByContext({
        declaredPath,
        sourcePath: "app/main.mjs",
        context: "module-specifier",
        moduleKind: "import",
        files,
        jsonDocuments,
      }),
    ).toMatchObject({ resolution_status: "rejected", resolved_path: null });
  },
);

it.each([
  ["../shared/window.cjs", "shared/window.cjs"],
  ["./discard%2Fsegment/../../shared/window.cjs", "shared/window.cjs"],
  ["./discard%/../../shared/window.cjs", "shared/window.cjs"],
  ["./%252e%252e/../../shared/window.cjs", "shared/window.cjs"],
  ["../rea-artifact/shared/window.cjs", "rea-artifact/shared/window.cjs"],
])(
  "retains an inside-root URL without banning synthetic-looking names: %s",
  (declaredPath, target) => {
    const actual = new URL(declaredPath, "file:///selected-root/app/main.mjs");
    expect(actual.pathname).toBe(`/selected-root/${target}`);
    expect(
      resolveArtifactPathByContext({
        declaredPath,
        sourcePath: "app/main.mjs",
        context: "module-specifier",
        moduleKind: "import",
        files,
        jsonDocuments,
      }),
    ).toMatchObject({ resolution_status: "resolved", resolved_path: target });
  },
);
