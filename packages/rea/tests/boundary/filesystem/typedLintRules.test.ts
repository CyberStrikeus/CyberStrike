import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeRepositoryOxlintConfiguration } from "../../fixtures/oxlintConfiguration.js";
import { processTest } from "../../support/process/processFixture.js";

const dependencies = fileURLToPath(
  new URL("../../../node_modules", import.meta.url),
);
const reporter = fileURLToPath(
  new URL("../../../scripts/ci/static-check-report.mjs", import.meta.url),
);
const sources = {
  "src/unjoined.test.ts": `
import { expect, it } from "vitest";

const cliTest = it.extend<{ label: string }>({ label: "owned" });

it("forgets the assertion promise", () => {
  expect(Promise.resolve("ready")).resolves.toBe("ready");
});

cliTest("forgets the assertion in an extended callback", ({ label }) => {
  expect(Promise.resolve(label)).resolves.toBe("owned");
});
`,
  "src/joined.test.ts": `
import { expect, it } from "vitest";

const cliTest = it.extend<{ label: string }>({ label: "owned" });

it("joins a stored assertion promise", async () => {
  const assertion = expect(Promise.resolve("ready")).resolves.toBe("ready");
  await assertion;
});

cliTest("joins a stored assertion in an extended callback", async ({ label }) => {
  const assertion = expect(Promise.resolve(label)).resolves.toBe("owned");
  await assertion;
});

export async function finishBeforeCleanup(): Promise<string> {
  try {
    return await Promise.resolve("ready");
  } finally {
    await Promise.resolve();
  }
}
`,
  "src/misused.ts": `
export function promiseCondition(): string {
  if (Promise.resolve(false)) return "ready";
  return "pending";
}
`,
  "src/nonexhaustive.ts": `
type Outcome = { kind: "open" } | { kind: "closed" };

export function describeOutcome(outcome: Outcome): string {
  switch (outcome.kind) {
    case "open": return "open";
  }
  return "unknown";
}
`,
  "src/with-fallback.ts": `
type Outcome = { kind: "open" } | { kind: "closed" };
export function describeOutcome(outcome: Outcome): string {
  switch (outcome.kind) {
    case "open": return "open";
    default: return "unknown";
  }
}
`,
  "scripts/lib/http3-capture-assertions.test.mjs": `
import { test as registerTest } from "node:test";
registerTest("runner owns this registration", async () => {
  await Promise.resolve();
});
Promise.resolve("ordinary unowned promise remains visible");
`,
  "src/unawaited-finally.ts": `
export async function cleanupBeforeCompletion(): Promise<string> {
  try {
    return Promise.resolve("ready");
  } finally {
    await Promise.resolve();
  }
}
`,
  "src/test-misused.test.ts": `
import { it } from "vitest";
it("keeps test-only promise conditions advisory", () => {
  if (Promise.resolve(false)) throw new Error("test fixture");
});
`,
  "tests/unjoined.test.ts": `
import { expect, it } from "vitest";
const cliTest = it.extend<{ label: string }>({ label: "owned" });
it("rejects an unjoined boundary-test assertion", () => {
  expect(Promise.resolve("ready")).resolves.toBe("ready");
});
cliTest("rejects an unjoined extended boundary-test assertion", ({ label }) => {
  expect(Promise.resolve(label)).resolves.toBe("owned");
});
`,
};

processTest(
  "runs typed promise and exhaustiveness rules on an isolated real TypeScript project",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-typed-lint-");
    await symlink(
      dependencies,
      join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await Promise.all(
      Object.keys(sources).map((name) =>
        mkdir(dirname(join(root, name)), { recursive: true }),
      ),
    );
    await writeRepositoryOxlintConfiguration(root);
    await Promise.all([
      writeFile(join(root, "package.json"), '{"type":"module"}\n'),
      writeFile(
        join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            allowJs: true,
            checkJs: true,
            noEmit: true,
            skipLibCheck: true,
            module: "NodeNext",
            moduleResolution: "NodeNext",
            target: "ES2023",
            types: ["node"],
          },
          files: Object.keys(sources),
        }),
      ),
      ...Object.entries(sources).map(([name, source]) =>
        writeFile(join(root, name), source),
      ),
    ]);

    const result = await processes.run(
      process.execPath,
      [reporter, "typed-lint", ...Object.keys(sources)],
      {
        cwd: root,
        timeoutMs: 20_000,
        env: { ...process.env, GOMAXPROCS: "2", GOMEMLIMIT: "1GiB" },
      },
    );
    expect(result.signal, result.stderr).toBeNull();
    expect(result.exitCode, result.stderr || result.stdout).toBe(1);
    const { diagnostics } = z
      .object({
        diagnostics: z.array(
          z.object({
            code: z.string(),
            severity: z.enum(["error", "warning"]),
            filename: z.string(),
          }),
        ),
      })
      .parse(
        JSON.parse(
          await readFile(
            join(root, ".cache/static-checks/typed-oxlint.json"),
            "utf8",
          ),
        ),
      );
    expect(
      diagnostics
        .filter(({ code }) =>
          [
            "typescript(no-floating-promises)",
            "typescript(no-misused-promises)",
            "typescript(return-await)",
            "typescript(switch-exhaustiveness-check)",
          ].includes(code),
        )
        .map(
          ({ code, filename, severity }) =>
            `${(isAbsolute(filename) ? relative(root, filename) : filename).split(sep).join("/")}: ${severity}: ${code}`,
        )
        .sort(),
    ).toEqual([
      "scripts/lib/http3-capture-assertions.test.mjs: error: typescript(no-floating-promises)",
      "src/misused.ts: error: typescript(no-misused-promises)",
      "src/nonexhaustive.ts: error: typescript(switch-exhaustiveness-check)",
      "src/test-misused.test.ts: warning: typescript(no-misused-promises)",
      "src/unawaited-finally.ts: error: typescript(return-await)",
      "src/unjoined.test.ts: error: typescript(no-floating-promises)",
      "src/unjoined.test.ts: error: typescript(no-floating-promises)",
      "tests/unjoined.test.ts: error: typescript(no-floating-promises)",
      "tests/unjoined.test.ts: error: typescript(no-floating-promises)",
    ]);
    expect(
      diagnostics.filter(({ severity }) => severity === "error"),
    ).toHaveLength(8);
  },
);
