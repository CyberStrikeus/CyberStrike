import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

processTest(
  "returns a nonzero exit for a streamed JSON analysis failure",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-cli-js-missing-");
    const result = await processes.run(
      process.execPath,
      [
        "scripts/rea.mjs",
        "analyze-javascript-application",
        join(root, "missing"),
        "--json",
      ],
      { timeoutMs: 20_000 },
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: "invalid_request",
      details: { issues: [{ path: ["input_path"], reason: "invalid_value" }] },
    });
  },
);

// `analyze` routes a JavaScript directory to the same workflow and must keep
// its typed cancellation contract.
processTest.skipIf(process.platform === "win32").for([
  {
    command: "analyze-javascript-application",
    phase: "analyze_javascript_application",
    parsedFiles: null,
  },
  {
    command: "analyze",
    phase: "analyze_javascript_application",
    parsedFiles: null,
  },
  {
    command: "analyze-javascript-application",
    phase: "build_javascript_application_graph",
    parsedFiles: 1,
  },
  {
    command: "analyze-javascript-application",
    phase: "hash_javascript_application_evidence",
    parsedFiles: 1,
  },
])(
  "returns typed cancellation and exit 130 through $command during $phase",
  async ({ command, phase, parsedFiles }, { processes }) => {
    const root = await createTestTempDirectory("rea-cli-js-cancellation-");
    await writeFile(join(root, "main.js"), "export const observed = 1;\n");
    const nodeArguments: string[] = [];
    if (parsedFiles !== null) {
      // A tiny graph/hash phase may finish before the parent receives stderr.
      // Invoke the real signal handler synchronously in the owned CLI child at
      // that progress boundary; the two early-phase cases still use OS SIGINT.
      const controls = await createTestTempDirectory("rea-cli-cancel-control-");
      const preload = join(controls, "cancel-at-phase.mjs");
      await writeFile(
        preload,
        `
        const write = process.stderr.write.bind(process.stderr);
        let requested = false;
        process.stderr.write = function(chunk, ...args) {
          const written = write(chunk, ...args);
          let update;
          try { update = JSON.parse(String(chunk)); } catch {}
          if (!requested && update?.rea_progress?.phase === ${JSON.stringify(phase)}) {
            requested = true;
            process.emit("SIGINT");
          }
          return written;
        };
      `,
      );
      nodeArguments.push("--import", preload);
    }
    const child = processes.spawn(process.execPath, [
      ...nodeArguments,
      "scripts/rea.mjs",
      command,
      root,
      "--json",
    ]);
    child.stdin.end();
    let stdout = "",
      partial = "",
      requested = false;
    const progressSchema = z.object({
      rea_progress: z.object({ phase: z.string() }),
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      partial += chunk.toString();
      let newline: number;
      while ((newline = partial.indexOf("\n")) >= 0) {
        const line = partial.slice(0, newline);
        partial = partial.slice(newline + 1);
        const parsed = progressSchema.safeParse(JSON.parse(line));
        if (
          parsed.success &&
          parsed.data.rea_progress.phase === phase &&
          !requested
        ) {
          requested = true;
          if (parsedFiles === null) child.kill("SIGINT");
        }
      }
    });
    const exited = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    expect(requested).toBe(true);
    expect(exited).toEqual({ code: 130, signal: null });
    expect(JSON.parse(stdout)).toMatchObject({
      code: "cancelled",
      details: { reason: "cancelled" },
    });
    if (parsedFiles !== null)
      expect(JSON.parse(stdout)).toMatchObject({
        details: {
          partial_observation: {
            normalized_result: {
              statistics: {
                parsed_javascript_files: parsedFiles,
                parse_failures: 0,
              },
            },
          },
        },
      });
  },
);
