import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  importReferenceSource,
  readReferenceSource,
} from "../../support/referenceSourceResourceScope.js";

const importTree = (root: string) =>
  importReferenceSource({
    root,
    caller: "native-entry-failure-detail-test",
    policy: { secretPatterns: [] },
  });

const permissionChecksUnavailable =
  process.platform === "win32" || process.getuid?.() === 0;

describe("reference import native entry failure details", () => {
  it.skipIf(permissionChecksUnavailable)(
    "classifies a root behind a blocked parent as an I/O failure",
    async () => {
      const directory = await createTestTempDirectory(
        "rea-reference-root-permission-",
      );
      const parent = join(directory, "blocked-parent");
      const root = join(parent, "source");
      await mkdir(root, { recursive: true });
      await chmod(parent, 0);
      try {
        const read = await readReferenceSource(root);
        expect(read).toMatchObject({
          ok: false,
          error: {
            tag: "reference-source-reader",
            code: "io",
            message: expect.stringContaining("EACCES"),
          },
        });
      } finally {
        await chmod(parent, 0o700);
      }
    },
  );

  it.skipIf(permissionChecksUnavailable)(
    "retains the actual operating-system reason for an unreadable file",
    async () => {
      const root = await createTestTempDirectory("rea-import-native-detail-");
      const path = join(root, "blocked.ts");
      await writeFile(path, "export const value = 1;\n");
      await chmod(path, 0);
      try {
        const read = await readReferenceSource(root);
        if (!read.ok) throw new Error(read.error.message);
        const failure = read.value.entries.find(
          (entry) => entry.status === "failed" && entry.path === "blocked.ts",
        );
        if (failure?.status !== "failed")
          throw new Error(
            "Owned permission fixture did not produce a read failure",
          );
        expect(failure.message).toContain("EACCES");
        expect(failure.localDiagnostic).toContain(path);
        const imported = await importTree(root);
        if (!imported.ok) throw new Error(imported.error.message);
        const entry = imported.value.entries.find(
          (item) => item.path === failure.path,
        );
        expect(entry?.limitations.join(" ")).toContain(failure.message);
        expect(entry?.local_diagnostics).toEqual([failure.localDiagnostic]);
      } finally {
        await chmod(path, 0o600);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "retains the unsupported file-type reason without suggesting another OS",
    async () => {
      const root = await createTestTempDirectory("rea-import-native-fifo-");
      await promisify(execFile)("mkfifo", [join(root, "events.pipe")], {
        timeout: 2_000,
      });
      const imported = await importTree(root);
      if (!imported.ok) throw new Error(imported.error.message);
      const entry = imported.value.entries.find(
        (item) => item.path === "events.pipe",
      );
      expect(entry?.limitations.join(" ")).toContain(
        "Entry is not a regular file",
      );
      expect(entry?.limitations.join(" ")).not.toContain("supported system");
    },
  );

  it.skipIf(process.platform === "win32")(
    "excludes secret-patterned paths before failure projection",
    async () => {
      const root = await createTestTempDirectory("rea-import-native-secret-");
      await promisify(execFile)("mkfifo", [join(root, "secret-events.pipe")], {
        timeout: 2_000,
      });
      const imported = await importReferenceSource({
        root,
        caller: "native-entry-secret-detail-test",
        policy: { secretPatterns: ["*secret*"] },
      });
      if (!imported.ok) throw new Error(imported.error.message);
      expect(
        imported.value.entries.find(
          (item) => item.path === "secret-events.pipe",
        ),
      ).toBeUndefined();
      expect(imported.value.exclusions).toContainEqual({
        path: "secret-events.pipe",
        entry_kind: "other",
        reason: "configured-secret",
        pattern: "*secret*",
      });
    },
  );

  it("preserves an ordinary readable source-file control", async () => {
    const root = await createTestTempDirectory("rea-import-native-readable-");
    await writeFile(join(root, "main.ts"), "export const value = 1;\n");
    const imported = await importTree(root);
    if (!imported.ok) throw new Error(imported.error.message);
    expect(
      imported.value.entries.find(({ path }) => path === "main.ts"),
    ).toMatchObject({ kind: "file", content_state: "hashed", limitations: [] });
  });
});

describe("reference import paths beyond the platform limit", () => {
  it.skipIf(process.platform === "win32")(
    "reports an entry beyond the absolute path limit as an I/O failure",
    async () => {
      const root = await createTestTempDirectory("rea-import-deep-path-");
      await writeFile(join(root, "kept.txt"), "k");
      // Relative creation lets the tree exceed PATH_MAX (1024 on macOS, 4096
      // on Linux) while each 200-byte component stays below NAME_MAX.
      const deepTree = (action: "create" | "remove") =>
        promisify(execFile)(process.execPath, [
          "-e",
          `const fs = require("node:fs");
          const names = Array.from({ length: 24 }, (_, i) => "d" + String(i).padStart(2, "0") + "x".repeat(197));
          process.chdir(${JSON.stringify(root)});
          if (${JSON.stringify(action)} === "create") {
            for (const name of names) { fs.mkdirSync(name); process.chdir(name); }
            fs.writeFileSync("deep.txt", "d");
          } else {
            for (const name of names) process.chdir(name);
            fs.rmSync("deep.txt");
            for (const name of [...names].reverse()) { process.chdir(".."); fs.rmdirSync(name); }
          }`,
        ]);
      await deepTree("create");
      try {
        const read = await readReferenceSource(root);
        if (!read.ok) throw new Error(read.error.message);
        expect(read.value.entries).toContainEqual(
          expect.objectContaining({ path: "kept.txt", status: "read" }),
        );
        const failed = read.value.entries.find(
          (entry) => entry.status === "failed",
        );
        expect(failed).toMatchObject({
          status: "failed",
          code: "io",
          message: expect.stringContaining("ENAMETOOLONG"),
        });
        const filteredRead = await readReferenceSource(root, {
          shouldExclude: (path, kind) =>
            path === failed?.path && kind === "directory",
        });
        if (!filteredRead.ok) throw new Error(filteredRead.error.message);
        expect(
          filteredRead.value.entries.find(
            (entry) => entry.path === failed?.path,
          ),
        ).toMatchObject({ status: "failed", kind: "unknown", code: "io" });
        const imported = await importTree(root);
        if (!imported.ok) throw new Error(imported.error.message);
        expect(imported.value.entries).toContainEqual(
          expect.objectContaining({
            path: "kept.txt",
            content_state: "hashed",
          }),
        );
        const deep = imported.value.entries.find(
          (entry) => entry.path === failed?.path,
        );
        expect(deep?.limitations.join(" ")).toContain(
          failed?.status === "failed" ? failed.message : "missing failure",
        );
        // A directory-only secret rule still applies when the kind is unknown.
        const secretPattern = `${failed?.path ?? "missing"}/`;
        const secret = await importReferenceSource({
          root,
          caller: "native-entry-failure-detail-test",
          policy: { secretPatterns: [secretPattern] },
        });
        if (!secret.ok) throw new Error(secret.error.message);
        expect(
          secret.value.entries.some(({ path }) => path === failed?.path),
        ).toBe(false);
        expect(secret.value.exclusions).toContainEqual({
          path: failed?.path,
          entry_kind: "unknown",
          reason: "configured-secret",
          pattern: secretPattern,
        });
      } finally {
        await deepTree("remove");
      }
    },
  );
});
