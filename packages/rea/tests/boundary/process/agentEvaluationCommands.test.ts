import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

import { resolveSwiftcCompileTimeoutMs } from "../../../src/process/DarwinProcessRunTokenReader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

// The driver prepares ownership before exercising its short command budgets.
const preparationBudgetMs =
  process.platform === "darwin" ? resolveSwiftcCompileTimeoutMs() : 0;

processTest.skipIf(process.platform === "win32")(
  "joins real evaluation command/output cleanup while retaining timeout diagnostics",
  { timeout: Math.min(2_147_483_647, preparationBudgetMs + 40_000) },
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-agent-command-");
    const fixture = join(root, "codex-fixture.mjs");
    await writeFile(
      fixture,
      `#!${process.execPath}
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
if (process.env.FIXTURE_MODE === "success") {
  process.stdout.write(process.argv.includes("--version") ? "fixture 1.2\\n" : '{"type":"fixture","text":"你好"}\\n');
} else if (process.env.FIXTURE_MODE === "failure") {
  process.stderr.write("synthetic command failure"); process.exitCode = 7;
} else if (process.env.FIXTURE_MODE === "overflow") {
  process.stderr.write("x".repeat(65536));
} else {
  process.on("SIGTERM", () => {
    writeFileSync(${JSON.stringify(join(root, "term"))}, "acknowledged");
    if (process.argv.includes("--no-daemon")) setTimeout(() => process.exit(0), 200);
  });
  if (!process.argv.includes("--no-daemon"))
    spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);'], { stdio: ["ignore", "inherit", "inherit"] });
  setInterval(() => {}, 1000);
  setTimeout(() => process.exit(2), 20000);
}
`,
      { mode: 0o700 },
    );
    const driver = join(root, "driver.mjs");
    await writeFile(
      driver,
      `import assert from "node:assert/strict";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const actualSpawn = cp.spawn;
const children = [];
cp.spawn = (...args) => {
  const child = actualSpawn(...args);
  if (args[0] === ${JSON.stringify(fixture)}) {
    const entry = { child, closed: false };
    child.once("close", () => { entry.closed = true; });
    children.push(entry);
  }
  return child;
};
syncBuiltinESMExports();
const { createAgentEvaluationCommands } = await import(${JSON.stringify(
        new URL(
          "../../../scripts/lib/agent-evaluation-commands.mjs",
          import.meta.url,
        ).href,
      )});
const { OwnedCommandFailure, prepareOwnedCommand } = await import(${JSON.stringify(
        new URL("../../../dist/process/OwnedCommand.js", import.meta.url).href,
      )});
const { withVerifierCleanup } = await import(${JSON.stringify(
        new URL("../../../scripts/lib/verifier-cleanup.mjs", import.meta.url)
          .href,
      )});
await prepareOwnedCommand();
const root = ${JSON.stringify(root)}, fixture = ${JSON.stringify(fixture)};
const commands = createAgentEvaluationCommands({ codex: fixture, evaluationRoot: root,
  evaluationEnvironment: process.env, timeoutMs: 1000, repositoryRoot: root });
await withVerifierCleanup(async () => {
for (const name of ["runCodex", "runProcess", "readCommandVersion"]) {
  await assert.rejects(() => name === "runCodex" ? commands.runCodex("fixture", []) :
    name === "runProcess" ? commands.runProcess(fixture, [], root, 1000) : commands.readCommandVersion(fixture), error => {
      assert.match(error.message, /timed out/);
      assert.ok(error.cause instanceof OwnedCommandFailure);
      assert.equal(error.cause.reason, "timeout");
      assert.equal(error.cause.cleanupOwner === undefined, true, name + ": " + error.cause.cleanupFailure);
      return true;
    });
  const { child, closed } = children.at(-1);
  assert.equal(closed, true, name + " returned before close");
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
}
process.env.FIXTURE_MODE = "success";
const result = await commands.runCodex("fixture", ["open_binary"]);
assert.deepEqual(result, { events: [{ type: "fixture", text: "你好" }], exitCode: 0, stderr: "" });
await commands.runProcess(fixture, [], root, 2000);
assert.equal(await commands.readCommandVersion(fixture), "fixture 1.2");
process.env.FIXTURE_MODE = "failure";
assert.equal((await commands.runCodex("fixture", [])).exitCode, 7);
await assert.rejects(() => commands.runProcess(fixture, [], root, 2000), /failed with 7: synthetic command failure/);
await assert.rejects(() => commands.readCommandVersion(fixture), /--version failed with 7: synthetic command failure/);
process.env.FIXTURE_MODE = "overflow";
await assert.rejects(() => commands.runProcess(fixture, [], root, 2000), error => {
  assert.ok(error instanceof OwnedCommandFailure);
  assert.equal(error.reason, "output-limit");
  assert.ok(error.snapshot.stderr.bytes <= 32768);
  return true;
});
}, [() => commands.close()]);
console.log(JSON.stringify({ passed: true, timeoutHelpers: 3, controls: 7, childrenClosed: children.every(x => x.closed) }));
`,
    );
    const result = await processes.run(process.execPath, [driver], {
      timeoutMs: Math.min(2_147_483_647, preparationBudgetMs + 35_000),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      passed: true,
      timeoutHelpers: 3,
      controls: 7,
      childrenClosed: true,
    });
  },
);

