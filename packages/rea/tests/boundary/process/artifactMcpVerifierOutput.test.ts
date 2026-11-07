import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const exec = promisify(execFile);
const observationSchema = z.strictObject({
  accepted: z.boolean(),
  catalogRequests: z.number().int().nonnegative(),
  corruptedReplies: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  toolTimeouts: z.array(z.number().nullable()),
  error: z
    .strictObject({
      name: z.string(),
      message: z.string(),
      code: z.union([z.number(), z.string()]).nullable(),
    })
    .nullable(),
});

async function probe(mode: string, name = "Fixture.app") {
  const root = await createTestTempDirectory("rea-artifact-mcp-schema-");
  const target = join(root, name);
  await mkdir(join(target, "Contents", "Resources"), { recursive: true });
  await writeFile(
    join(target, "Contents", "Info.plist"),
    '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.rea.schema-probe</string></dict></plist>',
  );
  const { stdout } = await exec(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../fixtures/artifactMcpVerifierProbe.mjs", import.meta.url),
      ),
      mode,
      target,
    ],
    // Retain cleanup time within the existing 30s test budget.
    { timeout: 25_000 },
  );
  return observationSchema.parse(JSON.parse(stdout));
}

it("validates the real resource admission reply against its advertised schema", async () => {
  expect(await probe("healthy", "Fixture.app")).toEqual({
    accepted: true,
    catalogRequests: 1,
    corruptedReplies: 0,
    toolCalls: 1,
    toolTimeouts: [null],
    error: null,
  });
});

it.each(["Fixture.app", "Fixture with spaces 雨.app"])(
  "rejects a corrupted canonical path in a real admission reply: %s",
  async (name) => {
    const result = await probe("corrupt", name);
    expect(result.accepted).toBe(false);
    expect(result.catalogRequests).toBe(1);
    expect(result.corruptedReplies).toBe(1);
    expect(result.error).toMatchObject({
      name: "ProtocolError",
      code: -32602,
      message: expect.stringMatching(/output schema.*canonical_path/u),
    });
  },
);

it.each(["reuse", "concurrent"])(
  "shares one schema discovery within one MCP connection: %s",
  async (mode) => {
    const result = await probe(mode);
    expect(result.accepted).toBe(true);
    expect(result.catalogRequests).toBe(1);
    expect(result.toolCalls).toBe(mode === "reuse" ? 3 : 2);
  },
);

it("binds the new advertised schema after reconnecting the same client", async () => {
  const result = await probe("reconnect");
  expect(result.accepted).toBe(false);
  expect(result.catalogRequests).toBe(2);
  expect(result.toolCalls).toBe(2);
  expect(result.error).toMatchObject({
    code: -32602,
    message: expect.stringContaining("__rea_second_connection"),
  });
});

it("rejects an omitted output schema before calling the advertised tool", async () => {
  const result = await probe("missing-schema");
  expect(result.accepted).toBe(false);
  expect(result.toolCalls).toBe(0);
  expect(result.error?.message).toMatch(/omitted its output schema/u);
});

it("rejects a supplied schema override before dispatching that call", async () => {
  const result = await probe("override");
  expect(result.accepted).toBe(false);
  expect(result.toolCalls).toBe(1);
  expect(result.error?.message).toMatch(/owns the advertised schema/u);
});

it("preserves explicit request timeouts on schema-bound calls", async () => {
  const result = await probe("request-options");
  expect(result.accepted).toBe(true);
  expect(result.catalogRequests).toBe(1);
  expect(result.toolTimeouts).toEqual([null, 12_345]);
});

it.each(["duplicate-first", "duplicate-last"])(
  "rejects ambiguous named schemas independently of catalog order: %s",
  async (mode) => {
    const result = await probe(mode);
    expect(result.accepted).toBe(false);
    expect(result.toolCalls).toBe(0);
    expect(result.error?.message).toMatch(/Duplicate MCP tool/u);
  },
);
