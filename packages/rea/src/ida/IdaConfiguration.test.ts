import { appendFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdaTarget } from "../../tests/fixtures/idaMcp.js";
import { readIdaConfiguration } from "./IdaConfiguration.js";
import { decodeIdaToolResult } from "./IdaMcpConnection.js";
import type { RetainedResourceScope } from "../application/AnalysisProvider.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import * as regularFile from "../filesystem/RegularFile.js";

const resourceScope: RetainedResourceScope = {
  retain: () => undefined,
  run: (operation) => operation(),
};
const read = (path: string) => readIdaConfiguration(path, { resourceScope });

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("IDA registration and MCP result boundaries", () => {
  it("reuses a direct or upstream mcpServers registration with no installation", async () => {
    const { root } = await createIdaTarget();
    roots.push(root);
    const path = join(root, "mcp.json");
    for (const input of [
      { command: "python", args: ["server.py"] },
      {
        mcpServers: {
          "ida-pro-mcp": { command: "python", args: ["server.py"] },
          unrelated: { command: "untouched" },
        },
      },
    ]) {
      await writeFile(path, JSON.stringify(input));
      expect(await read(path)).toMatchObject({
        ok: true,
        value: { command: "python", args: ["server.py"], mode: "attached" },
      });
    }
  });
  it("validates local transport and lifecycle inputs without leaking auth into a profile", async () => {
    const { root } = await createIdaTarget();
    roots.push(root);
    const path = join(root, "mcp.json");
    for (const input of [
      { url: "https://example.com/mcp" },
      { url: "http://token@127.0.0.1/mcp" },
      { command: "python", mode: "force_gui" },
      { command: "python", workspaceRoot: "relative" },
      { command: "python", args: "server.py" },
    ]) {
      await writeFile(path, JSON.stringify(input));
      expect((await read(path)).ok).toBe(false);
    }
    await writeFile(
      path,
      JSON.stringify({
        url: "http://127.0.0.1:8745/mcp",
        mode: "headless",
        headers: { Authorization: "Bearer fixture-secret" },
      }),
    );
    expect((await read(path)).ok).toBe(true);
    await writeFile(path, "malformed");
    expect((await read(path)).ok).toBe(false);
    expect((await read(join(root, "absent"))).ok).toBe(false);
    const registration = JSON.stringify({ command: "python" });
    await writeFile(path, registration.padEnd(65_536));
    expect((await read(path)).ok).toBe(true);
    await writeFile(path, registration.padEnd(65_537));
    expect(await read(path)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("64 KiB") },
    });
  });
});

it("rejects registration growth beyond the byte limit after descriptor admission", async () => {
  const { root } = await createIdaTarget();
  roots.push(root);
  const path = join(root, "mcp.json");
  await writeFile(path, JSON.stringify({ command: "python" }));
  const openRegularFile = regularFile.openRegularFile;
  const admission = vi
    .spyOn(regularFile, "openRegularFile")
    .mockImplementation(async (...args) => {
      const source = await openRegularFile(...args);
      await appendFile(path, " ".repeat(65_536));
      return source;
    });
  try {
    expect(await read(path)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("64 KiB") },
    });
  } finally {
    admission.mockRestore();
  }
});

