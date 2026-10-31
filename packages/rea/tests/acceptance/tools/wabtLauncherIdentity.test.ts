import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { z } from "zod";

import { analysisErrorProjectionSchema } from "../../../src/contracts/errorSchemas.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { wasmArtifactSchema } from "../../../src/domain/wasm/wasmArtifact.js";
import { observeProcessStartIdentity } from "../../../src/process/ProcessOwnershipObservation.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const tools = ["wasm-validate", "wasm-objdump", "wasm2wat"] as const;
const commandTraceSchema = z.object({
  tool: z.enum(tools),
  pid: z.int().positive(),
  cwd: z.string(),
  run_id: z.string(),
  version: z.boolean(),
  snapshot_sha256: z.string().nullable(),
});
const fixtureUrl = (name: string) =>
  fileURLToPath(new URL(`../../fixtures/wasm/${name}`, import.meta.url));

/** Real shell/Node launchers with authored WABT output, not installed WABT engines. */
const createFixture = async () => {
  const root = await createTestTempDirectory("rea-wabt-launcher-");
  const artifact = join(root, "selected module.wasm");
  const hold = join(root, "hold-decoder");
  const trace = join(root, "commands.jsonl");
  const scratch = join(root, "scratch");
  const runner = join(root, "wabt-runner.cjs");
  await mkdir(scratch);
  const bytes = Buffer.from(
    "0061736d01000000010401600000020b0103656e7603666f6f0000030201000503010001071002066d656d6f727902000372756e00010a0601040001010b000c04746573747061796c6f6164",
    "hex",
  );
  await writeFile(artifact, bytes);
  await writeFile(
    runner,
    `
    const fs = require("node:fs");
    const tool = process.argv[2];
    const version = process.argv[3] === "--version";
    const snapshot_sha256 = version ? null : require("node:crypto").createHash("sha256").update(fs.readFileSync("module.wasm")).digest("hex");
    fs.appendFileSync(process.env.REA_WABT_TEST_TRACE, JSON.stringify({ tool, pid: process.pid, version, cwd: process.cwd(), run_id: process.env.REA_PROCESS_RUN_ID, snapshot_sha256 }) + "\\n");
    if (version) {
      process.stdout.write("1.0.42\\n");
      if (tool === "wasm-validate" && process.env.REA_WABT_TEST_REVOKE_COMMAND)
        fs.chmodSync(process.env.REA_WABT_TEST_REVOKE_COMMAND, 0);
    }
    else if (tool === "wasm-objdump") { process.stdout.write(fs.readFileSync(process.env.REA_WABT_TEST_DUMP)); }
    else if (tool === "wasm2wat") {
      const decode = () => process.stdout.write(fs.readFileSync(process.env.REA_WABT_TEST_WAT));
      if (fs.existsSync(process.env.REA_WABT_TEST_HOLD)) {
        setTimeout(decode, 4000);
      } else { decode(); }
    }
  `,
  );
  const install = async (directory: string, decoy = false) => {
    await mkdir(directory, { recursive: true });
    for (const tool of tools)
      await writeFile(
        join(directory, tool),
        decoy
          ? "#!/bin/sh\nprintf 'unselected-decoy\\n'\n"
          : `#!/bin/sh\nexec "$REA_WABT_TEST_NODE" "$REA_WABT_TEST_RUNNER" "${tool}" "$@"\n`,
        { mode: 0o700 },
      );
  };
  const environment = {
    ...process.env,
    REA_WABT_TEST_NODE: process.execPath,
    REA_WABT_TEST_RUNNER: runner,
    REA_WABT_TEST_DUMP: fixtureUrl("objdump.txt"),
    REA_WABT_TEST_WAT: fixtureUrl("decoded.wat"),
    REA_WABT_TEST_HOLD: hold,
    REA_WABT_TEST_TRACE: trace,
    TMPDIR: scratch,
    TMP: scratch,
    TEMP: scratch,
  };
  return {
    root,
    artifact,
    bytes,
    hold,
    trace,
    scratch,
    install,
    environment,
  };
};

