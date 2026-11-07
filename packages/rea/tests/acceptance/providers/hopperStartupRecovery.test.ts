import { spawn, type ChildProcess } from "node:child_process";
import { access, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, onTestFinished, vi } from "vitest";
import { z } from "zod";

import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";
import { workspaceCliTest } from "../../support/cli/workspaceCliFixture.js";
import { acquireHopperTargetLease } from "../../../src/process/HopperLease.js";

const statusSchema = z.object({ result: z.object({ open: z.boolean() }) });
const test = workspaceCliTest.skipIf(process.platform !== "darwin");

const stopChild = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolveExit) =>
    child.once("exit", () => resolveExit()),
  );
  child.kill("SIGKILL");
  await exited;
};

const closeWithLateBridge = async (
  mcp: Client,
  startBridge: () => ChildProcess,
): Promise<ChildProcess> => {
  let closeStarted!: () => void;
  const started = new Promise<void>((resolveStarted) => {
    closeStarted = resolveStarted;
  });
  const closing = mcp.callTool(
    { name: "close_binary", arguments: {} },
    { onprogress: () => closeStarted() },
  );
  let closeAcknowledged = false;
  try {
    await awaitAcknowledgement(started, closing, "late bridge close progress");
    closeAcknowledged = true;
    // A verified close may remove the socket before the fixture can poll it.
    // The successful close and child exit establish the owned bridge outcome.
    const owned = startBridge();
    expect((await closing).isError).not.toBe(true);
    return owned;
  } finally {
    if (!closeAcknowledged) await mcp.close();
    await Promise.allSettled([closing]);
  }
};

test.for(["target", "loader"] as const)(
  "preserves a prepared target or refuses literal-unsafe %s before handoff",
  { timeout: 90_000 },
  async (source, { workspace, cli }) => {
    const target = workspace.path(
      source === "target" ? 'quoted"target' : "loader-target",
    );
    await copyFile("/usr/bin/true", target);
    const mode = await workspace.write(
      `${source}-mode`,
      source === "target" ? "bridge" : "denied-after-handoff",
    );
    const receipt = workspace.path(`${source}-bootstrap`);
    const loaderArgs = [
      resolve("tests/fixtures/hopperLaunchAdmission.mjs"),
      mode,
      receipt,
      ...(source === "loader" ? ['caller"loader'] : []),
    ];
    const environment = {
      ...workspace.environment,
      PATH: process.env.PATH ?? "",
      REA_ANALYSIS_PROVIDER: "hopper",
      HOPPER_LAUNCHER_PATH: process.execPath,
      HOPPER_LOADER_ARGS_JSON: JSON.stringify(loaderArgs),
      REA_LOG_LEVEL: "silent",
    };
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/main.js")],
      stderr: "pipe",
      env: environment,
    });
    const mcp = new Client({ name: "hopper-literal-boundary", version: "1" });
    onTestFinished(async () => {
      await mcp.close();
      await transport.close();
    });
    await mcp.connect(transport);
    const call = (name: string, arguments_: Record<string, string> = {}) =>
      mcp.callTool({ name, arguments: arguments_ });
    expect((await call("open_binary", { path: target })).isError).not.toBe(
      true,
    );
    if (source === "target") {
      // The real Mach-O is copied to a prepared path; its original name stays valid.
      expect((await call("current_document")).isError).not.toBe(true);
      const runtime = dirname(await readFile(receipt, "utf8"));
      await access(runtime);
      await access(target);
      expect((await call("close_binary")).isError).not.toBe(true);
      await expect(access(runtime)).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      const rejection = {
        boundary: "argument_encoding",
        reason: "applescript_literal",
        source: "argument",
        argument_index: 3,
      };
      for (const operation of ["current_document", "list_procedures"]) {
        expect(parseMcpToolError(await call(operation)).error).toMatchObject({
          code: "provider_unavailable",
          details: { launch_rejection: rejection },
        });
      }
      await expect(access(receipt)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(`${receipt}.document-created`)).rejects.toMatchObject(
        { code: "ENOENT" },
      );
      const result = await cli.run({
        arguments: ["analyze", target, "--provider", "hopper", "--json"],
        environment,
        timeoutMs: 15_000,
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "provider_unavailable",
        details: { launch_rejection: rejection },
      });
      expect((await call("close_binary")).isError).not.toBe(true);
    }
    expect(
      statusSchema.parse((await call("binary_session")).structuredContent)
        .result.open,
    ).toBe(false);
    const acquired = await acquireHopperTargetLease({
      targetPath: target,
      targetKind: "executable",
      loaderArgs,
      runId: "literal-boundary-lease-reuse",
    });
    if (!acquired.acquired)
      throw new Error("Completed literal-boundary workflow retained its lease");
    await acquired.lease.release();
  },
);

