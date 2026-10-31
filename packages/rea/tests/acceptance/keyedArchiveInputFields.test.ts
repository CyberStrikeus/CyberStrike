import { mkdir, writeFile } from "node:fs/promises";

import { build } from "plist";
import { expect } from "vitest";

import { workspaceCliTest } from "../support/cli/workspaceCliFixture.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";

const archive = build({
  $archiver: "NSKeyedArchiver",
  $version: 100000,
  $objects: ["$null", "leaf"],
  $top: { root: { CF$UID: 1 } },
});

workspaceCliTest(
  "names the archive argument when a bundle member is absent or noncanonical",
  async ({ cli, workspace }) => {
    const bundle = workspace.path("Static.app");
    await mkdir(bundle);
    await writeFile(
      workspace.path("Static.app/Info.plist"),
      build({ CFBundleIdentifier: "org.example.staticarchive" }),
    );
    await writeFile(workspace.path("Static.app/sample.plist"), archive);
    for (const [selection, reason] of [
      ["absent.plist", "invalid_value"],
      ["../sample.plist", "invalid_format"],
    ] as const) {
      const result = await cli.run({
        arguments: ["inspect-keyed-archive", bundle, selection, "--json"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        recovery: {
          kind: "inspect_input_contract",
          operation: "inspect_keyed_archive",
        },
        details: {
          operation: "inspect_keyed_archive",
          issues: [{ path: ["archive"], reason }],
        },
      });
    }
  },
);

workspaceCliTest(
  "retains the canonical selector field and recovery through public MCP",
  async ({ cli, workspace }) => {
    const path = workspace.path("sample.plist");
    await writeFile(path, archive);
    const call = await cli.sharedMcpCall!();
    const opened = await call("open_binary", { path });
    expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
    const rejected = await call("inspect_keyed_archive", {
      path: "absent.plist",
    });
    expect(rejected.isError).toBe(true);
    expect(parseMcpToolError(rejected).error).toMatchObject({
      code: "invalid_request",
      recovery: {
        kind: "inspect_input_contract",
        operation: "inspect_keyed_archive",
      },
      details: { issues: [{ path: ["path"], reason: "invalid_value" }] },
    });
    const valid = await call("inspect_keyed_archive", {});
    expect(valid.isError, JSON.stringify(valid.content)).not.toBe(true);
    expect(valid.structuredContent).toMatchObject({
      normalized_result: { total_objects: 2 },
    });
  },
);