processTest.for([false, true])(
  "retries retained process cleanup before removing evaluation files: %s",
  async (incomplete, { processes }) => {
    const root = await createTestTempDirectory("rea-agent-command-retry-");
    const parent = join(root, "evaluations");
    const loader = join(root, "loader.mjs");
    const receipt = join(root, "receipt.json");
    const source = `
      import { mkdir, readdir, writeFile } from "node:fs/promises";
      import { join } from "node:path";
      export async function prepareOwnedCommand() {}
      export class OwnedCommandFailure extends Error {
        reason = "timeout";
        resources = ["fixture-evaluation-command"];
        cleanupFailure = "fixture cleanup denied";
        cleanupOwner = { stop: async () => {
          await writeFile(${JSON.stringify(join(root, "retried"))}, "exact owner retried");
          return ${JSON.stringify(incomplete ? { status: "incomplete", reason: "fixture cleanup denied" } : { status: "stopped" })};
        }};
      }
      export async function runOwnedCommand() {
        const run = join(${JSON.stringify(parent)}, (await readdir(${JSON.stringify(parent)}))[0]);
        await mkdir(join(run, "codex"));
        await writeFile(join(run, "codex/auth.json"), "inert fixture");
        await writeFile(${JSON.stringify(receipt)}, JSON.stringify({ run }));
        throw new OwnedCommandFailure("fixture timeout with retained owner");
      }
    `;
    await writeFile(
      loader,
      `import { registerHooks } from "node:module";
registerHooks({ load(url, context, nextLoad) {
  if (url === ${JSON.stringify(new URL("../../../dist/process/OwnedCommand.js", import.meta.url).href)})
    return { format: "module", shortCircuit: true, source: ${JSON.stringify(source)} };
  return nextLoad(url, context);
}});`,
    );
    const result = await processes.run(
      process.execPath,
      [
        "--import",
        loader,
        fileURLToPath(
          new URL(
            "../../../scripts/verify-agent-experience.mjs",
            import.meta.url,
          ),
        ),
      ],
      {
        env: { ...process.env, REA_AGENT_EVAL_ROOT: parent },
        timeoutMs: 10_000,
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--version timed out");
    expect(await readFile(join(root, "retried"), "utf8")).toBe(
      "exact owner retried",
    );
    const { run }: { run: string } = JSON.parse(
      await readFile(receipt, "utf8"),
    );
    if (incomplete) {
      expect(result.stderr).toContain("Artifact cleanup remains incomplete");
      expect(result.stderr).toContain("fixture cleanup denied");
      expect(await readFile(join(run, "codex/auth.json"), "utf8")).toBe(
        "inert fixture",
      );
    } else {
      await expect(
        readFile(join(run, "codex/auth.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
  },
);

processTest.for([
  { phase: "ordered", incomplete: false },
  { phase: "direct", incomplete: false },
  { phase: "direct", incomplete: true },
  { phase: "nested", incomplete: false },
  { phase: "nested", incomplete: true },
])(
  "prepares before the command deadline and retains $phase preparation ownership (incomplete: $incomplete)",
  async ({ phase, incomplete }, { processes }) => {
    const root = await createTestTempDirectory("rea-agent-preparation-");
    const parent = join(root, "evaluations");
    const loader = join(root, "loader.mjs");
    const receipt = join(root, "receipt.json");
    const retried = join(root, "retried");
    const source = `
      import { mkdir, readdir, writeFile } from "node:fs/promises";
      import { join } from "node:path";
      import { setTimeout as delay } from "node:timers/promises";
      import { DarwinProcessOwnershipInspectionError } from ${JSON.stringify(new URL("../../../dist/process/DarwinProcessRunTokenReader.js", import.meta.url).href)};
      import { ProviderCleanupError } from ${JSON.stringify(new URL("../../../dist/domain/providerCleanupError.js", import.meta.url).href)};
      let prepared = false;
      const cleanup = new ProviderCleanupError("fixture", ["darwin-fixture-reader"], { reason: "fixture preparation cleanup denied" });
      const preparation = new DarwinProcessOwnershipInspectionError("fixture preparation failure", {
        cleanupFailure: cleanup,
        cleanupOwner: { close: async () => {
          await writeFile(${JSON.stringify(retried)}, "exact preparation owner retried");
          if (${String(incomplete)}) throw new Error("fixture preparation cleanup denied");
          cleanup.resolveCleanup();
        } },
      });
      export class OwnedCommandFailure extends Error {
        reason = "timeout";
        resources = [];
        cleanupFailure = null;
        preparationFailure = preparation;
      }
      export async function prepareOwnedCommand() {
        const run = join(${JSON.stringify(parent)}, (await readdir(${JSON.stringify(parent)}))[0]);
        await mkdir(join(run, "codex"));
        await writeFile(join(run, "codex/auth.json"), "inert preparation fixture");
        await delay(10);
        prepared = true;
        await writeFile(${JSON.stringify(receipt)}, JSON.stringify({ run, prepared }));
        if (${JSON.stringify(phase)} === "direct") throw preparation;
      }
      export async function runOwnedCommand() {
        if (!prepared) throw new Error("Command started before ownership preparation");
        if (${JSON.stringify(phase)} === "ordered") throw new Error("fixture command reached after preparation");
        throw new OwnedCommandFailure("nested fixture preparation failure");
      }
    `;
    await writeFile(
      loader,
      `import { registerHooks } from "node:module";
registerHooks({ load(url, context, nextLoad) {
  if (url === ${JSON.stringify(new URL("../../../dist/process/OwnedCommand.js", import.meta.url).href)})
    return { format: "module", shortCircuit: true, source: ${JSON.stringify(source)} };
  return nextLoad(url, context);
}});`,
    );
    const result = await processes.run(
      process.execPath,
      [
        "--import",
        loader,
        fileURLToPath(
          new URL(
            "../../../scripts/verify-agent-experience.mjs",
            import.meta.url,
          ),
        ),
      ],
      {
        env: { ...process.env, REA_AGENT_EVAL_ROOT: parent },
        timeoutMs: 10_000,
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain(
      "Command started before ownership preparation",
    );
    expect(result.stderr).toContain(
      phase === "ordered"
        ? "fixture command reached after preparation"
        : "fixture preparation failure",
    );
    const observed: { run: string; prepared: boolean } = JSON.parse(
      await readFile(receipt, "utf8"),
    );
    expect(observed.prepared).toBe(true);
    if (phase !== "ordered")
      expect(await readFile(retried, "utf8")).toBe(
        "exact preparation owner retried",
      );
    if (incomplete) {
      expect(result.stderr).toContain("Artifact cleanup remains incomplete");
      expect(result.stderr).toContain("darwin-fixture-reader");
      expect(
        await readFile(join(observed.run, "codex/auth.json"), "utf8"),
      ).toBe("inert preparation fixture");
    } else {
      await expect(
        readFile(join(observed.run, "codex/auth.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
  },
);