test("recovers a denied Hopper launch through the same stdio MCP session and CLI", async ({
  workspace,
  cli,
}) => {
  const target = workspace.path("target");
  await copyFile("/usr/bin/true", target);
  const mode = await workspace.write("mode", "denied");
  const receipt = workspace.path("bootstrap-path");
  const environment = {
    ...workspace.environment,
    PATH: process.env.PATH ?? "",
    REA_ANALYSIS_PROVIDER: "hopper",
    HOPPER_LAUNCHER_PATH: process.execPath,
    HOPPER_LOADER_ARGS_JSON: JSON.stringify([
      resolve("tests/fixtures/hopperLaunchAdmission.mjs"),
      mode,
      receipt,
    ]),
    REA_LOG_LEVEL: "silent",
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/main.js")],
    env: environment,
    stderr: "pipe",
  });
  const mcp = new Client({ name: "hopper-startup-recovery", version: "1" });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  onTestFinished(async () => {
    await mcp.close();
    await transport.close();
  });
  await mcp.connect(transport);
  const call = (name: string, arguments_: Record<string, string> = {}) =>
    mcp.callTool({ name, arguments: arguments_ }).catch((cause: unknown) => {
      throw new Error(`${name}: ${stderr}`, { cause });
    });
  expect((await call("open_binary", { path: target })).isError).not.toBe(true);
  for (const operation of ["current_document", "list_procedures"]) {
    const { error } = parseMcpToolError(await call(operation));
    expect(error).toMatchObject({
      code: "provider_unavailable",
      details: {
        stage: "launch",
        launcher: {
          exit_code: 2,
          stderr: {
            text: expect.stringContaining(
              "Not authorized to send Apple events",
            ),
          },
        },
      },
    });
    expect(error.message).toContain("Automation");
    const bootstrap = await readFile(receipt, "utf8");
    await expect(access(dirname(bootstrap))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }
  expect((await call("close_binary")).isError).not.toBe(true);
  const deniedCli = await cli.run({
    arguments: ["analyze", target, "--provider", "hopper", "--json"],
    environment,
    timeoutMs: 15_000,
  });
  expect(deniedCli.exitCode).toBe(1);
  expect(deniedCli.json).toMatchObject({
    code: "provider_unavailable",
    details: { launcher: { exit_code: 2 } },
  });

  await writeFile(mode, "bridge");
  expect((await call("open_binary", { path: target })).isError).not.toBe(true);
  expect((await call("current_document")).isError).not.toBe(true);
  expect((await call("close_binary")).isError).not.toBe(true);
  expect(
    statusSchema.parse((await call("binary_session")).structuredContent).result
      .open,
  ).toBe(false);
});

