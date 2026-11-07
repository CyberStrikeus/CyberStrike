import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { historicalSourceGraphSchema } from "../../../src/domain/referenceSourceGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "retains malformed source bytes without inventing decoded import targets",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-reference-utf8-");
    const sources = new Map([
      [
        "invalid.mjs",
        Buffer.concat([
          Buffer.from('import "./caf'),
          Buffer.from([0xff]),
          Buffer.from('.js";\n'),
        ]),
      ],
      [
        "comment.ts",
        Buffer.concat([
          Buffer.from('import "./dep.js"; // '),
          Buffer.from([0xc0, 0xaf]),
        ]),
      ],
      ["valid.mjs", Buffer.from('import "./caf�.js";\n')],
      ["caf�.js", Buffer.from("export const value = 1;\n")],
      ["dep.js", Buffer.from("export const value = 2;\n")],
    ]);
    await Promise.all(
      [...sources].map(([path, bytes]) => writeFile(join(root, path), bytes)),
    );
    const result = await cli.run({
      arguments: ["import-reference-source", root, "--json"],
      environment: { HOME: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root },
    });
    expect(result.exitCode, result.stderr + JSON.stringify(result.json)).toBe(
      0,
    );
    const graph = historicalSourceGraphSchema.parse(result.json);
    expect(graph.parse_failures).toEqual([
      {
        path: "comment.ts",
        parser: "utf-8",
        reason:
          "Source bytes are not valid UTF-8; import targets were not parsed.",
      },
      {
        path: "invalid.mjs",
        parser: "utf-8",
        reason:
          "Source bytes are not valid UTF-8; import targets were not parsed.",
      },
    ]);
    expect(graph.relationships).toEqual([
      {
        from_path: "valid.mjs",
        to: "caf�.js",
        kind: "imports",
        resolution: "internal",
        parse_state: "parsed",
      },
    ]);
    for (const [path, bytes] of sources)
      expect(graph.entries).toContainEqual(
        expect.objectContaining({
          path,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
          content_state: "hashed",
        }),
      );
  },
);

cliTest.skipIf(process.platform !== "linux")(
  "reports unsupported raw POSIX filename bytes without substituting a Unicode sibling",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-reference-raw-name-");
    const config = await createTestTempDirectory(
      "rea-reference-raw-name-config-",
    );
    const rawName = Buffer.from([0x62, 0x61, 0x64, 0xff, 0x2e, 0x6a, 0x73]);
    const rawPath = Buffer.concat([Buffer.from(`${root}/`), rawName]);
    await Promise.all([
      writeFile(rawPath, "RAW_FILE"),
      writeFile(join(root, "bad\ufffd.js"), "UNICODE_FILE"),
      writeFile(join(root, "good.js"), "GOOD_FILE"),
    ]);

    const result = await cli.run({
      arguments: ["import-reference-source", root, "--json"],
      environment: {
        HOME: config,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: config,
      },
    });
    expect(result.exitCode, result.stderr + JSON.stringify(result.json)).toBe(
      0,
    );
    const graph = historicalSourceGraphSchema.parse(result.json);
    expect(graph.inventory_state).toBe("partial");
    expect(graph.entries.map(({ path }) => path)).toEqual([
      "bad\ufffd.js",
      "good.js",
    ]);
    expect(graph.entries).toContainEqual(
      expect.objectContaining({
        path: "bad\ufffd.js",
        sha256: createHash("sha256").update("UNICODE_FILE").digest("hex"),
        size: 12,
      }),
    );
    expect(graph.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `First raw basename bytes: ${rawName.toString("hex")}`,
        ),
      ]),
    );
  },
);

cliTest.skipIf(process.platform === "win32")(
  "keeps raw symlink target identities distinct from UTF-8 replacement and BOM handling",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-reference-link-bytes-");
    const config = await createTestTempDirectory(
      "rea-reference-link-bytes-config-",
    );
    const rawTarget = Buffer.from([0x62, 0x61, 0x64, 0xff, 0x2e, 0x74, 0x73]);
    await Promise.all([
      writeFile(join(root, "bad\ufffd.ts"), "export const unicode = 1;\n"),
      symlink(rawTarget, join(root, "alias.ts")),
      writeFile(join(root, "\ufefftarget.ts"), "export const bom = 1;\n"),
      symlink("\ufefftarget.ts", join(root, "bom-alias.ts")),
    ]);

    const result = await cli.run({
      arguments: ["import-reference-source", root, "--json"],
      environment: {
        HOME: config,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: config,
      },
    });
    expect(result.exitCode, result.stderr + JSON.stringify(result.json)).toBe(
      0,
    );
    const graph = historicalSourceGraphSchema.parse(result.json);
    expect(graph.entries).toContainEqual(
      expect.objectContaining({
        kind: "symlink",
        path: "alias.ts",
        target: null,
        target_state: "unreadable",
        limitations: [expect.stringContaining(rawTarget.toString("hex"))],
      }),
    );
    expect(graph.entries).toContainEqual(
      expect.objectContaining({
        kind: "file",
        path: "bad\ufffd.ts",
        content_state: "hashed",
      }),
    );
    expect(graph.entries).toContainEqual(
      expect.objectContaining({
        kind: "symlink",
        path: "bom-alias.ts",
        target: "\ufefftarget.ts",
        target_state: "internal",
      }),
    );
    expect(
      Buffer.compare(
        await readlink(join(root, "alias.ts"), { encoding: "buffer" }),
        rawTarget,
      ),
    ).toBe(0);
  },
);

