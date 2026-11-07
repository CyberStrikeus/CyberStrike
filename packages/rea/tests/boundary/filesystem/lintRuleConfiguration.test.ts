import { parse } from "@babel/parser";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect } from "vitest";
import { z } from "zod";

import { writeRepositoryOxlintConfiguration } from "../../fixtures/oxlintConfiguration.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const oxlint = join(repository, "node_modules/oxlint/bin/oxlint");
const applicationSource = "src/application/lintRuleAcceptance.ts";
const testSource = "tests/boundary/lintRuleAcceptance.test.ts";

interface AcceptanceCase {
  readonly name: string;
  readonly filename: string;
  readonly source: string;
  readonly exitCode: number;
  readonly diagnostics: readonly {
    readonly code?: string;
    readonly severity: "error" | "warning";
    readonly message?: string;
  }[];
}

const cases: readonly AcceptanceCase[] = [
  {
    name: "enables imported Evidence JSON admission errors through the repository plugin",
    filename: applicationSource,
    source: `
      import { createEvidence as record } from "../domain/evidence.js";
      import { jsonValueSchema as json } from "../domain/jsonValue.js";
      export const evidence = record(undefined, {}, { result: json.parse({ ready: true }) });
    `,
    exitCode: 1,
    diagnostics: [
      { code: "rea(no-evidence-json-preadmission)", severity: "error" },
    ],
  },
  {
    name: "recognizes canonical Evidence owners imported through file URLs",
    filename: applicationSource,
    source: `
      import { createEvidence as record } from ${JSON.stringify(pathToFileURL(join(repository, "src/domain/evidence.js")).href)};
      import { jsonValueSchema as json } from ${JSON.stringify(pathToFileURL(join(repository, "src/domain/jsonValue.js")).href)};
      export const evidence = record(undefined, {}, { result: json.parse({ ready: true }) });
    `,
    exitCode: 1,
    diagnostics: [
      { code: "rea(no-evidence-json-preadmission)", severity: "error" },
    ],
  },
  {
    name: "allows semantic schema admission and stored JSON contracts",
    filename: applicationSource,
    source: `
      import { z } from "zod";
      import { createEvidence } from "../domain/evidence.js";
      import { jsonValueSchema } from "../domain/jsonValue.js";
      const semanticSchema = z.object({ ready: z.boolean() });
      export const semantic = createEvidence(undefined, {}, { result: semanticSchema.parse({ ready: true }) });
      const result = jsonValueSchema.parse({ ready: true });
      export const stored = createEvidence(undefined, {}, { result });
    `,
    exitCode: 0,
    diagnostics: [],
  },
  {
    name: "enables positional catalog type errors through the repository plugin",
    filename: applicationSource,
    source: `
      import { GPU_TOOL_CONTRACTS as contracts } from "../contracts/gpu/gpuToolContracts.js";
      export type Selected = (typeof contracts)[0];
    `,
    exitCode: 1,
    diagnostics: [
      { code: "rea(no-positional-tool-contract)", severity: "error" },
    ],
  },
  {
    name: "enables duplicate fixture root teardown errors through the repository plugin",
    filename: testSource,
    source: `
      import { afterEach } from "vitest";
      import { rm } from "node:fs/promises";
      import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
      const root = await createTestTempDirectory("rea-lint-rule-");
      afterEach(() => rm(root, { recursive: true, force: true }));
    `,
    exitCode: 1,
    diagnostics: [{ code: "rea(no-fixture-root-cleanup)", severity: "error" }],
  },
  {
    name: "allows explicit root deletion outside fixture teardown",
    filename: testSource,
    source: `
      import { rm } from "node:fs/promises";
      import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
      const root = await createTestTempDirectory("rea-lint-rule-");
      await rm(root, { recursive: true, force: true });
    `,
    exitCode: 0,
    diagnostics: [],
  },
  {
    name: "rejects an unreturned promise callback containing assertions",
    filename: testSource,
    source: `
      import { expect, it } from "vitest";
      it("unjoined assertion", () => {
        Promise.resolve("ready").then(value => { expect(value).toBe("ready"); });
      });
    `,
    exitCode: 1,
    diagnostics: [
      { code: "vitest(valid-expect-in-promise)", severity: "error" },
    ],
  },
  {
    name: "rejects focused tests through the repository Vitest configuration",
    filename: testSource,
    source: `
      import { expect, it } from "vitest";
      it.only("focused assertion", () => { expect("ready").toBe("ready"); });
    `,
    exitCode: 1,
    diagnostics: [{ code: "vitest(no-focused-tests)", severity: "error" }],
  },
  {
    name: "keeps native stored assertion limitations at warning severity",
    filename: testSource,
    source: `
      import { expect, it } from "vitest";
      it("joins a stored assertion", async () => {
        const assertion = expect(Promise.reject(new Error("controlled"))).rejects.toThrow("controlled");
        await assertion;
      });
    `,
    exitCode: 0,
    diagnostics: [{ code: "vitest(valid-expect)", severity: "warning" }],
  },
  {
    name: "allows an assertion diagnostic message",
    filename: testSource,
    source: `
      import { expect, it } from "vitest";
      it("keeps diagnostic context", () => {
        expect("ready", "controlled diagnostic context").toBe("ready");
      });
    `,
    exitCode: 0,
    diagnostics: [],
  },
  {
    name: "rejects unused suppression directives through the repository configuration",
    filename: testSource,
    source: `
      // oxlint-disable-next-line no-var
      export const ready = true;
    `,
    exitCode: 1,
    diagnostics: [
      {
        severity: "error",
        message: "Unused oxlint-disable directive (no problems were reported).",
      },
    ],
  },
];

