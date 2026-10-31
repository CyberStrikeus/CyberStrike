import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { resolveCliJsonPaths } from "./cliJsonInput.js";
import { electronActiveObservationInputSchema } from "./domain/javascript/electronActiveObservation.js";

const paths = [
  ["executable_path"],
  ["application_path"],
  ["application_root"],
] as const;

describe("CLI JSON path normalization", () => {
  it.each([
    ["executable_path", ""],
    ["executable_path", " \t "],
    ["application_path", ""],
    ["application_path", " \t "],
    ["application_root", ""],
    ["application_root", " \t "],
  ])(
    "keeps blank %s (%j) invalid at the shared input boundary",
    (field, value) => {
      const input = {
        executable_path: "/synthetic/electron",
        application_path: "/synthetic/app",
        application_root: "/synthetic",
        [field]: value,
      };
      const parsed = electronActiveObservationInputSchema.safeParse(
        resolveCliJsonPaths(input, paths),
      );
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error("Expected blank path rejection");
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: [field] })]),
      );
      expect(input).toHaveProperty(field, value);
    },
  );

  it("resolves selected relative paths without trimming names or changing unrelated fields", () => {
    const input = {
      browser: { executable_path: " browser ", label: "relative-label" },
      application_path: "app",
    };
    expect(
      resolveCliJsonPaths(input, [["browser", "executable_path"]]),
    ).toEqual({
      browser: {
        executable_path: resolve(" browser "),
        label: "relative-label",
      },
      application_path: "app",
    });
    expect(input.browser.executable_path).toBe(" browser ");
  });

  it.skipIf(process.platform === "win32")(
    "keeps POSIX symlink-parent traversal for each selected JSON path",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "rea-json-caller-path-"));
      const originalCwd = process.cwd();
      try {
        await mkdir(join(root, "real/inner"), { recursive: true });
        await symlink(join(root, "real/inner"), join(root, "link"));
        process.chdir(root);
        const electronInput = {
          executable_path: "link/../tool",
          application_path: "link/../app",
          application_root: "link/../root",
        };
        const normalizedElectron = resolveCliJsonPaths(electronInput, paths);
        expect(normalizedElectron).toEqual({
          executable_path: `${root}/link/../tool`,
          application_path: `${root}/link/../app`,
          application_root: `${root}/link/../root`,
        });
        expect(electronInput.executable_path).toBe("link/../tool");
        expect(
          electronActiveObservationInputSchema.safeParse(normalizedElectron)
            .success,
        ).toBe(true);
        const browserInput = {
          browser: { executable_path: "link/../browser", label: "keep" },
        };
        expect(
          resolveCliJsonPaths(browserInput, [["browser", "executable_path"]]),
        ).toEqual({
          browser: {
            executable_path: `${root}/link/../browser`,
            label: "keep",
          },
        });
        expect(browserInput.browser.executable_path).toBe("link/../browser");
      } finally {
        process.chdir(originalCwd);
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    "file:///opt/electron",
    "FILE:electron",
    "https://example.test/app",
  ])("keeps URL %j distinguishable from a local path", (value) => {
    const expected = {
      executable_path: value,
      application_path: resolve("/synthetic/app"),
    };
    const input = { ...expected };
    const normalized = resolveCliJsonPaths(input, paths);
    expect(normalized).toEqual(expected);
    expect(input).toEqual(expected);
    const parsed = electronActiveObservationInputSchema.safeParse(normalized);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected URL path rejection");
    expect(parsed.error.issues).toEqual([
      expect.objectContaining({
        path: ["executable_path"],
        code: "invalid_format",
        message: expect.stringContaining("absolute local filesystem path"),
      }),
    ]);
  });

  it.each([
    "bin/electron",
    "release:v1/electron",
    "C:\\Electron\\electron.exe",
  ])("keeps resolving local path %j", (value) => {
    expect(resolveCliJsonPaths({ executable_path: value }, paths)).toEqual({
      executable_path: resolve(value),
    });
  });
});
