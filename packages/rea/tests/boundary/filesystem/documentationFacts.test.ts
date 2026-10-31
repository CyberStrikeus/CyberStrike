import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { documentationFactIssues } from "../../../scripts/lib/docs-facts.mjs";
import type { ProductCatalog } from "../../../scripts/lib/product-catalog.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const temporaryRoots: string[] = [];

const README_FACT_FIXTURE_PATHS = [
  "README.md",
  "docs/readme/README_zh.md",
  "docs/readme/README_ja.md",
  "docs/readme/README_ko.md",
  "docs/readme/README_ar.md",
  "website/locales/languages.json",
  "docs/installation.md",
  "AGENTS.md",
  ".github/pull_request_template.md",
] as const;

const README_LINK_DRIFT_MUTATIONS = [
  [
    "(../installation.md#supported-agents)",
    "(../installation.md#missing-agents)",
  ],
  ["https://rea.tools/zh-CN/guides/", "https://rea.tools/zh-CN/missing/"],
  ["https://rea.tools/zh-CN/guides/", "https://rea.tools/zh-TW/guides/"],
  [
    "https://rea.tools/zh-CN/guides/",
    "https://rea.tools/zh-CN/guides/?other=1",
  ],
  [
    'src="../assets/rea-hopper-analysis.png"',
    'src="../assets/missing-hopper.png"',
  ],
  ['href="https://discord.gg/GkcryMnJDM"', 'href="https://discord.gg/missing"'],
] as const;

const seedReadmeFactFixture = async (directory: string) => {
  for (const path of README_FACT_FIXTURE_PATHS) {
    const destination = join(directory, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(root, path), destination);
  }
  await mkdir(join(directory, "skills/reverse-engineer-anything"), {
    recursive: true,
  });
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("translated README facts", () => {
  it("keeps translated readmes linked to canonical setup and tool details", async () => {
    const directory = await createTestTempDirectory("rea-readme-facts-");
    temporaryRoots.push(directory);
    await seedReadmeFactFixture(directory);
    const translatedPath = join(directory, "docs/readme/README_zh.md");
    const translated = await readFile(translatedPath, "utf8");
    const catalog: ProductCatalog = JSON.parse(
      await readFile(join(root, "docs/public/product-catalog.json"), "utf8"),
    );
    await expect(documentationFactIssues(directory, catalog)).resolves.toEqual(
      [],
    );
    for (const [original, changed] of README_LINK_DRIFT_MUTATIONS) {
      expect(translated).toContain(original);
      await writeFile(
        translatedPath,
        translated.replace(original, changed),
        "utf8",
      );
      await expect(
        documentationFactIssues(directory, catalog),
      ).resolves.toEqual([
        "docs/readme/README_zh.md: documentation links differ from README.md",
      ]);
    }
  });
});
