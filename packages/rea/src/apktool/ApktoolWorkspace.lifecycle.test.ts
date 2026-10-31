import { countDecodedFiles } from "./ApktoolDecodedInventory.js";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import {
  artifactFilePrimaryFacts,
  ArtifactFileCleanupFailure,
  ArtifactFileCancelled,
} from "../artifacts/ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import { ApktoolCommandCleanup } from "./ApktoolCommandCleanup.js";
import { ApktoolWorkspace } from "./ApktoolWorkspace.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: vi.fn(actual.open),
    opendir: vi.fn(actual.opendir),
  };
});
const actual =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
afterEach(() => {
  vi.mocked(fs.open).mockImplementation(actual.open);
  vi.mocked(fs.opendir).mockImplementation(actual.opendir);
});

it.each(["source", "snapshot", "output"] as const)(
  "retains the exact %s descriptor after a denied close and fences root removal",
  async (kind) => {
    const root = await PrivateRuntimeRoot.create({
      prefix: "rea-apktool-owned-test-",
    });
    const commands = new ApktoolCommandCleanup();
    const workspace = new ApktoolWorkspace(root, commands);
    const input = join(root.path, "source.apk");
    const output = join(root.path, "output.xml");
    await fs.writeFile(input, "small-authored-apk");
    await fs.writeFile(output, "<resources/>");
    const selected =
      kind === "source"
        ? input
        : kind === "snapshot"
          ? join(root.path, "input.apk")
          : output;
    let denied = true;
    const closes = vi.fn();
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      const handle = await actual.open(path, flags, mode);
      if (String(path) === selected) {
        const close = handle.close.bind(handle);
        handle.close = async () => {
          closes();
          if (denied) throw new Error("authored close denial");
          await close();
        };
      }
      return handle;
    });
    try {
      const failure = await (
        kind === "output"
          ? workspace.readText(output, 100)
          : workspace.snapshotInput(input, "decode_android_resources")
      ).catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(ArtifactFileCleanupFailure);
      if (!(failure instanceof ArtifactFileCleanupFailure))
        throw new Error("Expected owned descriptor failure");
      expect(failure.cleanupLease.released).toBe(false);
      await expect(workspace.close()).rejects.toBeInstanceOf(
        ArtifactReaderFailure,
      );
      await expect(fs.stat(root.path)).resolves.toBeDefined();
      denied = false;
      await workspace.close();
      expect(failure.cleanupLease.released).toBe(true);
      const count = closes.mock.calls.length;
      await workspace.close();
      expect(closes).toHaveBeenCalledTimes(count);
      await expect(fs.stat(root.path)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      denied = false;
      await workspace.close();
      await commands.close();
    }
  },
);

it("retains a physical decode-output failure when cancellation arrives during descriptor close", async () => {
  const root = await PrivateRuntimeRoot.create({
    prefix: "rea-apktool-owned-test-",
  });
  const commands = new ApktoolCommandCleanup();
  const workspace = new ApktoolWorkspace(root, commands);
  const output = join(root.path, "invalid.xml");
  const controller = new AbortController();
  await fs.writeFile(output, Buffer.from([0xff]));
  vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
    const handle = await actual.open(path, flags, mode);
    const close = handle.close.bind(handle);
    handle.close = async () => {
      controller.abort({ caller: "after malformed bytes" });
      await close();
    };
    return handle;
  });
  try {
    await expect(
      workspace.readText(output, 100, controller.signal),
    ).rejects.toMatchObject({ _tag: "AnalysisProtocolError" });
  } finally {
    await workspace.close();
    await commands.close();
  }
});