cliTest.skipIf(process.platform === "win32")(
  "cleans up real selected WABT interpreter shims after a command deadline",
  async ({ cli }) => {
    const fixture = await createFixture();
    const selected = join(fixture.root, "selected tools");
    await fixture.install(selected);
    const invoke = (timeout: number) =>
      cli.run({
        arguments: [
          "inspect-wasm-artifact",
          fixture.artifact,
          "--command-timeout-ms",
          String(timeout),
          "--json",
        ],
        environment: {
          ...fixture.environment,
          REA_WABT_BIN_DIRECTORY: selected,
        },
      });
    const control = await invoke(10_000);
    expect(control.exitCode, `${control.stderr}\n${control.stdout}`).toBe(0);
    const evidence = parseEvidence(control.json);
    const report = wasmArtifactSchema.parse(evidence.normalized_result);
    expect(report.artifact.sha256).toBe(
      createHash("sha256").update(fixture.bytes).digest("hex"),
    );
    expect(report.validation).toBe("valid");
    const trace = (await readFile(fixture.trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => commandTraceSchema.parse(JSON.parse(line)));
    expect(trace.length).toBeGreaterThan(0);
    expect(new Set(trace.map(({ cwd }) => cwd)).size).toBe(1);
    for (const command of trace) {
      expect(command.cwd.startsWith(join(fixture.scratch, "rea-wabt-"))).toBe(
        true,
      );
      expect(command.run_id).toMatch(/^rea-wabt-/u);
      expect(command.snapshot_sha256).toBe(
        command.version ? null : report.artifact.sha256,
      );
    }
    expect(await readdir(fixture.scratch)).toEqual([]);

    await writeFile(fixture.hold, "hold this invocation");
    try {
      const invocation = await invoke(2_000);
      expect(invocation.exitCode, invocation.stderr).toBe(1);
      const failure = analysisErrorProjectionSchema.parse(invocation.json);
      expect(failure, invocation.stdout).toMatchObject({
        code: "provider_timeout",
        details: {
          partial_observation: {
            normalized_result: {
              validation: "valid",
              artifact: { sha256: report.artifact.sha256 },
            },
          },
        },
      });
      expect(await readdir(fixture.scratch)).toEqual([]);
      expect((await readFile(fixture.artifact)).equals(fixture.bytes)).toBe(
        true,
      );
    } finally {
      // The authored shim self-exits even on the unfixed cleanup-refusal path.
      // Observe its actual process lifetime; token-owned cleanup can use SIGKILL.
      const commands = (await readFile(fixture.trace, "utf8"))
        .trim()
        .split("\n")
        .map((line) => commandTraceSchema.parse(JSON.parse(line)));
      const decoder = commands.findLast(
        (command) => command.tool === "wasm2wat" && !command.version,
      );
      if (decoder === undefined)
        throw new Error("No decoder process was observed");
      await expect
        .poll(
          () =>
            observeProcessStartIdentity(decoder.pid, undefined, decoder.run_id),
          { timeout: 6000 },
        )
        .toBeUndefined();
    }
  },
);

cliTest.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "retains completed WABT version output when its post-command fingerprint read is denied",
  async ({ cli }) => {
    const fixture = await createFixture();
    const selected = join(fixture.root, "tools");
    await fixture.install(selected);
    const revoked = join(selected, "wasm-validate");
    try {
      const invocation = await cli.run({
        arguments: ["inspect-wasm-artifact", fixture.artifact, "--json"],
        environment: {
          ...fixture.environment,
          REA_WABT_BIN_DIRECTORY: selected,
          REA_WABT_TEST_REVOKE_COMMAND: revoked,
        },
      });
      expect(invocation.exitCode, invocation.stderr).toBe(1);
      const failure = analysisErrorProjectionSchema.parse(invocation.json);
      expect(failure, invocation.stdout).toMatchObject({
        code: "capability_unavailable",
        details: {
          captured_output: {
            stdout: "1.0.42\n",
            stderr: "",
            truncated: false,
            exit_code: 0,
            signal: null,
          },
        },
      });
      expect((await readFile(fixture.artifact)).equals(fixture.bytes)).toBe(
        true,
      );
      expect(await readdir(fixture.scratch)).toEqual([]);
    } finally {
      await chmod(revoked, 0o700);
    }
  },
);

