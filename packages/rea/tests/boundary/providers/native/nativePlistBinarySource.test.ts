import { open, truncate, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, onTestFinished, vi } from "vitest";

import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../../../../src/domain/analysisErrorCore.js";
import { ArtifactFileCleanupFailure } from "../../../../src/artifacts/ArtifactFileOperation.js";
import { scanBinaryPlistScalars } from "../../../../src/artifacts/apple/PlistScalars.js";
import { ProviderAdapterError } from "../../../../src/domain/providerAdapterError.js";
import { buildBinary, type PlistValue } from "plist";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import { MAX_NATIVE_PLIST_BYTES } from "../../../../src/native/parsers/plist.js";
import { MAX_JSON_DEPTH } from "../../../../src/domain/jsonValue.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
} from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

class BinaryNativeRunner extends NativeFixtureRunner {
  readonly tools: string[] = [];

  override async run(tool: string, arguments_: readonly string[]) {
    this.tools.push(tool);
    return super.run(tool, arguments_);
  }
}

const binaryPath = async () => {
  const root = await createTestTempDirectory("rea-native-binary-plist-");
  const path = join(root, "selected.plist");
  await writeFile(path, Buffer.from("bplist00"));
  return { root, path };
};

const binaryClient = (root: string, runner: BinaryNativeRunner) => {
  const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
    nativeMachoTarget(join(root, "target")),
  );
  onTestFinished(async () => {
    await client.close();
  });
  return client;
};

it("reports a binary source-size refusal as a typed resource limit", async () => {
  const { root, path } = await binaryPath();
  await truncate(path, MAX_NATIVE_PLIST_BYTES + 1);
  const runner = new BinaryNativeRunner({
    file: "Apple binary property list\n",
  });
  const client = binaryClient(root, runner);

  const result = await client.execute("inspect_plist", { path });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected file-size refusal");
  expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
  expect(result.error).toMatchObject({
    resource: "file-size",
    reportedLimits: { maximum_input_bytes: MAX_NATIVE_PLIST_BYTES },
    retryable: false,
    fixedAllowance: { kind: "input" },
  });
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({
    code: "resource_constraint",
    retryable: false,
    remediation: {
      action: expect.stringContaining(
        "native plist input allowance (no runtime override)",
      ),
    },
  });
  expect(projected.remediation.action).not.toMatch(/worker file-size limits/u);
  expect(runner.tools).toEqual(["file"]);
});

const nested = (depth: number): PlistValue =>
  depth === 0 ? 1 : [nested(depth - 1)];

it.each([
  {
    budget: "decode",
    // Three times the source length exceeds the 64 MiB decode estimate while
    // the source stays below the separate 64 MiB input ceiling.
    value: { data: Buffer.alloc(22 * 1024 * 1024, 0x78) },
    reason: "binary plist object table exceeds the native plist decode budget",
    limits: { maximum_decoded_bytes: 64 * 1024 * 1024 },
    allowance:
      "The 64 MiB (67108864-byte) native binary plist decode allowance (no runtime override)",
  },
  {
    budget: "nesting",
    value: nested(MAX_JSON_DEPTH - 1),
    reason: "binary plist nesting exceeds the native plist decode budget",
    limits: { maximum_nesting_depth: MAX_JSON_DEPTH - 2 },
    allowance:
      "The 998-level native plist nesting allowance (no runtime override)",
  },
])(
  "names the fixed binary plist $budget allowance instead of host memory",
  async ({ value, reason, limits, allowance }) => {
    const { root, path } = await binaryPath();
    await writeFile(path, buildBinary(value));
    const runner = new BinaryNativeRunner({
      file: "Apple binary property list\n",
    });
    const client = binaryClient(root, runner);

    const result = await client.execute("inspect_plist", { path });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected decode allowance refusal");
    expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
    expect(result.error).toMatchObject({
      resource: "memory",
      reason,
      reportedLimits: limits,
      retryable: false,
      fixedAllowance: { name: allowance, kind: "parser" },
    });
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "resource_constraint",
      retryable: false,
      details: { resource: "memory", reported_limits: limits },
    });
    expect(projected.remediation.action).toBe(
      `${allowance} is a fixed allowance. Worker memory limits, inherited limits, and additional host memory do not raise it. Select another complete input within the allowance when that preserves the needed observation. Repeating the unchanged request fails the same way.`,
    );
    expect(runner.tools).toEqual(["file"]);
  },
);

