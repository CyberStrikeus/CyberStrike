import { createServer } from "node:net";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import ts from "typescript6";

import { serveCli } from "./cliServeHarness.js";
import {
  spawnOwnedProviderProcess,
  ProviderProcessSupervisor,
} from "../../../src/process/ProviderProcess.js";

const SESSION_ID = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
const listen = async (
  server: ReturnType<typeof createServer>,
): Promise<number> => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected an ephemeral TCP listener");
  return address.port;
};

const assertRealVerifierJsonInspection = async (
  directory: string,
  commandJsonModes: readonly boolean[],
): Promise<void> => {
  // Exercise the actual real-verifier command selection against the public CLI.
  const source = ts.createSourceFile(
    "verify-real-cutter.mjs",
    await readFile("scripts/verify-real-cutter.mjs", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const observations: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "runCli" &&
      ts.isStringLiteral(node.arguments[0]!) &&
      node.arguments[0].text === "cutter-command" &&
      node.arguments[3] !== undefined &&
      ts.isStringLiteral(node.arguments[3]) &&
      node.arguments[3].text === "ij"
    ) {
      observations.push(
        node.arguments.slice(4).map((argument) => {
          if (!ts.isStringLiteral(argument))
            throw new Error(
              "Verifier inspection flags must be explicit arguments",
            );
          return argument.text;
        }),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(observations).toHaveLength(1);
  const verification = await serveCli(
    [
      "cutter-command",
      SESSION_ID,
      "0",
      "ij",
      ...observations[0]!,
      "--format",
      "json",
    ],
    { REA_CUTTER_BRIDGE_DIR: directory },
  );
  expect(verification.exitCode).toBe(0);
  expect(commandJsonModes.at(-1)).toBe(true);
  expect(JSON.parse(verification.stdout)).toMatchObject({
    predicate_type: "rea.cutter.command-observation",
    raw_result: { answer: 42 },
  });
};

describe("Cutter CLI commands", () => {
  let directory: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server !== undefined)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    directory = undefined;
    server = undefined;
  });

  it("lists sessions from the selected bridge directory", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-cli-test-"));

    const result = await serveCli(["list-cutter-sessions", "--json"], {
      REA_CUTTER_BRIDGE_DIR: directory,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      sessions: [],
      discovery_status: "no_live_bridge_found",
      bridge_directory: directory,
    });
  });

  it.skipIf(process.platform === "win32")(
    "awaits discovery cancellation on SIGINT and returns its typed outcome with exit130",
    async () => {
      directory = await mkdtemp(join(tmpdir(), "rea-cutter-cli-cancel-"));
      const sockets = new Set<import("node:net").Socket>();
      let accepted = 0;
      server = createServer((socket) => {
        accepted += 1;
        sockets.add(socket);
        socket.on("error", () => undefined);
        socket.on("close", () => sockets.delete(socket));
        socket.resume();
      });
      const port = await listen(server);
      for (let index = 0; index < 9; index += 1) {
        const id = randomUUID();
        await writeFile(
          join(directory, `cutter-${process.pid}-${id}.json`),
          JSON.stringify({
            session_id: id,
            pid: process.pid,
            host: "127.0.0.1",
            port,
            token: "cli-discovery-test-transport-token",
            document_generation: 0,
            current_file: null,
            cutter_version: null,
            identity_status: "partial",
          }),
          { mode: 0o600 },
        );
      }
      const launched = await spawnOwnedProviderProcess({
        command: process.execPath,
        arguments: ["scripts/rea.mjs", "list-cutter-sessions", "--json"],
        runId: randomUUID(),
        hostEnvironment: {
          ...process.env,
          REA_CUTTER_BRIDGE_DIR: directory,
          REA_LOG_LEVEL: "silent",
        },
      });
      const supervisor = new ProviderProcessSupervisor({
        ...launched,
        ownsProcessLifetime: true,
      });
      try {
        await expect.poll(() => accepted, { timeout: 5_000 }).toBe(8);
        launched.process.kill("SIGINT");
        expect(await supervisor.waitForExit(5_000)).toBe(true);
        expect(await supervisor.waitForOutputClose(1_000)).toBe(true);
        expect(launched.process.exitCode).toBe(130);
        expect(launched.process.signalCode).toBeNull();
        expect(JSON.parse(supervisor.snapshot().stdout.text)).toMatchObject({
          code: "cancelled",
        });
        await expect.poll(() => sockets.size).toBe(0);
        expect(accepted).toBe(8);
      } finally {
        for (const socket of sockets) socket.destroy();
        const stopped = await supervisor.stop();
        expect(stopped.status).not.toBe("incomplete");
      }
    },
  );

  it("reports an unavailable selected session for a command", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-cli-test-"));

    const result = await serveCli(
      ["cutter-command", SESSION_ID, "0", "pdi", "--json"],
      { REA_CUTTER_BRIDGE_DIR: directory },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("invalid_request");
  });
});