cliTest.skipIf(process.platform === "win32")(
  "launches selected WABT symlinks with their own sibling resources and fingerprints canonical tools",
  async ({ cli }) => {
    const fixture = await createFixture();
    const targets = join(fixture.root, "canonical tools");
    const selected = join(fixture.root, "selected links");
    await fixture.install(targets);
    await mkdir(selected);
    await writeFile(
      join(selected, "wabt-environment"),
      "# selected installation resource\n",
    );
    for (const tool of tools) {
      const target = join(targets, tool);
      const script = await readFile(target, "utf8");
      await writeFile(
        target,
        script.replace(
          "#!/bin/sh\n",
          '#!/bin/sh\n. "${0%/*}/wabt-environment"\n',
        ),
      );
      await symlink(target, join(selected, tool));
    }
    const invocation = await cli.run({
      arguments: ["inspect-wasm-artifact", fixture.artifact, "--json"],
      environment: { ...fixture.environment, REA_WABT_BIN_DIRECTORY: selected },
    });
    expect(
      invocation.exitCode,
      `${invocation.stderr}\n${invocation.stdout}`,
    ).toBe(0);
    const report = wasmArtifactSchema.parse(
      parseEvidence(invocation.json).normalized_result,
    );
    expect(report.tool_profile.commands.map(({ path }) => path)).toEqual(
      tools.map((tool) => join(targets, tool)),
    );
    for (const command of report.tool_profile.commands)
      expect(command.sha256).toBe(
        createHash("sha256")
          .update(await readFile(command.path))
          .digest("hex"),
      );
    expect((await readFile(fixture.artifact)).equals(fixture.bytes)).toBe(true);
    expect(await readdir(fixture.scratch)).toEqual([]);
  },
);

cliTest.skipIf(process.platform === "win32")(
  "selects a WABT directory through literal symlink and parent traversal",
  async ({ cli }) => {
    const fixture = await createFixture();
    const intended = join(fixture.root, "intended");
    await mkdir(join(intended, "nested"), { recursive: true });
    await symlink(join(intended, "nested"), join(fixture.root, "alias"));
    const selected = join(intended, "tools");
    await fixture.install(selected);
    await fixture.install(join(fixture.root, "tools"), true);
    const invocation = await cli.run({
      arguments: ["inspect-wasm-artifact", fixture.artifact, "--json"],
      environment: {
        ...fixture.environment,
        REA_WABT_BIN_DIRECTORY: `${fixture.root}/alias/../tools`,
      },
    });
    expect(
      invocation.exitCode,
      `${invocation.stderr}\n${invocation.stdout}`,
    ).toBe(0);
    const report = wasmArtifactSchema.parse(
      parseEvidence(invocation.json).normalized_result,
    );
    expect(report.tool_profile.commands.map(({ path }) => path)).toEqual(
      tools.map((tool) => join(selected, tool)),
    );
    for (const command of report.tool_profile.commands)
      expect(command.sha256).toBe(
        createHash("sha256")
          .update(await readFile(command.path))
          .digest("hex"),
      );
    expect(report.artifact.path).toBe(fixture.artifact);
    expect((await readFile(fixture.artifact)).equals(fixture.bytes)).toBe(true);
    expect(await readdir(fixture.scratch)).toEqual([]);
    await expect(
      access(join(fixture.root, "tools", "wasm-validate")),
    ).resolves.toBeUndefined();
  },
);