it("keeps a malformed binary plist as a selected-input failure", async () => {
  const { root, path } = await binaryPath();
  await writeFile(path, Buffer.from("bplist00bad"));
  const runner = new BinaryNativeRunner({
    file: "Apple binary property list\n",
  });
  const client = binaryClient(root, runner);

  const result = await client.execute("inspect_plist", { path });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected malformed input failure");
  expect(result.error).toBeInstanceOf(AnalysisInputError);
  expect(runner.tools).toEqual(["file"]);
});

it("rejects a reachable binary date with an invalid marker before projection", async () => {
  const { root, path } = await binaryPath();
  const bytes = Buffer.from(
    buildBinary({ date: new Date("2001-01-01T00:00:00.100Z") }),
  );
  const date = scanBinaryPlistScalars(bytes).dates[0];
  if (date === undefined) throw new Error("binary plist fixture lost its date");
  bytes[date.offset] = 0x30;
  await writeFile(path, bytes);
  const runner = new BinaryNativeRunner({
    file: "Apple binary property list\n",
  });
  const client = binaryClient(root, runner);

  const result = await client.execute("inspect_plist", { path });

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected malformed date input failure");
  expect(result.error).toBeInstanceOf(AnalysisInputError);
  expect(result.error).toMatchObject({
    issues: [
      {
        path: ["path"],
        reason: "invalid_value",
      },
    ],
  });
  expect(runner.tools).toEqual(["file"]);
});

it("preserves the exact caller cancellation reason during a binary read", async () => {
  const { root, path } = await binaryPath();
  const probe = await open(path, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const originalRead = prototype.read;
  const reason = { caller: "binary-plist-read" };
  const controller = new AbortController();
  const read = vi
    .spyOn(prototype, "read")
    .mockImplementationOnce(async function (
      this: FileHandle,
      ...args: Parameters<FileHandle["read"]>
    ) {
      const result = await Reflect.apply(originalRead, this, args);
      controller.abort(reason);
      return result;
    });
  onTestFinished(() => read.mockRestore());
  const client = binaryClient(
    root,
    new BinaryNativeRunner({ file: "Apple binary property list\n" }),
  );

  const result = await client.execute(
    "inspect_plist",
    { path },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected cancellation");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
});

it("preserves a physical EIO when a pending binary read is then aborted", async () => {
  const { root, path } = await binaryPath();
  const probe = await open(path, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const reason = { caller: "abort-then-eio" };
  const primary = Object.assign(new Error("controlled binary read EIO"), {
    code: "EIO",
  });
  const controller = new AbortController();
  const read = vi
    .spyOn(prototype, "read")
    .mockImplementationOnce(async function (this: FileHandle) {
      controller.abort(reason);
      throw primary;
    });
  onTestFinished(() => read.mockRestore());
  const client = binaryClient(
    root,
    new BinaryNativeRunner({ file: "Apple binary property list\n" }),
  );

  const result = await client.execute(
    "inspect_plist",
    { path },
    { signal: controller.signal },
  );

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected physical read failure");
  expect(result.error).toBeInstanceOf(ProviderAdapterError);
  expect(result.error.cause).toBe(primary);
});

it("retains the exact binary descriptor owner when reading and closing fail", async () => {
  const { root, path } = await binaryPath();
  const probe = await open(path, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const primary = Object.assign(new Error("controlled binary read failure"), {
    code: "EIO",
  });
  const cleanup = new Error("controlled binary descriptor close failure");
  let attempts = 0;
  let release: (() => Promise<void>) | undefined;
  const read = vi
    .spyOn(prototype, "read")
    .mockImplementationOnce(async function (this: FileHandle) {
      release = this.close.bind(this);
      this.close = async () => {
        attempts += 1;
        if (attempts < 3) throw cleanup;
        await release!();
      };
      throw primary;
    });
  onTestFinished(async () => {
    read.mockRestore();
    await release?.();
  });
  const client = binaryClient(
    root,
    new BinaryNativeRunner({ file: "Apple binary property list\n" }),
  );

  const result = await client.execute("inspect_plist", { path });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected failed read and close");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toContain(path);
  expect(result.error.cause).toBeInstanceOf(ArtifactFileCleanupFailure);
  const failure = result.error.cause as ArtifactFileCleanupFailure;
  expect(failure.fileCleanupFailure.outcome).toEqual({
    kind: "failed",
    cause: primary,
  });
  expect(failure.fileCleanupFailure.cleanupCause).toBe(cleanup);

  expect((await client.close()).ok).toBe(false);
  expect(attempts).toBe(2);
  expect((await client.close()).ok).toBe(true);
  expect(attempts).toBe(3);
  expect(result.error.cleanupIncomplete).toBe(false);
});
