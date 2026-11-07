import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { z } from "zod";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);

// Release rehearsal runs on Linux; the npm process adapter is also exercised on macOS.
it.skipIf(process.platform === "win32")(
  "fails without declared runtime, then rehearses an installed tarball and rejects catalog drift",
  async () => {
    const root = await createTestTempDirectory("rea-release-canary-");
    const candidate = join(root, "candidate");
    const controller = join(root, "controller");
    const { version } = z
      .object({ version: z.string() })
      .parse(JSON.parse(await readFile("package.json", "utf8")));
    const harness = await createApplicationMcpHarness();
    let snapshot;
    try {
      const tools = await harness.client.listTools();
      const sessionDefinition = tools.tools.find(
        ({ name }) => name === "binary_session",
      );
      if (sessionDefinition === undefined)
        throw new Error("Canary snapshot omitted binary_session");
      snapshot = {
        serverInfo: harness.client.getServerVersion(),
        protocolVersion: harness.client.getNegotiatedProtocolVersion(),
        tools,
        reply: await harness.client.callTool(
          { name: "binary_session", arguments: {} },
          { toolDefinition: sessionDefinition },
        ),
      };
    } finally {
      await harness.close();
    }
    await mkdir(join(candidate, "scripts"), { recursive: true });
    await writeFile(
      join(candidate, "package.json"),
      JSON.stringify({
        name: "rea-agents",
        version,
        type: "module",
        files: ["scripts"],
      }),
    );
    await copyFile(
      "tests/fixtures/mcpDoctorReply.mjs",
      join(candidate, "scripts/replay.mjs"),
    );
    await writeFile(
      join(candidate, "scripts/reply.json"),
      JSON.stringify(snapshot),
    );
    await writeFile(
      join(candidate, "scripts/rea.mjs"),
      `
import { fileURLToPath } from "node:url";
if (process.argv[2] === "mcp") {
  process.argv[2] = fileURLToPath(new URL("./reply.json", import.meta.url));
  await import("./replay.mjs");
} else if (["--help", "--llms"].includes(process.argv[2])) {
  console.log("REA fixture CLI");
} else { process.exitCode = 1; }
`,
    );
    const packed = await execute(
      "npm",
      ["pack", "--ignore-scripts", "--json"],
      {
        cwd: candidate,
      },
    );
    const [{ filename }] = z
      .tuple([z.object({ filename: z.string() })])
      .parse(JSON.parse(packed.stdout));
    const tarball = join(candidate, filename);
    for (const file of [
      "scripts/verify-release-artifact.mjs",
      "scripts/lib/release-package-canary.mjs",
      "scripts/lib/verify-package-core.mjs",
      "scripts/lib/mcp-verifier-results.mjs",
      "scripts/lib/verifier-run.mjs",
    ]) {
      const target = join(controller, file);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(file, target);
    }
    await writeFile(
      join(controller, "package.json"),
      JSON.stringify({ name: "rea-agents", version, type: "module" }),
    );
    await symlink(
      resolve("node_modules"),
      join(controller, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const invoke = (selected = tarball) =>
      execute(
        process.execPath,
        [
          join(controller, "scripts/verify-release-artifact.mjs"),
          selected,
          version,
        ],
        { cwd: controller, maxBuffer: 16 * 1024 * 1024 },
      );
    await expect(invoke()).rejects.toMatchObject({
      stderr: expect.stringContaining("ERR_MODULE_NOT_FOUND"),
    });
    await symlink(
      resolve("dist"),
      join(controller, "dist"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = JSON.parse((await invoke()).stdout);
    expect(result).toMatchObject({
      package: "rea-agents",
      version,
      source: tarball,
      mcpTools: snapshot.tools.tools.length,
    });
    if (process.platform !== "win32")
      expect(result.verifier_run.process_lineage).toMatchObject({
        status: "verified",
        descendants: [],
      });
    // Repack with one omitted canonical tool; the real protocol still succeeds,
    // so only the independent release catalog assertion can reject this artifact.
    snapshot.tools.tools.pop();
    await writeFile(
      join(candidate, "scripts/reply.json"),
      JSON.stringify(snapshot),
    );
    await execute("npm", ["pack", "--ignore-scripts", "--json"], {
      cwd: candidate,
    });
    await expect(invoke()).rejects.toMatchObject({
      stderr: expect.stringContaining("invalid canonical tool catalog"),
    });
    await writeFile(
      join(candidate, "package.json"),
      JSON.stringify({
        name: "rea-agents",
        version: "0.0.0",
        type: "module",
        files: ["scripts"],
      }),
    );
    const wrong = await execute("npm", ["pack", "--ignore-scripts", "--json"], {
      cwd: candidate,
    });
    const [{ filename: wrongFilename }] = z
      .tuple([z.object({ filename: z.string() })])
      .parse(JSON.parse(wrong.stdout));
    await expect(invoke(join(candidate, wrongFilename))).rejects.toMatchObject({
      stderr: expect.stringContaining("Installed package identity"),
    });
  },
  30_000,
);
