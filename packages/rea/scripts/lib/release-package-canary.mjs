import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { FULL_CATALOG_IDENTITY } from "../../dist/catalogIdentity.js";
import { verifyCompleteToolCatalog } from "./verify-package-core.mjs";

const execute = promisify(execFile);

/** Install the selected archive or registry specifier before any protocol deadline. */
export async function installCanaryPackage(specifier, workspace, environment) {
  const prefix = join(workspace, "installed");
  await execute(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-save",
      "--no-package-lock",
      "--no-audit",
      "--no-fund",
      "--prefix",
      prefix,
      specifier,
    ],
    { cwd: workspace, env: environment, maxBuffer: 16 * 1024 * 1024 },
  );
  return join(prefix, "node_modules", "rea-agents");
}

/** Exercise the same installed CLI/MCP contract before and after publication. */
export async function verifyInstalledCanaryPackage(
  packageRoot,
  version,
  workspace,
  environment,
) {
  const installed = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  if (installed.name !== "rea-agents" || installed.version !== version)
    throw new Error(
      `Installed package identity is ${installed.name}@${installed.version}, expected rea-agents@${version}`,
    );
  const launcher = join(packageRoot, "scripts", "rea.mjs");
  for (const option of ["--help", "--llms"])
    await execute(process.execPath, [launcher, option], {
      cwd: workspace,
      env: environment,
      maxBuffer: 16 * 1024 * 1024,
    });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [launcher, "mcp"],
    cwd: workspace,
    env: environment,
    stderr: "pipe",
  });
  const client = new Client({ name: "release-package-canary", version: "1" });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    if (stderr.length < 16_384)
      stderr += chunk.toString("utf8").slice(0, 16_384 - stderr.length);
  });
  try {
    await client.connect(transport);
    const toolNames = await verifyCompleteToolCatalog(client);
    return {
      mcpTools: toolNames.length,
      canonicalMcpTools: FULL_CATALOG_IDENTITY.counts.mcp_tools,
    };
  } catch (cause) {
    throw new Error(`Installed package MCP verification failed: ${stderr}`, {
      cause,
    });
  } finally {
    try {
      await client.close();
    } finally {
      await transport.close();
    }
  }
}
