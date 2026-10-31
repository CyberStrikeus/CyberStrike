import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";
import { z } from "zod";

import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import { resolveSwiftcCompileTimeoutMs } from "../../../src/process/DarwinProcessRunTokenReader.js";
import {
  execFileOutput,
  execFileOutputFailure,
} from "../../../src/process/ExecFileOutput.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const receiptSchema = z.object({ root: z.string(), codex: z.string() });
const preparationBudgetMs =
  process.platform === "darwin" ? resolveSwiftcCompileTimeoutMs() : 0;

// The executable fixture needs a POSIX shebang. Only the permission-denial
// cases additionally need an ordinary user. No auth copying or model requests run.
for (const { denied, keep } of [
  { denied: false, keep: false },
  { denied: true, keep: false },
  { denied: false, keep: true },
  { denied: true, keep: true },
]) {
  it.skipIf(
    process.platform === "win32" || (denied && process.getuid?.() === 0),
  )(
    `cleans independent evaluation files and retains failures (denied: ${String(denied)}, keep: ${String(keep)})`,
    process.platform === "darwin"
      ? { timeout: Math.min(2_147_483_647, preparationBudgetMs + 60_000) }
      : {},
    async () => {
      const directory = await createTestTempDirectory(
        "rea-agent-eval-cleanup-",
      );
      const receipt = join(directory, "receipt.json");
      const command = join(directory, "codex-fixture.mjs");
      const parent = join(directory, "evaluations");
      await writeFile(
        command,
        `#!${process.execPath}
import { chmodSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
if (process.argv[2] !== "--version") throw new Error("Unexpected model invocation");
const parent = ${JSON.stringify(parent)};
const entries = readdirSync(parent);
if (entries.length !== 1) throw new Error("Expected exactly one owned run");
const root = join(parent, entries[0]);
const codex = join(root, "codex");
for (const child of ["codex", "account", "targets"]) mkdirSync(join(root, child));
writeFileSync(join(codex, "auth.json"), "inert synthetic fixture");
writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ root, codex }));
if (${String(denied)}) chmodSync(codex, 0o500);
process.stderr.write("synthetic version failure");
process.exitCode = 1;
`,
        { mode: 0o700 },
      );
      let run: { root: string; codex: string } | undefined;
      await withVerifierCleanup(async () => {
        let stderr: string;
        try {
          await execFileOutput(
            process.execPath,
            [
              fileURLToPath(
                new URL(
                  "../../../scripts/verify-agent-experience.mjs",
                  import.meta.url,
                ),
              ),
            ],
            {
              env: {
                ...process.env,
                REA_CODEX_CLI: command,
                REA_AGENT_EVAL_ROOT: parent,
                REA_AGENT_EVAL_TIMEOUT_MS: "10000",
                REA_AGENT_EVAL_KEEP_FIXTURES: String(keep),
              },
              timeout: Math.min(2_147_483_647, preparationBudgetMs + 15_000),
              stopSignal: "SIGTERM",
              maxBuffer: 1024 * 1024,
            },
          );
          throw new Error(
            "The synthetic version failure must reject verification",
          );
        } catch (cause) {
          const failure = execFileOutputFailure(cause);
          if (failure === undefined) throw cause;
          expect(failure.code).toBe(1);
          stderr = failure.stderr;
        }
        // Cleanup must preserve the original version diagnostic too.
        expect(stderr).toContain(
          "--version failed with 1: synthetic version failure",
        );
        run = receiptSchema.parse(JSON.parse(await readFile(receipt, "utf8")));
        if (denied) {
          expect.soft(stderr).toContain("Verifier cleanup failed");
          expect(stderr).toContain("EACCES");
          expect(stderr).toContain(join(run.codex, "auth.json"));
          expect(await readFile(join(run.codex, "auth.json"), "utf8")).toBe(
            "inert synthetic fixture",
          );
        } else {
          expect(stderr).not.toContain("Verifier cleanup failed");
          await expect(
            stat(join(run.codex, "auth.json")),
          ).rejects.toMatchObject({
            code: "ENOENT",
          });
        }
        for (const child of ["account", "targets"]) {
          const entry = stat(join(run.root, child));
          if (keep) expect((await entry).isDirectory()).toBe(true);
          else await expect(entry).rejects.toMatchObject({ code: "ENOENT" });
        }
        if (!denied && !keep)
          await expect(stat(run.root)).rejects.toMatchObject({
            code: "ENOENT",
          });
      }, [
        async () => {
          // Restore this test's deliberately denied subtree before fixture teardown.
          if (!denied) return;
          try {
            run ??= receiptSchema.parse(
              JSON.parse(await readFile(receipt, "utf8")),
            );
          } catch (cause) {
            // Startup can fail before the executable creates its receipt.
            if (
              cause instanceof Error &&
              "code" in cause &&
              cause.code === "ENOENT"
            )
              return;
            throw cause;
          }
          await chmod(run.codex, 0o700);
        },
      ]);
    },
  );
}
