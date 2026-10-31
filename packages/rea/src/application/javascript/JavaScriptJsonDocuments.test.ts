import { expect, it } from "vitest";

import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import { JavaScriptJsonDocuments } from "./JavaScriptJsonDocuments.js";

type MutableArtifactFile = {
  -readonly [Key in keyof JavaScriptArtifactFile]: JavaScriptArtifactFile[Key];
};

const mutableFile = (): MutableArtifactFile => ({
  path: "package.json",
  container_sha256: "container-a",
  sha256: "file-a",
  bytes: 13,
  inventory_artifact_id: "inventory-a",
  kind: "package-json",
  unpacked: false,
  text: { included: true, value: '{"main":"a.cjs"}' },
});

it("retains only declared package metadata despite inherited host fields", () => {
  const documents = new JavaScriptJsonDocuments();
  const absentFile = mutableFile();
  absentFile.text = { included: true, value: "{}" };
  const declaredFile = mutableFile();
  declaredFile.text = {
    included: true,
    value:
      '{"name":"source-name","version":"1.0.0","main":null,"browser":"source-browser.cjs"}',
  };
  const inherited = {
    name: "host-name",
    version: "host-version",
    main: "host-entry.cjs",
    renderer: "host-renderer.cjs",
    browser: "host-browser.cjs",
    module: "host-module.mjs",
  };
  const previous = Object.fromEntries(
    Object.keys(inherited).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(Object.prototype, key),
    ]),
  );
  let absent: ReturnType<JavaScriptJsonDocuments["read"]>;
  let declared: ReturnType<JavaScriptJsonDocuments["read"]>;
  try {
    for (const [key, value] of Object.entries(inherited))
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        writable: true,
        value,
      });
    absent = documents.read(absentFile);
    declared = documents.read(declaredFile);
  } finally {
    for (const key of Object.keys(inherited)) {
      const descriptor = previous[key];
      if (descriptor === undefined)
        Reflect.deleteProperty(Object.prototype, key);
      else Object.defineProperty(Object.prototype, key, descriptor);
    }
  }
  expect(absent.status).toBe("included");
  expect(declared.status).toBe("included");
  if (absent.packageFields === null || declared.packageFields === null)
    throw new Error("Expected package metadata fields");
  expect(Object.getPrototypeOf(absent.packageFields)).toBeNull();
  expect(Object.getPrototypeOf(declared.packageFields)).toBeNull();
  for (const key of Object.keys(inherited))
    expect(Object.hasOwn(absent.packageFields, key)).toBe(false);
  expect(declared.packageFields).toEqual({
    name: "source-name",
    version: "1.0.0",
    main: null,
    browser: "source-browser.cjs",
  });
  expect(Object.hasOwn(declared.packageFields, "renderer")).toBe(false);
  expect(Object.hasOwn(declared.packageFields, "module")).toBe(false);
});

it("reparses changed text and availability on a reused file object", () => {
  const documents = new JavaScriptJsonDocuments();
  const file = mutableFile();
  const original = documents.read(file);
  expect(original).toMatchObject({
    status: "included",
    packageFields: { main: "a.cjs" },
  });

  file.text = { included: true, value: "{" };
  const invalid = documents.read(file);
  expect(invalid.status).toBe("invalid");

  file.text = { included: false, reason: "invalid-utf8" };
  const unavailable = documents.read(file);
  expect(unavailable).toMatchObject({
    status: "unavailable",
    reason: "invalid-utf8",
  });

  file.text = { included: true, value: '{"main":"b.cjs"}' };
  const updated = documents.read(file);
  expect(updated).toMatchObject({
    status: "included",
    packageFields: { main: "b.cjs" },
  });
  expect(original).toMatchObject({
    status: "included",
    source: { path: "package.json" },
    packageFields: { main: "a.cjs" },
  });
  expect(invalid.status).toBe("invalid");
  expect(unavailable.status).toBe("unavailable");
});

it("rebuilds source provenance when path and content digests change", () => {
  const documents = new JavaScriptJsonDocuments();
  const file = mutableFile();
  const original = documents.read(file);

  file.path = "nested/package.json";
  const moved = documents.read(file);
  expect(moved.source.path).toBe("nested/package.json");

  file.container_sha256 = "container-b";
  const recontained = documents.read(file);
  expect(recontained.source).toMatchObject({
    path: "nested/package.json",
    container_sha256: "container-b",
    sha256: "file-a",
  });

  file.sha256 = "file-b";
  const rehashed = documents.read(file);
  expect(rehashed.source).toMatchObject({
    path: "nested/package.json",
    container_sha256: "container-b",
    sha256: "file-b",
  });
  expect(original.source).toEqual({
    path: "package.json",
    container_sha256: "container-a",
    sha256: "file-a",
  });
  expect(original).toMatchObject({
    status: "included",
    packageFields: { main: "a.cjs" },
  });
});

it("retains only syntax and keys for ordinary JSON, with package fields scoped to its format", () => {
  const documents = new JavaScriptJsonDocuments();
  const file = mutableFile();
  file.kind = "json";
  file.text = {
    included: true,
    value: '{"exports":{"nested":["large config"]},"main":"entry.cjs"}',
  };
  const ordinary = documents.read(file);
  expect(ordinary).toMatchObject({
    status: "included",
    topLevelKeys: ["exports", "main"],
    packageFields: null,
  });
  file.kind = "package-json";
  expect(documents.read(file)).toMatchObject({
    status: "included",
    packageFields: { main: "entry.cjs", exports: { nested: ["large config"] } },
  });
  expect(ordinary.packageFields).toBeNull();
});
