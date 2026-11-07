import {
  mkdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { historicalSourceGraphSchema } from "../../../src/domain/referenceSourceGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

describe.skipIf(process.platform === "win32")(
  "compiled reference-source exclusion provenance",
  () => {
    cliTest(
      "imports source beside a link into a default-excluded directory",
      async ({ cli }) => {
        const root = await createTestTempDirectory(
          "rea-reference-link-exclusion-",
        );
        await mkdir(join(root, "dist"));
        const source = "export const value = 1;\n";
        await writeFile(join(root, "source.ts"), source);
        await symlink("dist", join(root, "alias"));
        const result = await cli.run({
          arguments: ["import-reference-source", root, "--json"],
          cwd: root,
          environment: {
            HOME: root,
            USERPROFILE: root,
            XDG_CONFIG_HOME: root,
            XDG_CACHE_HOME: root,
          },
        });
        expect(result.exitCode).toBe(0);
        const graph = historicalSourceGraphSchema.parse(result.json);
        expect(graph.inventory_state).toBe("partial");
        expect(graph.exclusions).toContainEqual({
          path: "dist",
          entry_kind: "directory",
          reason: "default-ignored",
          pattern: "dist/",
        });
        expect(graph.entries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: "alias",
              kind: "symlink",
              target: "dist",
              target_state: "internal",
            }),
            expect.objectContaining({
              path: "source.ts",
              kind: "file",
              content_state: "hashed",
            }),
          ]),
        );
        expect(graph.entries.some(({ path }) => path === "dist")).toBe(false);
        expect(await readFile(join(root, "source.ts"), "utf8")).toBe(source);
        expect(await readlink(join(root, "alias"))).toBe("dist");
      },
    );

    cliTest(
      "reports project, default, and explicit secret exclusions",
      async ({ cli }) => {
        const root = await createTestTempDirectory("rea-reference-exclusions-");
        const logs = join(root, "logs");
        await mkdir(logs);
        await Promise.all([
          writeFile(join(root, ".gitignore"), "project.tmp\n"),
          writeFile(join(root, "project.tmp"), "project policy\n"),
          writeFile(join(logs, "application.log"), "default policy\n"),
          writeFile(join(root, "private.txt"), "sensitive local file\n"),
          writeFile(join(root, "source.ts"), "export const value = 1;\n"),
        ]);

        const result = await cli.run({
          arguments: ["import-reference-source", root, "--json"],
          cwd: root,
          environment: {
            HOME: root,
            USERPROFILE: root,
            XDG_CONFIG_HOME: root,
            XDG_CACHE_HOME: root,
            REA_REFERENCE_SECRET_PATTERNS_JSON: '["private.txt"]',
          },
        });

        expect(result.exitCode).toBe(0);
        const graph = historicalSourceGraphSchema.parse(result.json);
        expect(graph.exclusions).toEqual(
          expect.arrayContaining([
            {
              path: "project.tmp",
              entry_kind: "file",
              reason: "project-ignored",
              pattern: "project.tmp",
            },
            {
              path: "logs/application.log",
              entry_kind: "file",
              reason: "default-ignored",
              pattern: "*.log",
            },
            {
              path: "private.txt",
              entry_kind: "file",
              reason: "configured-secret",
              pattern: "private.txt",
            },
          ]),
        );
        expect(graph.entries).toContainEqual(
          expect.objectContaining({ path: "source.ts", kind: "file" }),
        );
      },
    );
  },
);