it("records cancellation observed during a successful output descriptor close", async () => {
  const root = await PrivateRuntimeRoot.create({
    prefix: "rea-apktool-owned-test-",
  });
  const commands = new ApktoolCommandCleanup();
  const workspace = new ApktoolWorkspace(root, commands);
  const output = join(root.path, "output.xml");
  const controller = new AbortController();
  const reason = { caller: "during descriptor close" };
  await fs.writeFile(output, "<resources/>");
  vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
    const handle = await actual.open(path, flags, mode);
    const close = handle.close.bind(handle);
    handle.close = async () => {
      controller.abort(reason);
      await close();
    };
    return handle;
  });
  try {
    const failure = await workspace
      .readText(output, 100, controller.signal)
      .catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ArtifactFileCancelled);
    if (!(failure instanceof ArtifactFileCancelled))
      throw new Error("Expected close cancellation");
    expect(failure.fileCancellation.reason).toBe(reason);
    expect(failure.fileCancellation.outcome).toEqual({
      kind: "completed",
      value: { text: "<resources/>", truncated: false, sourceBytes: 12 },
    });
  } finally {
    await workspace.close();
    await commands.close();
  }
});

it.skipIf(process.platform === "win32")(
  "rejects a decoded FIFO without waiting for a writer",
  async () => {
    const root = await PrivateRuntimeRoot.create({
      prefix: "rea-apktool-owned-test-",
    });
    const commands = new ApktoolCommandCleanup();
    const workspace = new ApktoolWorkspace(root, commands);
    const fifo = join(root.path, "strings.xml");
    try {
      await promisify(execFile)("mkfifo", [fifo]);
      await expect(workspace.readText(fifo, 100)).rejects.toMatchObject({
        code: "ENOTFILE",
      });
    } finally {
      await workspace.close();
      await commands.close();
    }
  },
);

