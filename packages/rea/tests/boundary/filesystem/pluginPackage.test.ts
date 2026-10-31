import { expect, it } from "vitest";

import { pluginPackageMetadata } from "../../../scripts/lib/plugin-package.mjs";

const fixture = () => ({
  manifest: {
    name: "rea-agents",
    version: "6.8.0",
    dependencies: { runtime: "1.0.0" },
    devDependencies: { builder: "1.0.0" },
    overrides: { builder: { nested: "2.0.0" } },
  },
  lock: {
    name: "rea-agents",
    version: "6.8.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "rea-agents",
        version: "6.8.0",
        dependencies: { runtime: "1.0.0" },
        devDependencies: { builder: "1.0.0" },
      },
      "node_modules/runtime": { version: "1.0.0", integrity: "source digest" },
      "node_modules/builder": { version: "1.0.0", dev: true },
      "node_modules/builder/node_modules/nested": {
        version: "2.0.0",
        dev: true,
      },
      "node_modules/optional": {
        version: "1.0.0",
        devOptional: true,
        optional: true,
      },
    },
  },
});

it("preserves locked runtime facts and optional dependencies without mutating source metadata", () => {
  const source = fixture();
  const before = structuredClone(source);
  const packed = pluginPackageMetadata(source.manifest, source.lock);
  expect(source).toEqual(before);
  expect(packed.packageJson).toEqual({
    name: "rea-agents",
    version: "6.8.0",
    dependencies: { runtime: "1.0.0" },
    bundleDependencies: ["runtime"],
  });
  expect(packed.shrinkwrap.packages).toEqual({
    "": {
      name: "rea-agents",
      version: "6.8.0",
      dependencies: { runtime: "1.0.0" },
    },
    "node_modules/runtime": source.lock.packages["node_modules/runtime"],
    "node_modules/optional": source.lock.packages["node_modules/optional"],
  });
});

it("refuses to discard a security override when the package is also used at runtime", () => {
  const { manifest, lock } = fixture();
  lock.packages["node_modules/builder"].dev = false;
  expect(() => pluginPackageMetadata(manifest, lock)).toThrow(
    "runtime or unresolved override: builder",
  );
});

it("fails when an override cannot be attributed to the locked development tree", () => {
  const { manifest, lock } = fixture();
  delete (lock.packages as Record<string, unknown>)["node_modules/builder"];
  expect(() => pluginPackageMetadata(manifest, lock)).toThrow(
    "runtime or unresolved override: builder",
  );
});

it("refuses a stale lock before producing a release artifact", () => {
  const { manifest, lock } = fixture();
  lock.packages[""].version = "6.7.0";
  expect(() => pluginPackageMetadata(manifest, lock)).toThrow(
    "matching v3 package lock",
  );
});