describe("Cutter CLI command output flags", () => {
  let directory: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server !== undefined)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    directory = undefined;
    server = undefined;
  });

  it("returns Evidence when the selected Cutter session completes a command", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-cli-test-"));
    const token = "synthetic-cutter-cli-token-for-test";
    let nextConnectionOrdinal = 0;
    const commandJsonModes: boolean[] = [];
    server = createServer((connection) => {
      const ordinal = ++nextConnectionOrdinal;
      connection.setEncoding("utf8");
      let input = "";
      let clientNonce = "";
      let serverNonce = "";
      connection.on("data", (chunk: string) => {
        input += chunk;
        const newline = input.indexOf("\n");
        if (newline < 0) return;
        const frame = JSON.parse(input.slice(0, newline)) as Record<
          string,
          unknown
        >;
        input = input.slice(newline + 1);
        if (frame.kind === "rea-auth-v2") {
          clientNonce = String(frame.nonce);
          serverNonce = `${ordinal.toString(16).padStart(16, "0")}${"b".repeat(48)}`;
          connection.write(
            `${JSON.stringify({ session_id: SESSION_ID, nonce: serverNonce, proof: createHmac("sha256", token).update(`rea-cutter-server-v2:${SESSION_ID}:${clientNonce}:${serverNonce}`).digest("hex") })}\n`,
          );
          return;
        }
        const requestBytes = String(frame.request);
        const request = JSON.parse(requestBytes) as Record<string, unknown>;
        if (request.kind === "command")
          commandJsonModes.push(request.json === true);
        if (
          frame.proof !==
          createHmac("sha256", token)
            .update(
              `rea-cutter-client-v2:${SESSION_ID}:${clientNonce}:${serverNonce}:${requestBytes}`,
            )
            .digest("hex")
        ) {
          connection.destroy();
          return;
        }
        const status = request.kind === "status";
        const response = JSON.stringify({
          ok: true,
          session_id: request.session_id,
          ...(status
            ? {
                current_file: null,
                document_generation: 0,
                cutter_version: "Cutter fixture",
                identity_status: "partial",
                completed_connection: (ordinal - 1)
                  .toString(16)
                  .padStart(16, "0"),
                completed_commands: [],
              }
            : request.kind === "ack"
              ? { acknowledged: false }
              : {
                  output: { answer: 42 },
                  current_file: null,
                  document_generation: 0,
                  cutter_version: "Cutter fixture",
                  identity_status: "partial",
                  execution_state: "complete",
                  output_truncated: false,
                }),
        });
        const proof = createHmac("sha256", token)
          .update(
            `rea-cutter-response-v2:${SESSION_ID}:${clientNonce}:${serverNonce}:${response}`,
          )
          .digest("hex");
        connection.end(`${JSON.stringify({ response, proof })}\n`);
      });
    });
    const port = await listen(server);
    await writeFile(
      join(directory, `cutter-${process.pid}-${SESSION_ID}.json`),
      JSON.stringify({
        session_id: SESSION_ID,
        pid: process.pid,
        host: "127.0.0.1",
        port,
        token,
        document_generation: 0,
        current_file: null,
        cutter_version: "Cutter fixture",
        identity_status: "partial",
      }),
      { mode: 0o600 },
    );

    const result = await serveCli(
      ["cutter-command", SESSION_ID, "000", "pdi", "--json-output"],
      { REA_CUTTER_BRIDGE_DIR: directory },
    );

    expect(result.exitCode).toBe(0);
    expect(commandJsonModes).toEqual([true]);
    expect(result.stdout).toContain("answer: 42");

    const formatted = await serveCli(
      ["cutter-command", SESSION_ID, "0", "pdi", "--json"],
      { REA_CUTTER_BRIDGE_DIR: directory },
    );
    expect(formatted.exitCode).toBe(0);
    expect(commandJsonModes).toEqual([true, false]);
    expect(() => JSON.parse(formatted.stdout)).not.toThrow();

    for (const [flags, expected] of [
      [["--json-output=true"], true],
      [["--json-output=false"], false],
      [["--json", "--json-output=false"], false],
      [["--json", "--json-output=true"], true],
      [["--json-output=false", "--json"], false],
      [["--json-output=true", "--json"], true],
    ] as const) {
      const selected = await serveCli(
        ["cutter-command", SESSION_ID, "0", "pdi", ...flags],
        { REA_CUTTER_BRIDGE_DIR: directory },
      );
      expect(selected.exitCode).toBe(0);
      expect(commandJsonModes.at(-1)).toBe(expected);
      if (flags.some((flag) => flag === "--json"))
        expect(() => JSON.parse(selected.stdout)).not.toThrow();
    }

    const commandsBeforeRejectedFlags = commandJsonModes.length;
    for (const flag of ["--json=true", "--json=false"]) {
      const rejected = await serveCli(
        ["cutter-command", SESSION_ID, "0", "pdi", flag],
        { REA_CUTTER_BRIDGE_DIR: directory },
      );
      expect(rejected.exitCode).toBe(1);
      expect(rejected.stdout).toContain("Unknown flag: --json");
    }
    expect(commandJsonModes).toHaveLength(commandsBeforeRejectedFlags);

    await assertRealVerifierJsonInspection(directory, commandJsonModes);
  });
});