it.each([false, true])(
  "keeps malformed UTF-8 primary when final stat observes cancellation (close denied=%s)",
  async (deniedInitially) => {
    const root = await PrivateRuntimeRoot.create({
      prefix: "rea-apktool-owned-test-",
    });
    const commands = new ApktoolCommandCleanup();
    const workspace = new ApktoolWorkspace(root, commands);
    const path = join(root.path, "malformed.xml");
    const controller = new AbortController();
    let denied = deniedInitially;
    await fs.writeFile(path, Buffer.from([0xff]));
    vi.mocked(fs.open).mockImplementation(async (name, flags, mode) => {
      const handle = await actual.open(name, flags, mode);
      const read = handle.read.bind(handle);
      let readComplete = false;
      handle.read = (async (...args: Parameters<typeof handle.read>) => {
        const value = await read(...args);
        if (value.bytesRead === 0) readComplete = true;
        return value;
      }) as typeof handle.read;
      const stat = handle.stat.bind(handle);
      handle.stat = ((...args: Parameters<typeof handle.stat>) =>
        stat(...args).then((value) => {
          if (readComplete)
            controller.abort({ caller: "after bytes before interpretation" });
          return value;
        })) as typeof handle.stat;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        if (denied) throw new Error("authored denial");
        await close();
      };
      return handle;
    });
    try {
      const failure = await workspace
        .readText(path, 100, controller.signal)
        .catch((cause: unknown) => cause);
      expect(controller.signal.aborted).toBe(true);
      expect(artifactFilePrimaryFacts(failure).cause).toMatchObject({
        _tag: "AnalysisProtocolError",
      });
      expect(artifactFilePrimaryFacts(failure).origin).toBe(
        "owned-or-classified",
      );
      if (denied)
        await expect(workspace.close()).rejects.toBeInstanceOf(
          ArtifactReaderFailure,
        );
      denied = false;
      await workspace.close();
    } finally {
      denied = false;
      await workspace.close();
      await commands.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "counts omitted special entries toward the decoded inventory budget",
  async () => {
    const root = await PrivateRuntimeRoot.create({
      prefix: "rea-apktool-owned-test-",
    });
    const commands = new ApktoolCommandCleanup();
    const workspace = new ApktoolWorkspace(root, commands);
    try {
      await fs.writeFile(join(root.path, "one.xml"), "one");
      await fs.writeFile(join(root.path, "two.xml"), "two");
      for (let index = 0; index < 4; index++)
        await promisify(execFile)("mkfifo", [
          join(root.path, `special-${index}`),
        ]);
      const result = await countDecodedFiles(
        workspace,
        root.path,
        undefined,
        3,
      );
      if (!result.ok) throw result.error.cause;
      expect(result.value.capped).toBe(true);
      expect(result.value.count).toBeLessThanOrEqual(2);
      const complete = await countDecodedFiles(
        workspace,
        root.path,
        undefined,
        6,
      );
      if (!complete.ok) throw complete.error.cause;
      expect(complete.value).toEqual({
        count: 2,
        capped: false,
        locales: [],
        otherStringsTables: [],
        unreadableStringsTables: [],
      });
    } finally {
      await workspace.close();
      await commands.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "inventories only observed regular tables and discloses non-regular and unknown entries",
  async () => {
    const root = await PrivateRuntimeRoot.create({
      prefix: "rea-apktool-tables-test-",
    });
    const commands = new ApktoolCommandCleanup();
    const workspace = new ApktoolWorkspace(root, commands);
    const regular = ["de", "en-rUS-v21", "mcc310-fr", "night", "pt-BR", ""];
    const nonRegular = ["fr", "it", "es"];
    try {
      for (const suffix of [...regular, ...nonRegular, "ja"])
        await fs.mkdir(join(root.path, "res", `values-${suffix}`), {
          recursive: true,
        });
      for (const suffix of regular)
        await fs.writeFile(
          join(root.path, "res", `values-${suffix}`, "strings.xml"),
          "<resources/>",
        );
      await fs.symlink(
        join(root.path, "res/values-de/strings.xml"),
        join(root.path, "res/values-fr/strings.xml"),
      );
      await promisify(execFile)("mkfifo", [
        join(root.path, "res/values-it/strings.xml"),
      ]);
      await fs.mkdir(join(root.path, "res/values-es/strings.xml"));
      const result = await countDecodedFiles(
        workspace,
        root.path,
        undefined,
        100,
      );
      if (!result.ok) throw result.error.cause;
      expect(result.value).toEqual({
        count: regular.length,
        capped: false,
        locales: ["de"],
        otherStringsTables: [
          "values-",
          "values-en-rUS-v21",
          "values-mcc310-fr",
          "values-night",
          "values-pt-BR",
        ],
        unreadableStringsTables: [
          { path: "res/values-es/strings.xml", kind: "directory" },
          { path: "res/values-fr/strings.xml", kind: "symlink" },
          { path: "res/values-it/strings.xml", kind: "fifo" },
        ],
      });
    } finally {
      await workspace.close();
      await commands.close();
    }
  },
);

it("preserves a directory inspection failure instead of treating its locale table as absent", async () => {
  const root = await PrivateRuntimeRoot.create({
    prefix: "rea-apktool-tables-test-",
  });
  const commands = new ApktoolCommandCleanup();
  const workspace = new ApktoolWorkspace(root, commands);
  const blocked = join(root.path, "res/values-fr");
  try {
    await fs.mkdir(blocked, { recursive: true });
    await fs.writeFile(join(root.path, "known.txt"), "completed");
    await fs.writeFile(join(blocked, "strings.xml"), "<resources/>");
    vi.mocked(fs.opendir).mockImplementation(async (path, options) => {
      if (String(path) === blocked)
        throw Object.assign(new Error("authored directory inspection denial"), {
          code: "EACCES",
        });
      return actual.opendir(path, options);
    });
    await expect(
      countDecodedFiles(workspace, root.path, undefined, 100),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        partial: { count: 1 },
        cause: {
          reason: "io",
          message: expect.stringContaining(
            "authored directory inspection denial",
          ),
        },
      },
    });
  } finally {
    await workspace.close();
    await commands.close();
  }
});

it("reports raw retained-prefix bytes when UTF-8 decoding removes a BOM", async () => {
  const root = await PrivateRuntimeRoot.create({
    prefix: "rea-apktool-source-bytes-",
  });
  const commands = new ApktoolCommandCleanup();
  const workspace = new ApktoolWorkspace(root, commands);
  const output = join(root.path, "strings.xml");
  const bytes = Buffer.from("\uFEFF<resources/>", "utf8");
  try {
    await fs.writeFile(output, bytes);
    await expect(workspace.readText(output, 100)).resolves.toEqual({
      text: "<resources/>",
      truncated: false,
      sourceBytes: bytes.length,
    });
    await expect(workspace.readText(output, 5)).resolves.toEqual({
      text: "<r",
      truncated: true,
      sourceBytes: 5,
    });
    await expect(
      workspace.readText(join(root.path, "missing.xml"), 100),
    ).resolves.toEqual({ text: null, truncated: false, sourceBytes: 0 });
  } finally {
    await workspace.close();
    await commands.close();
  }
});

it("classifies source state changes during snapshot copying as artifact changes", async () => {
  const root = await PrivateRuntimeRoot.create({
    prefix: "rea-apktool-changed-test-",
  });
  const commands = new ApktoolCommandCleanup();
  const workspace = new ApktoolWorkspace(root, commands);
  const input = join(root.path, "source.apk");
  await fs.writeFile(input, "authored-apk");
  let sourceReads = 0;
  vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
    const handle = await actual.open(path, flags, mode);
    if (String(path) === input) {
      const stat = handle.stat.bind(handle);
      const read = handle.read.bind(handle);
      handle.read = (async (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => {
        const result = await read(buffer, offset, length, position);
        if (result.bytesRead > 0) sourceReads += 1;
        return result;
      }) as typeof handle.read;
      handle.stat = (async (...args: Parameters<typeof stat>) => {
        const value = await stat(...args);
        if (sourceReads > 0) {
          if ("mtimeNs" in value) value.mtimeNs += 1n;
          else value.mtimeMs += 1;
        }
        return value;
      }) as typeof handle.stat;
    }
    return handle;
  });
  try {
    await expect(
      workspace.snapshotInput(input, "decode_android_resources"),
    ).rejects.toMatchObject({
      _tag: "AnalysisArtifactChangedError",
      operation: "decode_android_resources",
      path: input,
    });
    expect(sourceReads).toBeGreaterThan(0);
  } finally {
    await workspace.close();
    await commands.close();
  }
});