const reportSchema = z.object({
  diagnostics: z.array(
    z.object({
      code: z.string().optional(),
      severity: z.enum(["error", "warning"]),
      message: z.string(),
    }),
  ),
});

const relocateImports = (scenario: AcceptanceCase, path: string): string => {
  const source = scenario.source;
  const parsed = parse(source, {
    sourceType: "module",
    plugins: ["typescript"],
  });
  const replacements = [];
  for (const statement of parsed.program.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      !statement.source.value.startsWith(".")
    )
      continue;
    const target = resolve(
      repository,
      dirname(scenario.filename),
      statement.source.value,
    );
    const relativePath = relative(dirname(path), target);
    const specifier = isAbsolute(relativePath)
      ? pathToFileURL(target).href
      : relativePath.startsWith(".")
        ? relativePath.split(sep).join("/")
        : `./${relativePath.split(sep).join("/")}`;
    const { start, end } = statement.source;
    if (
      start === null ||
      start === undefined ||
      end === null ||
      end === undefined
    )
      throw new Error("Authored lint fixture import has no source range");
    replacements.push({
      start,
      end,
      specifier,
    });
  }
  let relocated = source;
  for (const replacement of replacements.reverse())
    relocated =
      relocated.slice(0, replacement.start) +
      JSON.stringify(replacement.specifier) +
      relocated.slice(replacement.end);
  return relocated;
};

for (const scenario of cases) {
  processTest(scenario.name, async ({ processes }) => {
    const project = await createTestTempDirectory("rea-lint-configuration-");
    const configuration = await writeRepositoryOxlintConfiguration(project);
    const path = join(project, scenario.filename);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, relocateImports(scenario, path));
    const result = await processes.run(
      process.execPath,
      [
        oxlint,
        "--config",
        configuration,
        "--threads",
        "1",
        "--format",
        "json",
        scenario.filename,
      ],
      {
        cwd: project,
        timeoutMs: 15_000,
      },
    );
    expect(result.signal, result.stderr).toBeNull();
    expect(result.exitCode, result.stderr || result.stdout).toBe(
      scenario.exitCode,
    );
    const { diagnostics } = reportSchema.parse(JSON.parse(result.stdout));
    expect(
      diagnostics.map(({ code, severity }) => ({ code, severity })),
    ).toEqual(
      scenario.diagnostics.map(({ code, severity }) => ({ code, severity })),
    );
    for (const [index, expected] of scenario.diagnostics.entries()) {
      if (expected.message !== undefined)
        expect(diagnostics[index]?.message).toBe(expected.message);
    }
  });
}

processTest(
  "preserves portable regex escapes while fixing unnecessary ones",
  async ({ processes }) => {
    const project = await createTestTempDirectory("rea-lint-regex-fix-");
    const configuration = await writeRepositoryOxlintConfiguration(project);
    const path = join(project, applicationSource);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      String.raw`export const intentional = /[+\-]/u;
export const unnecessary = /\!/;
`,
    );

    const result = await processes.run(
      process.execPath,
      [
        oxlint,
        "--config",
        configuration,
        "--threads",
        "1",
        "--fix",
        applicationSource,
      ],
      { cwd: project, timeoutMs: 15_000 },
    );
    expect(result.signal, result.stderr).toBeNull();
    expect(result.exitCode, result.stderr || result.stdout).toBe(0);

    const fixed = await readFile(path, "utf8");
    expect(fixed).toContain(String.raw`export const intentional = /[+\-]/u;`);
    expect(fixed).toContain("export const unnecessary = /!/;");
    const advertised = /intentional\s*=\s*\/(.+)\/u/u.exec(fixed)?.[1];
    if (advertised === undefined) throw new Error("Fixed regex was not found");
    expect(() => new RegExp(advertised, "v")).not.toThrow();
  },
);
