import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { nativeDispatchMetadataResultSchema } from "../../../src/domain/native/objcSwiftMetadata.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { localToolsMcpEnvironment } from "../../fixtures/localToolsMcp.js";
import { objcRecordBudgetMacho } from "../../fixtures/objcRecordBudgetMacho.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

type Replacement = "missing" | "directory" | "loop" | "unreadable";

// Real native-macos dispatch acquisition, through the compiled stdio server.
// The self-authored Mach-O fixture is only read, never executed.
const inspectReplacements = async (replacements: readonly Replacement[]) => {
  const root = await createTestTempDirectory("rea-dispatch-bound-target-");
  const path = join(root, "fixture.macho");
  const bytes = objcRecordBudgetMacho("class");
  await writeFile(path, bytes);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    REA_LOG_LEVEL: "silent",
  };
  for (const key of [
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "TMPDIR",
  ]) {
    const directory = join(root, key.toLowerCase());
    env[key] = directory;
    await mkdir(directory);
  }
  const client = new Client({ name: "dispatch-bound-target", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("scripts/rea.mjs"), "mcp"],
    cwd: process.cwd(),
    env: localToolsMcpEnvironment(env),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (value) => {
    stderr += value;
  });
  const inspect = () =>
    client.callTool({
      name: "inspect_native_dispatch_metadata",
      arguments: { max_records: 100 },
    });
  const successfulRead = async () => {
    const reply = await inspect();
    expect(reply.isError).not.toBe(true);
    return nativeDispatchMetadataResultSchema.parse(
      parseEvidence(reply.structuredContent).normalized_result,
    );
  };
  try {
    await client.connect(transport);
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path },
    });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const control = await successfulRead();
    for (const replacement of replacements) {
      await rm(path, { recursive: true, force: true });
      if (replacement === "directory") await mkdir(path);
      if (replacement === "loop") await symlink("fixture.macho", path);
      if (replacement === "unreadable") {
        await writeFile(path, bytes);
        await chmod(path, 0);
      }
      try {
        const { error } = parseMcpToolError(await inspect());
        const denied = replacement === "unreadable";
        expect(error).toMatchObject({
          code: denied ? "access_denied" : "artifact_changed",
          category: denied ? "unavailable" : "integrity_mismatch",
          details: {
            operation: "inspect_native_dispatch_metadata",
            path,
            boundary: denied ? "filesystem-read" : "stable-artifact-read",
          },
        });
        if (replacement === "unreadable")
          expect(error.details?.system_code).toBe("EACCES");
        else {
          const code = {
            missing: "ENOENT",
            directory: "EISDIR",
            loop: "ELOOP",
          }[replacement];
          expect(error.details?.reason).toContain(code);
        }
        expect(error.remediation.action).not.toContain("rea doctor");
      } finally {
        if (replacement === "unreadable") await chmod(path, 0o600);
      }
      await rm(path, { recursive: true, force: true });
      await writeFile(path, bytes);
      expect(await successfulRead()).toEqual(control);
    }
    const closed = await client.callTool({
      name: "close_binary",
      arguments: {},
    });
    expect(closed.isError).not.toBe(true);
    expect(stderr).toBe("");
  } finally {
    await client.close();
    await transport.close();
  }
};

describe.skipIf(process.platform !== "darwin")(
  "bound dispatch target read refusals",
  () => {
    it("reports missing, directory and symlink-loop replacements as artifact changes and recovers in the same session", async () => {
      await inspectReplacements(["missing", "directory", "loop"]);
    }, 30_000);

    it.skipIf(process.getuid?.() === 0)(
      "keeps permission denial distinct and recovers after restoring read access",
      async () => {
        await inspectReplacements(["unreadable"]);
      },
      30_000,
    );
  },
);