it.each(["EACCES", "EPERM", "EIO", "ENOENT"] as const)(
  "preserves the %s acquisition failure classification before snapshot admission",
  async (code) => {
    const root = await PrivateRuntimeRoot.create({
      prefix: "rea-apktool-admission-test-",
    });
    const commands = new ApktoolCommandCleanup();
    const workspace = new ApktoolWorkspace(root, commands);
    const input = join(root.path, "source.apk");
    await fs.writeFile(input, "authored-apk");
    const failure = Object.assign(new Error("authored source open failure"), {
      code,
    });
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      if (String(path) === input) throw failure;
      return await actual.open(path, flags, mode);
    });
    try {
      const result: unknown = await workspace
        .snapshotInput(input, "decode_android_resources")
        .catch((cause: unknown) => cause);
      if (code === "EIO") expect(result).toBe(failure);
      else
        expect(result).toMatchObject({
          _tag:
            code === "ENOENT"
              ? "AnalysisInputError"
              : "AnalysisAccessDeniedError",
          operation: "decode_android_resources",
          cause: failure,
          ...(code === "ENOENT" ? {} : { path: input, systemCode: code }),
        });
      expect(workspace.snapshot).toBeUndefined();
      await expect(fs.stat(join(root.path, "input.apk"))).rejects.toMatchObject(
        {
          code: "ENOENT",
        },
      );
    } finally {
      await workspace.close();
      await commands.close();
    }
  },
);
