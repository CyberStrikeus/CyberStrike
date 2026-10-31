import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { processTest } from "../support/process/processFixture.js";

const jsonExamples = (content: string): unknown[] =>
  [...content.matchAll(/```json\s*([\s\S]*?)```/gu)].map((match): unknown =>
    JSON.parse(match[1] ?? ""),
  );

const shellExamples = (content: string): string[] =>
  [...content.matchAll(/```bash\s*([\s\S]*?)```/gu)].map((match) =>
    (match[1] ?? "").trim(),
  );

describe("onboarding documentation product facts", () => {
  it.each([
    ["docs/native-investigation.md", "raw-binary.md#nmos-6502"],
    ["docs/ghidra-riscv.md", "raw-binary.md"],
  ])(
    "routes raw admission guidance in %s to the owning guide",
    async (path, target) => {
      const content = await readFile(resolve(path), "utf8");
      const links = [...content.matchAll(/\]\(([^)\s]+)\)/gu)].map(
        (match) => match[1],
      );
      expect(links, path).toContain(target);
    },
  );

  it("documents manual MCP registration with an absolute runtime and entry script", async () => {
    const content = await readFile(resolve("docs/installation.md"), "utf8");
    expect(jsonExamples(content)).toContainEqual(
      expect.objectContaining({
        mcpServers: expect.objectContaining({
          rea: expect.objectContaining({
            command: "/absolute/path/to/node",
            args: ["/absolute/path/to/rea/scripts/rea.mjs", "mcp"],
          }),
        }),
      }),
    );
  });

  it("keeps translated onboarding commands aligned with the English examples", async () => {
    const inventory = JSON.parse(
      await readFile(resolve("website/locales/languages.json"), "utf8"),
    ) as { code: string; readme: string }[];
    const translatedReadmes = inventory
      .filter((language) => language.code !== "en")
      .map((language) => language.readme);
    expect(translatedReadmes).toContain("docs/readme/README_it.md");
    expect(translatedReadmes).toContain("docs/readme/README_el.md");
    const editions = (await readdir(resolve("docs/readme")))
      .filter((name) => /^README_[A-Za-z0-9-]+\.md$/u.test(name))
      .map((name) => `docs/readme/${name}`);
    expect([...translatedReadmes].sort()).toEqual(editions.sort());
    const english = shellExamples(await readFile(resolve("README.md"), "utf8"));
    for (const path of translatedReadmes)
      expect(
        shellExamples(await readFile(resolve(path), "utf8")),
        path,
      ).toEqual(english);
  });

  it("preserves Persian joiners in links to GitHub-rendered headings", async () => {
    const persian = await readFile(resolve("docs/readme/README_fa.md"), "utf8");
    // Confirmed against GitHub's rendered README, which retains U+200C.
    for (const heading of [
      "REA چگونه کار می‌کند",
      "چه چیزهایی را می‌توان تحلیل کرد",
      "نمونه‌های عملی",
      "پرسش‌های متداول",
      "به‌روزرسانی REA",
    ]) {
      expect(persian).toContain(`## ${heading}`);
      expect(persian).toContain(
        `](#${heading.toLowerCase().replaceAll(" ", "-")})`,
      );
    }
  });
});

describe("published performance evidence", () => {
  const script = resolve(
    "tests/support/analysis-efficiency/mcp-integer-report.mjs",
  );
  const report = resolve(
    "docs/verification/analysis-efficiency/mcp-integer-allocation.md",
  );
  processTest(
    "keeps generated report facts aligned with committed receipts",
    async ({ processes }) => {
      const result = await processes.run(process.execPath, [script, "--check"]);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    },
  );
  for (const section of ["normal", "heap"]) {
    processTest(
      `rejects stale ${section} measurements without rewriting the report`,
      async ({ processes }) => {
        const source = await readFile(report, "utf8");
        const begin = `<!-- BEGIN:allocation-report:${section} -->`;
        const end = `<!-- END:allocation-report:${section} -->`;
        const start = source.indexOf(begin) + begin.length;
        const finish = source.indexOf(end);
        const block = source.slice(start, finish);
        const stale = block.replace(/\d+\.\d{3}/u, (value) =>
          (Number(value) + 1).toFixed(3),
        );
        expect(stale).not.toBe(block);
        const path = resolve(
          await createTestTempDirectory("rea-report-stale-"),
          "report.md",
        );
        const content = source.slice(0, start) + stale + source.slice(finish);
        await writeFile(path, content);
        const result = await processes.run(process.execPath, [
          script,
          "--check",
          "--markdown",
          path,
        ]);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain(
          `Generated allocation report differs: ${section}`,
        );
        expect(await readFile(path, "utf8")).toBe(content);
      },
    );
  }
  processTest(
    "refuses missing producer markers before writing",
    async ({ processes }) => {
      const source = await readFile(report, "utf8");
      const content = source.replace(
        "<!-- BEGIN:allocation-report:normal -->",
        "",
      );
      expect(content).not.toBe(source);
      const path = resolve(
        await createTestTempDirectory("rea-report-marker-"),
        "report.md",
      );
      await writeFile(path, content);
      const result = await processes.run(process.execPath, [
        script,
        "--markdown",
        path,
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(
        "Expected one opening report marker: normal",
      );
      expect(await readFile(path, "utf8")).toBe(content);
    },
  );
});
