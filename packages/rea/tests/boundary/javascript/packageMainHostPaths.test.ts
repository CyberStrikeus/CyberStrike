import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, it } from "vitest";

import { resolveStandaloneArtifactPath } from "../../support/javascriptArtifactPathResolution.js";
import type { JavaScriptArtifactFile } from "../../../src/domain/javascript/javascriptArtifactFiles.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeFixtureFiles } from "../../support/workspace/writeFixtureFiles.js";

it.each([
  "absolute-host",
  "relative-package",
  "inherited-main",
  "inherited-exports",
] as const)(
  "compares %s package selection with the native Node resolver",
  async (kind) => {
    const root = await createTestTempDirectory("rea-package-main-host-");
    const artifact = join(root, "artifact");
    const host = join(root, "host/window.cjs");
    const main = kind === "absolute-host" ? host : "entry.cjs";
    const metadata = kind.startsWith("inherited-") ? {} : { main };
    const contents = {
      "app/main.cjs": "throw new Error('Analyzed input must never execute');",
      "app/node_modules/fixture/package.json": JSON.stringify(metadata),
      "app/node_modules/fixture/entry.cjs":
        "throw new Error('Package input must never execute');",
      "app/node_modules/fixture/index.js":
        "throw new Error('Index decoy must never execute');",
      "shared/window.cjs":
        "throw new Error('Artifact-root decoy must never execute');",
    };
    await writeFixtureFiles(root, {
      "host/window.cjs": "throw new Error('Host input must never execute');",
      ...Object.fromEntries(
        Object.entries(contents).map(([path, value]) => [
          `artifact/${path}`,
          value,
        ]),
      ),
    });
    const loader = createRequire(join(artifact, "app/main.cjs"));
    const files = new Map<string, JavaScriptArtifactFile>(
      Object.entries(contents).map(([path, value]) => [
        path,
        {
          path,
          container_sha256: "a".repeat(64),
          sha256: "b".repeat(64),
          bytes: Buffer.byteLength(value),
          inventory_artifact_id: `fixture-${path}`,
          kind: path.endsWith("package.json") ? "package-json" : "javascript",
          unpacked: false,
          text: { included: true, value },
        },
      ]),
    );
    const property = kind === "inherited-exports" ? "exports" : "main";
    const previous = Object.getOwnPropertyDescriptor(
      Object.prototype,
      property,
    );
    let nativePath: string;
    let resolution: ReturnType<typeof resolveStandaloneArtifactPath>;
    try {
      if (kind.startsWith("inherited-"))
        Object.defineProperty(Object.prototype, property, {
          configurable: true,
          writable: true,
          value: property === "main" ? host : "./entry.cjs",
        });
      nativePath = loader.resolve("fixture");
      resolution = resolveStandaloneArtifactPath({
        declaredPath: "fixture",
        sourcePath: "app/main.cjs",
        context: "module-specifier",
        moduleKind: "require",
        files,
      });
    } finally {
      if (previous === undefined)
        Reflect.deleteProperty(Object.prototype, property);
      else Object.defineProperty(Object.prototype, property, previous);
    }
    const target = kind.startsWith("inherited-") ? "index.js" : "entry.cjs";
    expect(nativePath).toBe(
      kind === "absolute-host"
        ? host
        : join(artifact, "app/node_modules/fixture", target),
    );
    expect(resolution).toMatchObject({
      resolution_status: kind === "absolute-host" ? "unavailable" : "resolved",
      resolved_path:
        kind === "absolute-host" ? null : `app/node_modules/fixture/${target}`,
    });
  },
);
