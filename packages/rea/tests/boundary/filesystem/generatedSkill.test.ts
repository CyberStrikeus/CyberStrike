import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const exec = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const authored =
  '---\nname: reverse-engineer-anything\nmetadata:\n  version: "33"\n---\n\n# Instructions\n\nInspect the caller-selected artifact.\n';

async function fixture(eol = "\n") {
  const root = await createTestTempDirectory("rea-generated-skill-");
  for (const path of [
    "scripts/generate-skill-metadata.mjs",
    "scripts/lib/generated-file.mjs",
    "scripts/lib/verifier-source-loader.mjs",
    "src/domain/skillManifest.ts",
    "src/domain/result.ts",
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await copyFile(join(repositoryRoot, path), join(root, path));
  }
  await mkdir(join(root, "node_modules"));
  await cp(
    join(repositoryRoot, "node_modules/yaml"),
    join(root, "node_modules/yaml"),
    { recursive: true },
  );
  const sourceRoot = join(root, ".agents/skills/reverse-engineer-anything");
  const outputRoot = join(root, "skills/reverse-engineer-anything");
  await mkdir(join(sourceRoot, "references"), { recursive: true });
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await writeFile(
    join(root, "dist/identity.js"),
    'export const PRODUCT_IDENTITY = { packageSpecifier: "rea-agents@latest", registrationPackageSpecifier: "rea-agents@6.2.0" };\n',
  );
  await writeFile(join(sourceRoot, "SKILL.md"), authored.replaceAll("\n", eol));
  await writeFile(
    join(sourceRoot, "references/guide.md"),
    `# Guide${eol}Preserve evidence.${eol}`,
  );
  const identity = async (count: number, digest: string) =>
    writeFile(
      join(root, "dist/catalogIdentity.js"),
      `export const FULL_CATALOG_IDENTITY = ${JSON.stringify({ counts: { mcp_tools: count }, digests: { combined_sha256: digest } })};\n`,
    );
  await identity(139, "a".repeat(64));
  const generate = (...args: string[]) =>
    exec(
      process.execPath,
      [join(root, "scripts/generate-skill-metadata.mjs"), ...args],
      { cwd: root },
    );
  return { sourceRoot, outputRoot, identity, generate };
}

it.each(["\n", "\r\n"])(
  "generates revision-specific metadata without rewriting authored instructions (%j)",
  async (eol) => {
    const f = await fixture(eol);
    await f.generate();
    const first = await readFile(join(f.outputRoot, "SKILL.md"), "utf8");
    expect(first).not.toContain("catalog_digest:");
    expect(first).toContain("tool_count: 139");
    expect(
      first.replace(/^ {2}(?:tool_count|catalog_digest):[^\n]*\n/gmu, ""),
    ).toBe(authored);
    expect(
      await readFile(join(f.outputRoot, "references/guide.md"), "utf8"),
    ).toBe("# Guide\nPreserve evidence.\n");
    await f.identity(139, "b".repeat(64));
    await f.generate();
    expect(await readFile(join(f.outputRoot, "SKILL.md"), "utf8")).toBe(first);
    await f.identity(140, "b".repeat(64));
    await expect(f.generate("--check")).rejects.toMatchObject({
      stderr: expect.stringContaining("missing or stale"),
    });
    await f.generate();
    expect(await readFile(join(f.outputRoot, "SKILL.md"), "utf8")).toContain(
      "tool_count: 140",
    );
    expect(await readFile(join(f.sourceRoot, "SKILL.md"), "utf8")).toBe(
      authored.replaceAll("\n", eol),
    );
    expect(
      await readFile(join(f.sourceRoot, "references/guide.md"), "utf8"),
    ).toBe(`# Guide${eol}Preserve evidence.${eol}`);
    const checked = await f.generate("--check");
    expect(
      checked.stderr.replace(
        /^\(node:\d+\) ExperimentalWarning: stripTypeScriptTypes is an experimental feature and might change at any time\r?\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\r?\n$/u,
        "",
      ),
    ).toBe("");
  },
);

it("rejects missing, stale, and extra packaged references and removes deleted source files on rebuild", async () => {
  const f = await fixture();
  await f.generate();
  const guide = join(f.outputRoot, "references/guide.md");
  await rm(guide);
  await expect(f.generate("--check")).rejects.toMatchObject({
    stderr: expect.stringContaining("guide.md is missing or stale"),
  });
  await f.generate();
  await writeFile(guide, "modified reference\n");
  await expect(f.generate("--check")).rejects.toMatchObject({
    stderr: expect.stringContaining("guide.md is missing or stale"),
  });
  await f.generate();
  await writeFile(
    join(f.outputRoot, "references/removed.md"),
    "obsolete instructions\n",
  );
  await expect(f.generate("--check")).rejects.toMatchObject({
    stderr: expect.stringContaining("file inventory drifted"),
  });
  await rm(join(f.sourceRoot, "references/guide.md"));
  await f.generate();
  await expect(readFile(guide)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    readFile(join(f.outputRoot, "references/removed.md")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await f.generate("--check");
});

it("pins authored `@latest` commands to the packaged version", async () => {
  const f = await fixture();
  await writeFile(
    join(f.sourceRoot, "SKILL.md"),
    authored.replace(
      "Inspect the caller-selected artifact.",
      "Run `npx -y rea-agents@latest doctor --json` first.",
    ),
  );
  await f.generate();
  const generated = await readFile(join(f.outputRoot, "SKILL.md"), "utf8");
  expect(generated).toContain("npx -y rea-agents@6.2.0 doctor --json");
  expect(generated).not.toContain("rea-agents@latest");
  await f.generate("--check");
});

it("rejects catalog-dependent metadata in the authored source", async () => {
  const f = await fixture();
  await writeFile(
    join(f.sourceRoot, "SKILL.md"),
    authored.replace('  version: "33"', '  version: "33"\n  tool_count: 139'),
  );
  await expect(f.generate()).rejects.toMatchObject({
    stderr: expect.stringContaining(
      "Catalog metadata belongs in the generated skill",
    ),
  });
});

it("generates metadata from quoted frontmatter while preserving body metadata examples", async () => {
  const f = await fixture();
  const body =
    '\n# Instructions\n\n```yaml\nmetadata:\n  version: "body-only"\n  tool_count: 99\n  catalog_digest: example\n```\n';
  await writeFile(
    join(f.sourceRoot, "SKILL.md"),
    "---\nname: reverse-engineer-anything\nmetadata:\n  version: '33'\n---\n" +
      body,
  );
  await f.generate();
  const generated = await readFile(join(f.outputRoot, "SKILL.md"), "utf8");
  expect(generated.endsWith(body)).toBe(true);
  expect(generated).toContain("version: '33'");
  expect(generated).toContain("tool_count: 139");
});

it("rejects body-only versions instead of generating metadata inside examples", async () => {
  const f = await fixture();
  await writeFile(
    join(f.sourceRoot, "SKILL.md"),
    '---\nname: reverse-engineer-anything\n---\n\n```yaml\nmetadata:\n  version: "body-only"\n```\n',
  );
  await expect(f.generate()).rejects.toMatchObject({
    stderr: expect.stringContaining("Missing authored skill version"),
  });
});