describe("IDA registration descriptor ownership", () => {
  it("retains the exact descriptor after close denial and resolves its error only after retry", async () => {
    const { root } = await createIdaTarget();
    roots.push(root);
    const path = join(root, "mcp.json");
    await writeFile(path, JSON.stringify({ command: "python" }));
    const retained: { close(): Promise<void> }[] = [];
    const owner: RetainedResourceScope = {
      retain: (resource) => retained.push(resource),
      run: (operation) => operation(),
    };
    const close = OwnedFileHandle.prototype.close;
    let denied = false;
    const denial = new Error("descriptor close denied");
    vi.spyOn(OwnedFileHandle.prototype, "close").mockImplementation(function (
      this: OwnedFileHandle,
    ) {
      if (!denied) {
        denied = true;
        return Promise.reject(denial);
      }
      return close.call(this);
    });
    const result = await readIdaConfiguration(path, {
      resourceScope: owner,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected close failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(retained).toHaveLength(1);
    await rm(path);
    await retained[0]!.close();
    expect(result.error.cleanupIncomplete).toBe(false);
  });
  it("preserves the caller's exact cancellation reason", async () => {
    const { root } = await createIdaTarget();
    roots.push(root);
    const path = join(root, "mcp.json");
    await writeFile(path, JSON.stringify({ command: "python" }));
    const reason = new Error("stop registration inspection");
    const controller = new AbortController();
    controller.abort(reason);
    await expect(
      readIdaConfiguration(path, {
        resourceScope,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ _tag: "AnalysisCancelledError", cause: reason });
  });
  it("preserves post-open cancellation when the descriptor's final close is denied", async () => {
    const { root } = await createIdaTarget();
    roots.push(root);
    const path = join(root, "mcp.json");
    await writeFile(path, JSON.stringify({ command: "python" }));
    const retained: { close(): Promise<void> }[] = [];
    const owner: RetainedResourceScope = {
      retain: (resource) => retained.push(resource),
      run: (operation) => operation(),
    };
    const reason = new Error("cancel at the post-open checkpoint");
    let checkpoints = 0;
    const signal = {
      get aborted() {
        checkpoints += 1;
        return checkpoints === 4;
      },
      reason,
    } as AbortSignal;
    const denial = new Error(
      "descriptor close denied after post-open cancellation",
    );
    vi.spyOn(OwnedFileHandle.prototype, "close").mockRejectedValue(denial);
    const cancellation = await readIdaConfiguration(path, {
      resourceScope: owner,
      signal,
    }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(checkpoints).toBe(4);
    expect(cancellation).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: reason,
      cleanupIncomplete: true,
    });
    expect(retained).toHaveLength(1);
    vi.restoreAllMocks();
    await retained[0]!.close();
    expect(cancellation).toMatchObject({ cleanupIncomplete: false });
  });
  it("retains completed-read facts and cancellation through a denied final close", async () => {
    const { root } = await createIdaTarget();
    roots.push(root);
    const path = join(root, "mcp.json");
    await writeFile(path, JSON.stringify({ command: "python" }));
    const retained: { close(): Promise<void> }[] = [];
    const owner: RetainedResourceScope = {
      retain: (resource) => retained.push(resource),
      run: (operation) => operation(),
    };
    const close = OwnedFileHandle.prototype.close;
    const reason = new Error("cancel while closing IDA registration");
    const controller = new AbortController();
    let entered!: () => void;
    let release!: () => void;
    const closeEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const closeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const denial = new Error("descriptor close denied after cancellation");
    vi.spyOn(OwnedFileHandle.prototype, "close").mockImplementation(
      async function (this: OwnedFileHandle) {
        entered();
        await closeGate;
        throw denial;
      },
    );
    const pending = readIdaConfiguration(path, {
      resourceScope: owner,
      signal: controller.signal,
    });
    await closeEntered;
    controller.abort(reason);
    release();
    const cancellation = await pending.then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(cancellation).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: reason,
      cleanupIncomplete: true,
    });
    expect(retained).toHaveLength(1);
    vi.restoreAllMocks();
    await retained[0]!.close();
    expect(cancellation).toMatchObject({ cleanupIncomplete: false });
  });
});

describe("IDA MCP result decoding", () => {
  it("parses FastMCP wrappers, structured dictionaries, text, arrays, and explicit errors", () => {
    expect(
      decodeIdaToolResult({
        content: [],
        structuredContent: { result: [{ address: "0x1" }] },
      }),
    ).toEqual([{ address: "0x1" }]);
    expect(
      decodeIdaToolResult({
        content: [],
        structuredContent: { address: "0x1", name: "f" },
      }),
    ).toEqual({ address: "0x1", name: "f" });
    expect(
      decodeIdaToolResult({ content: [{ type: "text", text: "int f() {}" }] }),
    ).toBe("int f() {}");
    expect(
      decodeIdaToolResult({ content: [{ type: "text", text: '{"data":[]}' }] }),
    ).toEqual({ data: [] });
    expect(() =>
      decodeIdaToolResult({
        content: [{ type: "text", text: "No function at 0x1" }],
        isError: true,
      }),
    ).toThrow("No function at 0x1");
    expect(() => decodeIdaToolResult({ content: "invalid" })).toThrow();
  });
});

it.each(["env", "headers"] as const)(
  "preserves all explicit IDA %s keys",
  async (field) => {
    const { root } = await createIdaTarget();
    roots.push(root);
    const path = join(root, "mcp.json");
    const mapping = JSON.parse(
      '{"__proto__":"operator","constructor":"selected","normal":"value"}',
    );
    const transport =
      field === "env"
        ? { command: "python" }
        : { url: "http://127.0.0.1:8745/mcp" };
    await writeFile(path, JSON.stringify({ ...transport, [field]: mapping }));
    const result = await read(path);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const parsed =
      field === "env" && "env" in result.value
        ? result.value.env
        : "headers" in result.value
          ? result.value.headers
          : undefined;
    expect(parsed).toEqual(mapping);
    expect(Object.hasOwn(parsed ?? {}, "__proto__")).toBe(true);
  },
);

it.each(["env", "headers"] as const)(
  "rejects malformed explicit IDA %s values at __proto__",
  async (field) => {
    const { root } = await createIdaTarget();
    roots.push(root);
    const path = join(root, "mcp.json");
    const transport =
      field === "env"
        ? { command: "python" }
        : { url: "http://127.0.0.1:8745/mcp" };
    for (const value of [42, null, {}]) {
      await writeFile(
        path,
        JSON.stringify({
          ...transport,
          [field]: Object.fromEntries([["__proto__", value]]),
        }),
      );
      expect((await read(path)).ok).toBe(false);
    }
  },
);