cliTest.skipIf(process.platform === "win32")(
  "preserves historical literal-backslash entries and their exact owning import base",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-reference-literal-paths-");
    const config = await createTestTempDirectory(
      "rea-reference-literal-config-",
    );
    await mkdir(join(root, "literal"));
    await mkdir(join(root, "literal\\dir"));
    const sources = new Map([
      ["literal\\name.js", "export const value = 'literal';\n"],
      ["literal/name.js", "export const value = 'slash';\n"],
      ["literal\\dir/main.js", 'import "./dep.js";\n'],
      ["literal\\dir/dep.js", "export const value = 'owned';\n"],
    ]);
    for (const [path, bytes] of sources)
      await writeFile(join(root, path), bytes);
    const result = await cli.run({
      arguments: ["import-reference-source", root, "--json"],
      environment: {
        HOME: config,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: config,
      },
    });
    expect(result.exitCode, result.stderr + JSON.stringify(result.json)).toBe(
      0,
    );
    const graph = historicalSourceGraphSchema.parse(result.json);
    for (const [path, bytes] of sources)
      expect(graph.entries).toContainEqual(
        expect.objectContaining({
          path,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          content_state: "hashed",
        }),
      );
    for (const [path, bytes] of sources)
      expect(await readFile(join(root, path), "utf8")).toBe(bytes);
    expect(graph.relationships).toContainEqual({
      from_path: "literal\\dir/main.js",
      to: "literal\\dir/dep.js",
      kind: "imports",
      resolution: "internal",
      parse_state: "parsed",
    });
  },
);

cliTest.skipIf(process.platform === "win32")(
  "preserves an observed historical symlink target with a literal backslash",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-reference-literal-link-");
    const config = await createTestTempDirectory(
      "rea-reference-literal-link-config-",
    );
    await writeFile(
      join(root, "literal\\name.js"),
      "export const value = 42;\n",
    );
    await symlink("literal\\name.js", join(root, "link.js"));
    const result = await cli.run({
      arguments: ["import-reference-source", root, "--json"],
      environment: {
        HOME: config,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: config,
      },
    });
    expect(result.exitCode, result.stderr + JSON.stringify(result.json)).toBe(
      0,
    );
    const graph = historicalSourceGraphSchema.parse(result.json);
    expect(await readlink(join(root, "link.js"))).toBe("literal\\name.js");
    expect(await readFile(join(root, "literal\\name.js"), "utf8")).toBe(
      "export const value = 42;\n",
    );
    expect(graph.entries).toContainEqual(
      expect.objectContaining({
        kind: "symlink",
        path: "link.js",
        target: "literal\\name.js",
        target_state: "internal",
      }),
    );
  },
);

cliTest.skipIf(process.platform === "win32")(
  "imports an inventory-owned POSIX UNC-looking symlink target",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-reference-unc-literal-");
    const config = await createTestTempDirectory("rea-reference-unc-config-");
    const literal = "\\\\server\\share.js";
    const literalBytes = "export const value = 'literal';\n";
    const slashBytes = "export const value = 'slash';\n";
    await mkdir(join(root, "server"));
    await writeFile(join(root, literal), literalBytes);
    await writeFile(join(root, "server", "share.js"), slashBytes);
    await symlink(literal, join(root, "link.js"));
    const result = await cli.run({
      arguments: ["import-reference-source", root, "--json"],
      environment: {
        HOME: config,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: config,
      },
    });
    expect(result.exitCode, result.stderr + JSON.stringify(result.json)).toBe(
      0,
    );
    const graph = historicalSourceGraphSchema.parse(result.json);
    expect(graph.entries).toContainEqual(
      expect.objectContaining({
        kind: "symlink",
        path: "link.js",
        target: literal,
        target_state: "internal",
      }),
    );
    for (const [path, bytes] of [
      [literal, literalBytes],
      ["server/share.js", slashBytes],
    ]) {
      expect(graph.entries).toContainEqual(
        expect.objectContaining({
          path,
          sha256: createHash("sha256").update(bytes!).digest("hex"),
        }),
      );
      expect(await readFile(join(root, path!), "utf8")).toBe(bytes);
    }
    expect(await readlink(join(root, "link.js"))).toBe(literal);
  },
);
