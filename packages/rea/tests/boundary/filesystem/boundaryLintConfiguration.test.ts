import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const oxlint = join(repository, "node_modules/oxlint/bin/oxlint");
const config = join(repository, ".oxlintrc.json");
const reportSchema = z.object({
  diagnostics: z.array(
    z.object({ code: z.string().optional(), severity: z.string() }),
  ),
});

const lint = (path: string) => {
  const result = spawnSync(
    process.execPath,
    [oxlint, "--threads=1", "--config", config, "--format", "json", path],
    { cwd: repository, encoding: "utf8", timeout: 15_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  const report = reportSchema.parse(JSON.parse(result.stdout));
  return { status: result.status, diagnostics: report.diagnostics };
};

it("enforces boundary and stock correctness rules through the repository config", async () => {
  const root = await createTestTempDirectory("rea-boundary-lint-");
  const path = join(root, "boundary-probe.ts");
  const imports = [
    'import { readFile } from "node:fs/promises";',
    'import { expect } from "vitest";',
    'import { AnalysisCancelledError } from "./analysisErrorCore.js";',
  ].join("\n");
  await writeFile(
    path,
    `${imports}\nasync function inspect(path: string, signal: AbortSignal) {
      const before = await readFile(path);
      expect(await readFile(path)).toEqual(before);
      if (signal.aborted) throw new AnalysisCancelledError("inspect");
      new Promise(async resolve => resolve(1));
      const optional = undefined as { value: number } | undefined;
      (optional?.value).toString();
      return;
      console.log("unreachable");
    }`,
  );
  const failing = lint(path);
  expect(failing.status).toBe(1);
  expect(
    failing.diagnostics
      .filter(({ severity }) => severity === "error")
      .map(({ code, severity }) => ({ code: code ?? "", severity }))
      .sort((left, right) => left.code.localeCompare(right.code)),
  ).toEqual([
    { code: "eslint(no-async-promise-executor)", severity: "error" },
    { code: "eslint(no-unreachable)", severity: "error" },
    { code: "eslint(no-unsafe-optional-chaining)", severity: "error" },
    { code: "rea(cancellation-cause)", severity: "error" },
    { code: "rea(no-buffer-deep-equality)", severity: "error" },
  ]);

  await writeFile(
    path,
    `${imports}\nasync function inspect(path: string, signal: AbortSignal) {
      const before = await readFile(path);
      expect((await readFile(path)).equals(before)).toBe(true);
      if (signal.aborted)
        throw new AnalysisCancelledError("inspect", { cause: signal.reason });
    }`,
  );
  const corrected = lint(path);
  expect(corrected.status).toBe(0);
  expect(
    corrected.diagnostics.filter(({ code }) => code?.startsWith("rea(")),
  ).toEqual([]);
});