test.for(["handoff", "not-found"] as const)(
  "preserves an unconfirmed %s handoff and closes only a late bridge with matching run identity",
  { timeout: 60_000 },
  async (launchMode, { workspace }) => {
    const target = workspace.path("target");
    await copyFile("/usr/bin/true", target);
    // Budget the complete native startup, including cold helper preparation.
    // The scenario below requires observed handoff, not a pre-launch timeout.
    const startupTimeoutMs = 10_000;
    const mode = await workspace.write("mode", launchMode);
    const receipt = workspace.path("bootstrap-path");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/main.js")],
      stderr: "pipe",
      env: {
        ...workspace.environment,
        PATH: process.env.PATH ?? "",
        REA_ANALYSIS_PROVIDER: "hopper",
        HOPPER_LAUNCHER_PATH: process.execPath,
        HOPPER_LOADER_ARGS_JSON: JSON.stringify([
          resolve("tests/fixtures/hopperLaunchAdmission.mjs"),
          mode,
          receipt,
        ]),
        REA_HOPPER_STARTUP_TIMEOUT_MS: String(startupTimeoutMs),
        REA_LOG_LEVEL: "silent",
      },
    });
    const mcp = new Client({ name: "hopper-late-readiness", version: "1" });
    const children: ChildProcess[] = [];
    let runtime: string | undefined;
    onTestFinished(async () => {
      await Promise.all(children.map(stopChild));
      await mcp.close();
      await transport.close();
      if (runtime !== undefined)
        await rm(runtime, { recursive: true, force: true });
    });
    await mcp.connect(transport);
    const call = (name: string, arguments_: Record<string, string> = {}) =>
      mcp.callTool({ name, arguments: arguments_ });
    expect((await call("open_binary", { path: target })).isError).not.toBe(
      true,
    );
    const initial = parseMcpToolError(await call("current_document"));
    // Capture ownership evidence before result assertions so teardown retains
    // the runtime even when the asserted failure stage regresses.
    const bootstrapPath = await readFile(receipt, "utf8");
    runtime = dirname(bootstrapPath);
    expect(initial.error).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        diagnostics: {
          primary_error: {
            code:
              launchMode === "handoff"
                ? "provider_timeout"
                : "provider_unavailable",
            details:
              launchMode === "handoff"
                ? { timeout_ms: startupTimeoutMs, launcher: { exit_code: 0 } }
                : { stage: "launch", launcher: { exit_code: 3 } },
          },
        },
      },
    });
    if (launchMode === "not-found") {
      await access(`${receipt}.document-created`);
      expect(initial.error.details).toMatchObject({
        diagnostics: {
          primary_error: { message: expect.stringContaining("Spotlight") },
        },
      });
    }
    expect(parseMcpToolError(await call("list_procedures"))).toEqual(initial);
    const status = z.object({
      result: z.object({
        provider_operation_health: z.object({
          // A timeout observes incomplete startup; a failed launcher without
          // confirmed ownership leaves the provider's state unknown.
          state: z.literal(
            launchMode === "handoff" ? "not_started" : "unknown",
          ),
          stage: z.literal("launch"),
        }),
      }),
    });
    status.parse((await call("binary_session")).structuredContent);
    expect(parseMcpToolError(await call("close_binary")).error.code).toBe(
      "cleanup_incomplete",
    );
    const bootstrap = await readFile(bootstrapPath, "utf8");
    const setting = (name: string): string => {
      const line = bootstrap
        .split("\n")
        .find((value) => value.startsWith(`${name} = `));
      if (line === undefined)
        throw new Error(`Missing bootstrap setting ${name}`);
      return z.string().parse(JSON.parse(line.slice(name.length + 3)));
    };
    const socket = setting("REA_SOCKET");
    const token = setting("REA_TOKEN");
    const runId = setting("REA_RUN_ID");
    runtime = dirname(socket);
    const lateBridge = (identity: string, credential = token) => {
      const child = spawn(
        process.execPath,
        [
          resolve("tests/fixtures/fakeHopper.mjs"),
          socket,
          credential,
          identity,
        ],
        { stdio: "ignore" },
      );
      children.push(child);
      return child;
    };
    for (const [identity, credential] of [
      ["different-run", token],
      [runId, "different-token"],
    ] as const) {
      const wrong = lateBridge(identity, credential);
      await vi.waitFor(() => access(socket));
      expect(parseMcpToolError(await call("close_binary")).error.code).toBe(
        "cleanup_incomplete",
      );
      expect(wrong.exitCode).toBeNull();
      await access(runtime);
      await stopChild(wrong);
      await rm(socket, { force: true });
    }
    const owned = await closeWithLateBridge(mcp, () => lateBridge(runId));
    await vi.waitFor(() => expect(owned.exitCode).toBe(0));
    await expect(access(runtime)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(mode, "bridge");
    expect((await call("open_binary", { path: target })).isError).not.toBe(
      true,
    );
    expect((await call("current_document")).isError).not.toBe(true);
    expect((await call("close_binary")).isError).not.toBe(true);
  },
);
