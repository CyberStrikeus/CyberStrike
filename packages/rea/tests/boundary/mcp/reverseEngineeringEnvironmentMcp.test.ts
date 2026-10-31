import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Client } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";

import { createProviderEnvironmentMcpHarness } from "../../support/reverseDebuggerMcpTestHelpers.js";

const writeProvider = async (path: string, output: string): Promise<void> => {
  await writeFile(
    path,
    `#!${process.execPath}\nprocess.stdout.write('${output}');\n`,
  );
  await chmod(path, 0o755);
};

const connectProviderClient = (options: {
  readonly directory: string;
  readonly clientName: string;
  readonly configuredProvider: string;
  readonly providerEnvironment?: { REA_RIZIN_COMMAND: string };
}) =>
  createProviderEnvironmentMcpHarness({
    directory: options.directory,
    clientName: options.clientName,
    serverOptions: {
      environment: { REA_RIZIN_COMMAND: options.configuredProvider },
      ...(options.providerEnvironment === undefined
        ? {}
        : { providerEnvironment: options.providerEnvironment }),
    },
  });

const executeRizinCommand = async (
  client: Client,
  artifact: string,
): Promise<Awaited<ReturnType<Client["callTool"]>>> => {
  const response = await client.callTool({
    name: "execute_rizin_command",
    arguments: { path: artifact, command: "iI" },
  });
  expect(response.isError).not.toBe(true);
  return response;
};

it("uses the captured server environment to resolve reverse-engineering providers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-provider-environment-"));
  const provider = join(directory, "selected-rizin");
  const artifact = join(directory, "fixture.bin");
  await writeFile(artifact, "fixture");
  await writeProvider(provider, "captured-environment-provider");

  const { client } = await connectProviderClient({
    directory,
    clientName: "reverse-provider-environment",
    configuredProvider: provider,
  });
  const response = await executeRizinCommand(client, artifact);
  expect(response.structuredContent).toMatchObject({
    raw_result: { stdout: "captured-environment-provider" },
  });
});

it("prefers an explicit provider environment over the captured server environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-provider-override-"));
  const configured = join(directory, "captured-rizin");
  const override = join(directory, "override-rizin");
  const artifact = join(directory, "fixture.bin");
  await writeFile(artifact, "fixture");
  for (const [path, output] of [
    [configured, "captured"],
    [override, "explicit-override"],
  ] as const) {
    await writeProvider(path, output);
  }
  const { client } = await connectProviderClient({
    directory,
    clientName: "reverse-provider-override",
    configuredProvider: configured,
    providerEnvironment: { REA_RIZIN_COMMAND: override },
  });

  const response = await executeRizinCommand(client, artifact);
  expect(response.structuredContent).toMatchObject({
    raw_result: { stdout: "explicit-override" },
  });
  expect(JSON.stringify(response.structuredContent)).not.toContain(
    '"captured"',
  );
});

it("snapshots an explicit provider environment when the server is created", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-provider-snapshot-"));
  const configured = join(directory, "captured-rizin");
  const override = join(directory, "explicit-rizin");
  const artifact = join(directory, "fixture.bin");
  await writeFile(artifact, "fixture");
  for (const [path, output] of [
    [configured, "captured"],
    [override, "explicit-snapshot"],
  ] as const) {
    await writeProvider(path, output);
  }
  const providerEnvironment = { REA_RIZIN_COMMAND: override };
  const { client } = await connectProviderClient({
    directory,
    clientName: "reverse-provider-snapshot",
    configuredProvider: configured,
    providerEnvironment,
  });
  providerEnvironment.REA_RIZIN_COMMAND = configured;

  const response = await executeRizinCommand(client, artifact);
  expect(response.structuredContent).toMatchObject({
    raw_result: { stdout: "explicit-snapshot" },
  });
  expect(JSON.stringify(response.structuredContent)).not.toContain(
    '"captured"',
  );
});
