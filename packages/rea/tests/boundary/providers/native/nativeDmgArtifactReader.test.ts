import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";

import { build } from "plist";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import {
  ExecFileOutputCancelledError,
  execFileOutput,
} from "../../../../src/process/ExecFileOutput.js";
import {
  ArtifactReaderFailure,
  type ArtifactEntry,
  type ArtifactReaderTraversal,
  type ArtifactTraversalOmission,
} from "../../../../src/artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../../../../src/artifacts/ArtifactResourceScope.js";
import { DirectoryArtifactReader } from "../../../../src/artifacts/DirectoryArtifactReader.js";
import { OwnedFileHandle } from "../../../../src/filesystem/OwnedFileHandle.js";
import {
  NativeDmgArtifactReader,
  type NativeDmgHost,
} from "../../../../src/artifacts/NativeDmgArtifactReader.js";
import { scanCanonicalArtifactInventoryInScope } from "../../../../src/artifacts/inventory/scanCanonical.js";

const createAttachedReader = async (
  path: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  signal?: AbortSignal,
  host?: NativeDmgHost,
): Promise<NativeDmgArtifactReader> => {
  const reader = new NativeDmgArtifactReader(path, environment, host);
  try {
    for await (const _entry of reader.entries(signal)) {
      // Force lazy initialization while keeping the existing lifecycle tests concise.
    }
    return reader;
  } catch (cause: unknown) {
    try {
      await reader.close();
    } catch (cleanupCause: unknown) {
      throw ArtifactReaderFailure.withCleanup(
        cause,
        ArtifactReaderFailure.cleanupObservation(
          cleanupCause,
          `DMG mount root ${path}`,
        ),
      );
    }
    throw cause;
  }
};

const entryPaths = async (
  reader: NativeDmgArtifactReader,
): Promise<string[]> => {
  const paths: string[] = [];
  for await (const entry of reader.entries()) paths.push(entry.path);
  return paths;
};

const infoPlist = (
  imagePath: string,
  entities: { "dev-entry": string; "mount-point"?: string }[],
): string =>
  build({
    images: [{ "image-path": imagePath, "system-entities": entities }],
  });

const emptyInfoPlist = build({ images: [] });

const attachPlist = (
  entities: { "dev-entry": string; "mount-point"?: string }[],
): string => build({ "system-entities": entities });

const createMountFixture = () => {
  let root: string | undefined;
  onTestFinished(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });
  const rememberRoot = (arguments_: readonly string[]): string => {
    root = arguments_[arguments_.indexOf("-mountroot") + 1];
    if (root === undefined) throw new Error("missing mount root");
    return root;
  };
  return {
    root: () => root,
    rememberRoot,
    async createVolume(
      arguments_: readonly string[],
      contents?: string,
    ): Promise<{ readonly mountRoot: string; readonly mountPoint: string }> {
      const mountRoot = rememberRoot(arguments_);
      const mountPoint = join(mountRoot, "Fixture");
      await mkdir(mountPoint);
      if (contents !== undefined)
        await writeFile(join(mountPoint, "hello.txt"), contents);
      return { mountRoot, mountPoint };
    },
  };
};

const createOmittedInventoryHost = () => {
  const mount = createMountFixture();
  const state: {
    calls: string[][];
    mountRoot: string | undefined;
    mountPoint: string | undefined;
    inventoryMode: "omitted" | "listed";
    attached: boolean;
    detachAttempts: number;
  } = {
    calls: [],
    mountRoot: undefined,
    mountPoint: undefined,
    inventoryMode: "omitted",
    attached: false,
    detachAttempts: 0,
  };
  const host: NativeDmgHost = {
    async run(arguments_) {
      state.calls.push([...arguments_]);
      if (arguments_[0] === "info")
        return {
          stdout:
            state.attached &&
            state.inventoryMode === "listed" &&
            state.mountPoint !== undefined
              ? infoPlist("/tmp/image.dmg", [
                  {
                    "dev-entry": "/dev/disk24",
                    "mount-point": state.mountPoint,
                  },
                ])
              : emptyInfoPlist,
          exitCode: 0,
        };
      if (arguments_[0] === "detach") {
        state.detachAttempts += 1;
        if (state.detachAttempts < 5)
          return { stdout: "", stderr: "device busy", exitCode: 1 };
        state.attached = false;
        return { stdout: "", exitCode: 0 };
      }
      if (arguments_[0] !== "attach") return { stdout: "", exitCode: 0 };
      const mounted = await mount.createVolume(arguments_, "owned mount");
      state.mountRoot = mounted.mountRoot;
      state.mountPoint = mounted.mountPoint;
      state.attached = true;
      return {
        stdout: attachPlist([
          { "dev-entry": "/dev/disk24", "mount-point": state.mountPoint },
        ]),
        exitCode: 0,
      };
    },
    delay: () => Promise.resolve(),
  };
  return { host, state };
};

describe("DMG inventory reader ownership", () => {
  it("lets inventory clean up a lazy reader after attach fails", async () => {
    const parent = await createTestTempDirectory("rea-dmg-inventory-owner-");
    const path = join(parent, "image.dmg");
    const image = Buffer.alloc(512);
    image.write("koly", 0, "ascii");
    await writeFile(path, image);

    const calls: string[][] = [];
    const mount = createMountFixture();
    let attached = false;
    let mountPoint: string | undefined;
    let infoAvailable = false;
    const host: NativeDmgHost = {
      async run(arguments_) {
        calls.push([...arguments_]);
        if (arguments_[0] === "verify") return { stdout: "", exitCode: 0 };
        if (arguments_[0] === "info") {
          if (!attached) return { stdout: emptyInfoPlist, exitCode: 0 };
          if (!infoAvailable)
            return {
              stdout: "",
              stderr: "temporary hdiutil info failure",
              exitCode: 1,
            };
          return {
            stdout: infoPlist(path, [
              {
                "dev-entry": "/dev/disk-inventory-owner",
                ...(mountPoint === undefined
                  ? {}
                  : { "mount-point": mountPoint }),
              },
            ]),
            exitCode: 0,
          };
        }
        if (arguments_[0] === "attach") {
          ({ mountPoint } = await mount.createVolume(arguments_, "owned"));
          attached = true;
          return { stdout: "malformed attach plist", exitCode: 0 };
        }
        if (arguments_[0] === "detach") {
          attached = false;
          return { stdout: "", exitCode: 0 };
        }
        throw new Error(`unexpected hdiutil command: ${arguments_[0] ?? ""}`);
      },
      delay: () => Promise.resolve(),
    };

    let reader: NativeDmgArtifactReader | undefined;
    let closeCalls = 0;
    const resourceScope = new ArtifactResourceScope();
    onTestFinished(() => resourceScope.close());
    const failure = await resourceScope
      .run(() =>
        scanCanonicalArtifactInventoryInScope(
          path,
          { resourceScope },
          (inputPath, _format, environment) => {
            reader = new NativeDmgArtifactReader(inputPath, environment, host);
            const closeReader = reader.close.bind(reader);
            reader.close = () => {
              closeCalls += 1;
              return closeReader();
            };
            return reader;
          },
        ),
      )
      .catch((cause: unknown) => cause);

    expect(failure).toMatchObject({
      reason: "format",
      cleanup: {
        resources: expect.arrayContaining([
          expect.stringMatching(/^DMG attachment ownership unknown/u),
          expect.stringMatching(/^DMG mount root /u),
        ]),
      },
    });
    if (reader === undefined)
      throw new Error("Inventory did not construct its DMG reader");
    expect(closeCalls).toBe(1);
    const mountRoot = mount.root();
    if (mountRoot === undefined) throw new Error("missing owned mount root");
    expect(await realpath(mountRoot)).toBe(mountRoot);

    infoAvailable = true;
    await resourceScope.close();
    expect(closeCalls).toBe(2);
    expect(attached).toBe(false);
    await expect(realpath(mountRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls.map(([operation]) => operation)).toEqual([
      "verify",
      "info",
      "attach",
      "info",
      "info",
      "detach",
    ]);
  });
});

describe("native DMG lazy initialization", () => {
  it("does not attach before entries and stays closed when closed first", async () => {
    const calls: string[][] = [];
    const reader = new NativeDmgArtifactReader("/tmp/image.dmg", process.env, {
      run: (arguments_) => {
        calls.push([...arguments_]);
        return Promise.resolve({ stdout: "", exitCode: 0 });
      },
    });

    await reader.close();
    await expect(entryPaths(reader)).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(calls).toEqual([]);
  });

  it("shares one lazy attach across concurrent entries calls", async () => {
    const { host, state } = createOmittedInventoryHost();
    const reader = new NativeDmgArtifactReader(
      "/tmp/image.dmg",
      process.env,
      host,
    );
    try {
      const [first, second] = await Promise.all([
        entryPaths(reader),
        entryPaths(reader),
      ]);
      expect(first).toEqual([
        "image.dmg/Fixture",
        "image.dmg/Fixture/hello.txt",
      ]);
      expect(second).toEqual(first);
      expect(
        state.calls.filter(([operation]) => operation === "attach"),
      ).toHaveLength(1);
    } finally {
      state.detachAttempts = 4;
      await reader.close();
    }
  });

  it("waits for a shared attach before close and rejects its pending entries", async () => {
    const calls: string[][] = [];
    const mount = createMountFixture();
    let markAttachStarted = (): void => {};
    const attachStarted = new Promise<void>((resolve) => {
      markAttachStarted = resolve;
    });
    let finishAttach = (_result: {
      readonly stdout: string;
      readonly exitCode: number;
    }): void => {};
    let attached = false;
    let mountPoint: string | undefined;
    const host: NativeDmgHost = {
      async run(arguments_) {
        calls.push([...arguments_]);
        if (arguments_[0] === "info")
          return {
            stdout:
              !attached || mountPoint === undefined
                ? emptyInfoPlist
                : infoPlist("/tmp/image.dmg", [
                    { "dev-entry": "/dev/disk70", "mount-point": mountPoint },
                  ]),
            exitCode: 0,
          };
        if (arguments_[0] === "attach") {
          const mounted = await mount.createVolume(arguments_, "owned");
          mountPoint = mounted.mountPoint;
          markAttachStarted();
          return new Promise((resolve) => {
            finishAttach = resolve;
          });
        }
        if (arguments_[0] === "detach") attached = false;
        return { stdout: "", exitCode: 0 };
      },
    };
    const reader = new NativeDmgArtifactReader(
      "/tmp/image.dmg",
      process.env,
      host,
    );

    const entries = entryPaths(reader);
    await attachStarted;
    let closeFinished = false;
    const closing = reader.close().then(() => {
      closeFinished = true;
    });
    await Promise.resolve();
    expect(closeFinished).toBe(false);

    attached = true;
    finishAttach({
      stdout: attachPlist([
        { "dev-entry": "/dev/disk70", "mount-point": mountPoint ?? "" },
      ]),
      exitCode: 0,
    });

    await expect(entries).rejects.toMatchObject({ reason: "unavailable" });
    await closing;
    expect(calls.filter(([operation]) => operation === "attach")).toHaveLength(
      1,
    );
    expect(calls.filter(([operation]) => operation === "detach")).toEqual([
      ["detach", "/dev/disk70"],
    ]);
    expect(
      await realpath(mount.root() ?? "").catch(() => undefined),
    ).toBeUndefined();
  });
});

describe("native DMG directory ownership", () => {
  it("closes unread member streams and suspended traversal handles before detach", async () => {
    const calls: string[][] = [];
    const mount = createMountFixture();
    let attached = false;
    let mountPoint: string | undefined;
    let unread: Readable | undefined;
    let unreadHandleRejectedAtDetach = false;
    const host: NativeDmgHost = {
      async run(arguments_) {
        calls.push([...arguments_]);
        if (arguments_[0] === "info")
          return {
            stdout:
              !attached || mountPoint === undefined
                ? emptyInfoPlist
                : infoPlist("/tmp/image.dmg", [
                    {
                      "dev-entry": "/dev/disk-unread",
                      "mount-point": mountPoint,
                    },
                  ]),
            exitCode: 0,
          };
        if (arguments_[0] === "detach") {
          if (unread !== undefined) {
            try {
              await unread[Symbol.asyncIterator]().next();
            } catch {
              unreadHandleRejectedAtDetach = true;
            }
          }
          attached = false;
          return { stdout: "", exitCode: 0 };
        }
        if (arguments_[0] !== "attach") return { stdout: "", exitCode: 0 };
        ({ mountPoint } = await mount.createVolume(arguments_, "unread bytes"));
        attached = true;
        return {
          stdout: attachPlist([
            { "dev-entry": "/dev/disk-unread", "mount-point": mountPoint },
          ]),
          exitCode: 0,
        };
      },
    };
    const reader = await createAttachedReader(
      "/tmp/image.dmg",
      process.env,
      undefined,
      host,
    );
    let fileEntry: ArtifactEntry | undefined;
    for await (const entry of reader.entries())
      if (entry.path.endsWith("/hello.txt")) fileEntry = entry;
    if (fileEntry === undefined) throw new Error("expected hello.txt");
    unread = await reader.open(fileEntry);
    const iterator = reader.entries()[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new Error("expected a mounted directory entry");
    await reader.close();
    expect(calls.filter(([operation]) => operation === "detach")).toEqual([
      ["detach", "/dev/disk-unread"],
    ]);
    expect(unreadHandleRejectedAtDetach).toBe(true);
    await expect(realpath(mount.root() ?? "")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await iterator.next()).done).toBe(true);
  });
});

describe("native DMG traversal shutdown", () => {
  it("waits for a pending directory advance before detaching", async () => {
    const { host, state } = createOmittedInventoryHost();
    state.inventoryMode = "listed";
    state.detachAttempts = 4;
    const originalEntries = DirectoryArtifactReader.prototype.entries;
    let gateAdvance = false;
    let markAdvanceStarted = (): void => {};
    const advanceStarted = new Promise<void>((resolve) => {
      markAdvanceStarted = resolve;
    });
    let releaseAdvance = (): void => {};
    const advanceGate = new Promise<void>((resolve) => {
      releaseAdvance = resolve;
    });
    const entriesSpy = vi
      .spyOn(DirectoryArtifactReader.prototype, "entries")
      .mockImplementation(async function* (
        this: DirectoryArtifactReader,
        signal?: AbortSignal,
        selection?: Parameters<DirectoryArtifactReader["entries"]>[1],
      ) {
        const iterator = originalEntries
          .call(this, signal, selection)
          [Symbol.asyncIterator]();
        try {
          for (;;) {
            const next = await iterator.next();
            if (next.done) return;
            if (gateAdvance) {
              markAdvanceStarted();
              await advanceGate;
            }
            yield next.value;
          }
        } finally {
          await iterator.return?.();
        }
      });
    try {
      const reader = await createAttachedReader(
        "/tmp/image.dmg",
        process.env,
        undefined,
        host,
      );
      gateAdvance = true;
      const iterator = reader.entries()[Symbol.asyncIterator]();
      const advancing = iterator.next();
      await advanceStarted;
      const closing = reader.close();
      await Promise.resolve();
      expect(state.detachAttempts).toBe(4);
      releaseAdvance();
      expect((await advancing).done).toBe(true);
      await closing;
      expect(state.detachAttempts).toBe(5);
      await expect(realpath(state.mountRoot ?? "")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      entriesSpy.mockRestore();
    }
  });
});

describe("native DMG directory close recovery", () => {
  it("retains a mounted directory after its close fails and retries before detach", async () => {
    const { host, state } = createOmittedInventoryHost();
    state.inventoryMode = "listed";
    state.detachAttempts = 4;
    const closeDirectory = vi
      .spyOn(DirectoryArtifactReader.prototype, "close")
      .mockImplementationOnce(async () => {
        throw new Error("injected directory close failure");
      });
    try {
      const reader = await createAttachedReader(
        "/tmp/image.dmg",
        process.env,
        undefined,
        host,
      );
      const failure = await reader.close().catch((cause: unknown) => cause);
      expect(failure).toMatchObject({
        reason: "io",
        cleanup: {
          resources: expect.arrayContaining([
            expect.stringMatching(/^DMG mounted directory at /u),
            expect.stringMatching(/^DMG mount root /u),
          ]),
        },
      });
      expect(state.detachAttempts).toBe(4);
      expect(await realpath(state.mountRoot ?? "")).toBe(state.mountRoot);

      await reader.close();
      expect(closeDirectory).toHaveBeenCalledTimes(2);
      expect(state.detachAttempts).toBe(5);
      await expect(realpath(state.mountRoot ?? "")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      closeDirectory.mockRestore();
    }
  });
});

describe("native DMG artifact reader", () => {
  it("uses plist attachment metadata and detaches returned devices", async () => {
    const calls: string[][] = [];
    const mount = createMountFixture();
    let attached = false;
    let mountPoint: string | undefined;
    const host: NativeDmgHost = {
      async run(arguments_) {
        const args = [...arguments_];
        calls.push(args);
        if (args[0] === "info")
          return {
            stdout: attached
              ? infoPlist("/tmp/image.dmg", [
                  {
                    "dev-entry": "/dev/disk-fixture",
                    ...(mountPoint === undefined
                      ? {}
                      : { "mount-point": mountPoint }),
                  },
                ])
              : emptyInfoPlist,
            exitCode: 0,
          };
        if (args[0] === "detach") {
          attached = false;
          return { stdout: "", exitCode: 0 };
        }
        if (args[0] !== "attach") return { stdout: "", exitCode: 0 };
        ({ mountPoint } = await mount.createVolume(args, "hello"));
        attached = true;
        return {
          stdout: attachPlist([
            { "dev-entry": "/dev/disk-fixture", "mount-point": mountPoint },
          ]),
          exitCode: 0,
        };
      },
    };
    const reader = await createAttachedReader(
      "/tmp/image.dmg",
      process.env,
      undefined,
      host,
    );
    if (mountPoint === undefined) throw new Error("expected mounted directory");
    if (process.platform !== "win32")
      await execFileOutput("mkfifo", [join(mountPoint, "special.pipe")]);
    const entries = [];
    const omissions: ArtifactTraversalOmission[] = [];
    for await (const entry of reader.entries(undefined, {
      onOmission: (omission) => omissions.push(omission),
    }))
      entries.push(entry.path);
    expect(entries).toContain("image.dmg/Fixture/hello.txt");
    if (process.platform !== "win32")
      expect(omissions).toEqual([
        { path: "image.dmg/Fixture/special.pipe", kind: "fifo" },
      ]);
    const provenance = reader.provenance();
    const first = provenance[0];
    if (first === undefined) throw new Error("expected attachment provenance");
    Reflect.set(first, "tool", "forged");
    expect(reader.provenance()[0]?.tool).toBe("/usr/bin/hdiutil");
    await reader.close();
    expect(calls).toContainEqual(["verify", "/tmp/image.dmg"]);
    expect(calls).toContainEqual(["detach", "/dev/disk-fixture"]);
  });

  // hdiutil localizes its diagnostics; en-GB and other English locales spell
  // the refusal "recognised".
  it.each(["recognized", "recognised"])(
    "rejects non-zero verification results (image not %s)",
    async (spelling) => {
      await expect(
        createAttachedReader("/tmp/image.dmg", process.env, undefined, {
          run: () =>
            Promise.resolve({
              stdout: "verify output",
              stderr: `hdiutil: verify failed - image not ${spelling}`,
              exitCode: 1,
            }),
        }),
      ).rejects.toMatchObject({
        reason: "format",
        message: expect.stringMatching(
          new RegExp(
            `"arguments":\\["verify","/tmp/image\\.dmg"\\].*"exitCode":1.*"stderr":"hdiutil: verify failed - image not ${spelling}"`,
            "u",
          ),
        ),
      });
    },
  );

  it("retains the root and reports unknown ownership when recovery discovery fails", async () => {
    const mount = createMountFixture();
    const host: NativeDmgHost = {
      run(arguments_) {
        if (arguments_[0] === "info") {
          if (mount.root() === undefined)
            return Promise.resolve({
              stdout: emptyInfoPlist,
              exitCode: 0,
            });
          return Promise.resolve({
            stdout: "unavailable info plist",
            stderr: "hdiutil info failed",
            exitCode: 1,
          });
        }
        if (arguments_[0] !== "attach")
          return Promise.resolve({ stdout: "", exitCode: 0 });
        mount.rememberRoot(arguments_);
        return Promise.resolve({
          stdout: build({ unexpected: true }),
          exitCode: 0,
        });
      },
    };
    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, host),
    ).rejects.toMatchObject({
      reason: "format",
      cleanup: {
        resources: expect.arrayContaining([
          expect.stringMatching(
            /^DMG attachment ownership unknown at mount root /u,
          ),
          expect.stringMatching(/^DMG mount root /u),
        ]),
      },
    });
    expect(mount.root()).toBeDefined();
    expect(await realpath(mount.root() ?? "")).toBe(mount.root());
  });
});

describe("DMG attach recovery", () => {
  it("keeps attach-output ownership when the first inventory omits the mount", async () => {
    const { host, state } = createOmittedInventoryHost();
    const reader = await createAttachedReader(
      "/tmp/image.dmg",
      process.env,
      undefined,
      host,
    );
    await expect(reader.close()).rejects.toMatchObject({
      reason: "unavailable",
      cleanup: {
        resources: expect.arrayContaining([
          "DMG device /dev/disk24",
          expect.stringMatching(/^DMG mount root /u),
        ]),
      },
    });
    expect(state.detachAttempts).toBe(4);
    expect(await realpath(state.mountRoot ?? "")).toBe(state.mountRoot);

    state.inventoryMode = "listed";
    await reader.close();
    expect(state.detachAttempts).toBe(5);
    expect(
      await realpath(state.mountRoot ?? "").catch(() => undefined),
    ).toBeUndefined();
  });
});

describe("DMG rooted ownership isolation", () => {
  it("detaches its rooted group while leaving a concurrent foreign image alone", async () => {
    const calls: string[][] = [];
    const mount = createMountFixture();
    let mountPoint: string | undefined;
    let ownedAttached = false;
    const host: NativeDmgHost = {
      async run(arguments_) {
        calls.push([...arguments_]);
        if (arguments_[0] === "info")
          return {
            stdout:
              !ownedAttached || mountPoint === undefined
                ? emptyInfoPlist
                : build({
                    images: [
                      {
                        "image-path": "/tmp/image.dmg",
                        "system-entities": [
                          {
                            "dev-entry": "/dev/disk26",
                            "mount-point": mountPoint,
                          },
                        ],
                      },
                      {
                        "image-path": "/tmp/foreign.dmg",
                        "system-entities": [
                          {
                            "dev-entry": "/dev/disk99",
                            "mount-point": "/Volumes/Foreign",
                          },
                        ],
                      },
                    ],
                  }),
            exitCode: 0,
          };
        if (arguments_[0] === "detach") {
          if (arguments_[1] === "/dev/disk26") ownedAttached = false;
          return { stdout: "", exitCode: 0 };
        }
        if (arguments_[0] !== "attach") return { stdout: "", exitCode: 0 };
        ({ mountPoint } = await mount.createVolume(arguments_));
        ownedAttached = true;
        return {
          stdout: attachPlist([
            { "dev-entry": "/dev/disk26", "mount-point": mountPoint },
          ]),
          exitCode: 0,
        };
      },
    };

    const reader = await createAttachedReader(
      "/tmp/image.dmg",
      process.env,
      undefined,
      host,
    );
    await reader.close();
    expect(calls.filter(([operation]) => operation === "detach")).toEqual([
      ["detach", "/dev/disk26"],
    ]);
    expect(ownedAttached).toBe(false);
    expect(calls).not.toContainEqual(["detach", "/dev/disk99"]);
    expect(
      await realpath(mount.root() ?? "").catch(() => undefined),
    ).toBeUndefined();
  });
});

describe("DMG failed attach output recovery", () => {
  it("uses captured attach stdout to recover a failed command's rooted device", async () => {
    const calls: string[][] = [];
    const mount = createMountFixture();
    const host: NativeDmgHost = {
      run(arguments_) {
        calls.push([...arguments_]);
        if (arguments_[0] === "info")
          return Promise.resolve({
            stdout: emptyInfoPlist,
            exitCode: 0,
          });
        if (arguments_[0] === "attach") {
          const mountRoot = mount.rememberRoot(arguments_);
          return Promise.resolve({
            stdout: attachPlist([
              {
                "dev-entry": "/dev/disk25",
                "mount-point": join(mountRoot, "Fixture"),
              },
            ]),
            stderr: "attach interrupted after mounting",
            exitCode: 1,
          });
        }
        return Promise.resolve({ stdout: "", exitCode: 0 });
      },
    };

    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, host),
    ).rejects.toThrow(/hdiutil attach failed/u);
    expect(calls).toContainEqual(["detach", "/dev/disk25"]);
    expect(
      await realpath(mount.root() ?? "").catch(() => undefined),
    ).toBeUndefined();
  });
});

describe("DMG attach fallback recovery", () => {
  it("recovers a mounted image after the attach plist is malformed", async () => {
    const calls: string[][] = [];
    const mount = createMountFixture();
    let attached = false;
    let mountPoint: string | undefined;
    const host: NativeDmgHost = {
      async run(arguments_) {
        calls.push([...arguments_]);
        if (arguments_[0] === "info")
          return {
            stdout:
              !attached || mountPoint === undefined
                ? emptyInfoPlist
                : infoPlist("/tmp/image.dmg", [
                    { "dev-entry": "/dev/disk20" },
                    {
                      "dev-entry": "/dev/disk20s1",
                      "mount-point": mountPoint,
                    },
                  ]),
            exitCode: 0,
          };
        if (arguments_[0] === "detach") {
          attached = false;
          return { stdout: "", exitCode: 0 };
        }
        if (arguments_[0] !== "attach") return { stdout: "", exitCode: 0 };
        ({ mountPoint } = await mount.createVolume(
          arguments_,
          "recovered mount",
        ));
        attached = true;
        return { stdout: "{invalid plist", exitCode: 0 };
      },
    };

    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, host),
    ).rejects.toThrow();
    expect(calls.map(([operation]) => operation)).toEqual([
      "verify",
      "info",
      "attach",
      "info",
      "detach",
    ]);
    expect(calls).toContainEqual(["detach", "/dev/disk20"]);
    expect(
      await realpath(mount.root() ?? "").catch(() => undefined),
    ).toBeUndefined();
  });

  it("keeps unmounted new devices ambiguous without detaching them", async () => {
    const calls: string[][] = [];
    const mount = createMountFixture();
    const host: NativeDmgHost = {
      run(arguments_) {
        calls.push([...arguments_]);
        if (arguments_[0] === "info")
          return Promise.resolve({
            stdout:
              mount.root() === undefined
                ? emptyInfoPlist
                : infoPlist("/tmp/image.dmg", [{ "dev-entry": "/dev/disk23" }]),
            exitCode: 0,
          });
        if (arguments_[0] !== "attach")
          return Promise.resolve({ stdout: "", exitCode: 0 });
        mount.rememberRoot(arguments_);
        return Promise.resolve({
          stdout: attachPlist([{ "dev-entry": "/dev/disk23" }]),
          exitCode: 0,
        });
      },
    };

    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, host),
    ).rejects.toMatchObject({
      reason: "unavailable",
      cleanup: {
        resources: expect.arrayContaining([
          expect.stringMatching(
            /^DMG attachment ownership unknown at mount root /u,
          ),
          expect.stringMatching(/^DMG mount root /u),
        ]),
      },
    });
    expect(calls.filter(([operation]) => operation === "detach")).toEqual([]);
    expect(await realpath(mount.root() ?? "")).toBe(mount.root());
  });
});

describe("DMG attach cancellation and preexisting mounts", () => {
  it.each(["owned cancellation", "opaque AbortError"] as const)(
    "waits for an aborted attach result before discovering and detaching its mount (%s)",
    async (kind) => {
      const calls: string[][] = [];
      const controller = new AbortController();
      const reason = { request: "cancel DMG attach" };
      const commandFailure =
        kind === "owned cancellation"
          ? new ExecFileOutputCancelledError(reason)
          : Object.assign(new Error("attach aborted"), { name: "AbortError" });
      const mount = createMountFixture();
      let markAttachStarted = (): void => {};
      const attachStarted = new Promise<void>((resolveStarted) => {
        markAttachStarted = resolveStarted;
      });
      let attached = false;
      let mountPoint: string | undefined;
      const host: NativeDmgHost = {
        async run(arguments_, signal) {
          calls.push([...arguments_]);
          if (arguments_[0] === "info")
            return {
              stdout:
                !attached || mountPoint === undefined
                  ? emptyInfoPlist
                  : infoPlist("/tmp/image.dmg", [
                      {
                        "dev-entry": "/dev/disk21",
                        "mount-point": mountPoint,
                      },
                    ]),
              exitCode: 0,
            };
          if (arguments_[0] === "detach") {
            attached = false;
            return { stdout: "", exitCode: 0 };
          }
          if (arguments_[0] !== "attach") return { stdout: "", exitCode: 0 };
          mountPoint = join(mount.rememberRoot(arguments_), "Fixture");
          markAttachStarted();
          return new Promise((_, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                void mkdir(mountPoint ?? "").then(async () => {
                  attached = true;
                  await writeFile(
                    join(mountPoint ?? "", "hello.txt"),
                    "after exit",
                  );
                  reject(commandFailure);
                });
              },
              { once: true },
            );
          });
        },
      };

      const creating = createAttachedReader(
        "/tmp/image.dmg",
        process.env,
        controller.signal,
        host,
      );
      await attachStarted;
      controller.abort(reason);
      const failure: unknown = await creating.catch((cause: unknown) => cause);
      if (!(failure instanceof ArtifactReaderFailure))
        throw new Error("Expected the settled attach failure");
      expect(failure.reason).toBe(
        kind === "owned cancellation" ? "cancelled" : "unavailable",
      );
      expect(failure.cause).toBe(commandFailure);
      if (kind === "owned cancellation")
        expect(failure.cancellation?.reason).toBe(reason);
      else expect(failure.cancellation).toBeUndefined();
      expect(calls.map(([operation]) => operation)).toEqual([
        "verify",
        "info",
        "attach",
        "info",
        "detach",
      ]);
      expect(calls).toContainEqual(["detach", "/dev/disk21"]);
      expect(attached).toBe(false);
      await expect(realpath(mount.root() ?? "")).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("leaves a preexisting outside-root mount attached", async () => {
    const calls: string[][] = [];
    const host: NativeDmgHost = {
      async run(arguments_) {
        calls.push([...arguments_]);
        if (arguments_[0] === "info")
          return {
            stdout: infoPlist("/tmp/image.dmg", [
              {
                "dev-entry": "/dev/disk22",
                "mount-point": "/Volumes/AlreadyMounted",
              },
            ]),
            exitCode: 0,
          };
        if (arguments_[0] === "attach")
          return {
            stdout: attachPlist([
              {
                "dev-entry": "/dev/disk22",
                "mount-point": "/Volumes/AlreadyMounted",
              },
            ]),
            exitCode: 0,
          };
        return { stdout: "", exitCode: 0 };
      },
    };

    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, host),
    ).rejects.toMatchObject({ reason: "path" });
    expect(calls.filter(([operation]) => operation === "detach")).toEqual([]);
    expect(calls.map(([operation]) => operation)).toEqual([
      "verify",
      "info",
      "attach",
      "info",
    ]);
  });
});

describe("native DMG command failure diagnostics", () => {
  it("removes an empty root when the attach process never started", async () => {
    const calls: string[][] = [];
    let mountRoot: string | undefined;
    onTestFinished(async () => {
      if (mountRoot !== undefined)
        await rm(mountRoot, { recursive: true, force: true });
    });
    const host: NativeDmgHost = {
      run(arguments_) {
        calls.push([...arguments_]);
        if (arguments_[0] === "verify")
          return Promise.resolve({ stdout: "", exitCode: 0 });
        if (arguments_[0] === "info")
          return Promise.resolve({ stdout: emptyInfoPlist, exitCode: 0 });
        if (arguments_[0] === "attach") {
          mountRoot = arguments_[arguments_.indexOf("-mountroot") + 1];
          return Promise.reject(
            Object.assign(new Error("could not spawn hdiutil"), {
              code: "ENOENT",
              syscall: "spawn /usr/bin/hdiutil",
              errno: -2,
            }),
          );
        }
        throw new Error(`unexpected command: ${arguments_[0] ?? ""}`);
      },
    };

    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, host),
    ).rejects.toMatchObject({
      reason: "unavailable",
      message: expect.stringContaining('"code":"ENOENT"'),
      cleanup: undefined,
    });
    expect(calls.map(([operation]) => operation)).toEqual([
      "verify",
      "info",
      "attach",
    ]);
    expect(
      await realpath(mountRoot ?? "").catch(() => undefined),
    ).toBeUndefined();
  });
});

describe("native DMG command diagnostics", () => {
  it("keeps unknown attach failures unavailable with command evidence", async () => {
    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, {
        run(arguments_) {
          if (arguments_[0] === "verify")
            return Promise.resolve({ stdout: "", exitCode: 0 });
          if (arguments_[0] === "info")
            return Promise.resolve({
              stdout: emptyInfoPlist,
              exitCode: 0,
            });
          return Promise.resolve({
            stdout: "attach output",
            stderr: "attach failed for an unknown reason",
            exitCode: 2,
          });
        },
      }),
    ).rejects.toMatchObject({
      reason: "unavailable",
      message: expect.stringMatching(
        /"arguments":\["attach".*"exitCode":2.*"stderr":"attach failed for an unknown reason"/u,
      ),
    });
  });

  it("keeps unrecognized numeric verify failures unknown and maps the observed I/O diagnostic", async () => {
    const unknown = await createAttachedReader(
      "/tmp/image.dmg",
      process.env,
      undefined,
      {
        run: () =>
          Promise.resolve({
            stdout: "verify stdout",
            stderr: "hdiutil: verify failed - an unrecognized system failure",
            exitCode: 1,
          }),
      },
    ).catch((cause: unknown) => cause);
    expect(unknown).toBeInstanceOf(ArtifactReaderFailure);
    if (!(unknown instanceof ArtifactReaderFailure)) return;
    expect(unknown.reason).toBe("unavailable");
    expect(unknown.message).toContain("do not establish the failure cause");
    expect(unknown.message).toContain('"exitCode":1');
    expect(unknown.message).toContain('"stdout":"verify stdout"');
    expect(unknown.message).toContain("an unrecognized system failure");

    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, {
        run: () =>
          Promise.resolve({
            stdout: "",
            stderr: "hdiutil: verify failed - Input/output error\n",
            exitCode: 1,
          }),
      }),
    ).rejects.toMatchObject({
      reason: "io",
      message: expect.stringContaining("Input/output error"),
    });

    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, {
        run: () =>
          Promise.resolve({
            stdout: "checksum output",
            stderr: "hdiutil: verify failed - image data corrupted\n",
            exitCode: 1,
          }),
      }),
    ).rejects.toMatchObject({
      reason: "integrity",
      message: expect.stringContaining("image data corrupted"),
    });
  });

  it("distinguishes child launch and host permission failures", async () => {
    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, {
        run: () =>
          Promise.reject(
            Object.assign(new Error("could not launch hdiutil"), {
              code: "ENOENT",
              syscall: "spawn /usr/bin/hdiutil",
            }),
          ),
      }),
    ).rejects.toMatchObject({
      reason: "unavailable",
      message: expect.stringContaining('"code":"ENOENT"'),
    });

    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, {
        run: () =>
          Promise.reject(
            Object.assign(new Error("permission denied"), {
              code: "EACCES",
              syscall: "spawn /usr/bin/hdiutil",
            }),
          ),
      }),
    ).rejects.toMatchObject({
      reason: "io",
      message: expect.stringContaining('"code":"EACCES"'),
    });
  });
});

describe("native DMG verification resource availability", () => {
  const transientFailure = {
    stdout: "",
    stderr:
      'hdiutil: verify: unable to recognize "/tmp/image.dmg" as a disk image. (Resource temporarily unavailable)\nhdiutil: verify failed - Resource temporarily unavailable\n',
    exitCode: 1,
  };

  it("retries the explicit transient refusal before attachment and retains both attempts", async () => {
    const { host, state } = createOmittedInventoryHost();
    state.inventoryMode = "listed";
    state.detachAttempts = 4;
    const delays = vi.fn(async () => {});
    const timeouts: number[] = [];
    let attempts = 0;
    const reader = await createAttachedReader(
      "/tmp/image.dmg",
      process.env,
      undefined,
      {
        ...host,
        delay: delays,
        async run(arguments_, signal, options) {
          if (arguments_[0] === "verify") {
            attempts += 1;
            if (options === undefined)
              throw new Error("missing verify deadline");
            timeouts.push(options.timeoutMs);
            if (attempts === 1) return transientFailure;
          }
          return host.run(arguments_, signal, options);
        },
      },
    );
    onTestFinished(() => reader.close());
    expect(attempts).toBe(2);
    expect(delays.mock.calls).toEqual([[250]]);
    expect(timeouts[0]).toBeLessThanOrEqual(120_000);
    expect(timeouts[1]).toBeLessThanOrEqual(timeouts[0]!);
    expect(reader.provenance().slice(0, 2)).toMatchObject([
      {
        arguments: ["verify", "/tmp/image.dmg"],
        exit_code: 1,
        effects: ["read"],
      },
      {
        arguments: ["verify", "/tmp/image.dmg"],
        exit_code: 0,
        effects: ["read"],
      },
    ]);
    await reader.close();
    expect(state.attached).toBe(false);
  });

  it("bounds repeated transient refusals and never attaches an unverified image", async () => {
    const run = vi.fn(async () => transientFailure);
    const delay = vi.fn(async () => {});
    const reader = new NativeDmgArtifactReader("/tmp/image.dmg", process.env, {
      run,
      delay,
    });
    await expect(entryPaths(reader)).rejects.toMatchObject({
      reason: "unavailable",
      message: expect.stringContaining("Resource temporarily unavailable"),
    });
    await reader.close();
    expect(run.mock.calls).toHaveLength(3);
    expect(delay.mock.calls).toEqual([[250], [500]]);
    expect(reader.provenance().map(({ exit_code }) => exit_code)).toEqual([
      1, 1, 1,
    ]);
  });

  it("honors cancellation during the wait without starting another command", async () => {
    const controller = new AbortController();
    const run = vi.fn(async () => transientFailure);
    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, controller.signal, {
        run,
        async delay() {
          controller.abort(new Error("cancel verification"));
        },
      }),
    ).rejects.toMatchObject({ reason: "cancelled" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not start another verification after the shared deadline", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const run = vi.fn(async () => transientFailure);
    try {
      await expect(
        createAttachedReader("/tmp/image.dmg", process.env, undefined, {
          run,
          async delay() {
            clock.mockReturnValue(120_001);
          },
        }),
      ).rejects.toMatchObject({
        reason: "unavailable",
        message: expect.stringContaining("Resource temporarily unavailable"),
      });
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    ["image data corrupted", "integrity"],
    ["image not recognized", "format"],
    ["Permission denied", "io"],
    ["an unknown failure", "unavailable"],
  ])("does not retry %s", async (diagnostic, reason) => {
    const run = vi.fn(async () => ({
      stdout: "",
      stderr: `hdiutil: verify failed - ${diagnostic}\n`,
      exitCode: 1,
    }));
    const delay = vi.fn(async () => {});
    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, {
        run,
        delay,
      }),
    ).rejects.toMatchObject({ reason });
    expect(run).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });
});

// Captured from hdiutil with AppleLanguages set to es-419.
const localizedImageRefusal = (path: string, reason: string) => ({
  stdout: "",
  stderr: `hdiutil: verify: unable to recognize ${JSON.stringify(path)} as a disk image. (${reason})\nhdiutil: verify failed - ${reason}\n`,
  exitCode: 1,
});

describe("native DMG localized verification diagnostics", () => {
  it("classifies a localized checksum mismatch from the untranslated status line", async () => {
    const run = vi.fn(async () => ({
      stdout: "",
      stderr:
        'Calculando suma de disco entero (partición desconocida: 0)…\ndisco entero (partición desconocida:: calculado CRC32 $3816B077, esperado   CRC32 $A738EA1C\nhdiutil: verify: checksum of "/tmp/image.dmg" is INVALID\nhdiutil: verify failed - suma no válida\n',
      exitCode: 1,
    }));
    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, { run }),
    ).rejects.toMatchObject({
      reason: "integrity",
      message: expect.stringContaining("suma no válida"),
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a malformed image", "imagen no reconocida"],
    ["a transiently busy image", "Recurso no disponible temporalmente"],
  ])(
    "keeps a localized refusal of a readable target unknown and retries it like %s could be",
    async (_target, reason) => {
      const root = await createTestTempDirectory("rea-localized-dmg-readable-");
      const path = join(root, "image.dmg");
      await writeFile(path, "This may or may not be a disk image.\n");
      const run = vi.fn(async () => localizedImageRefusal(path, reason));
      const delay = vi.fn(async () => {});
      const reader = new NativeDmgArtifactReader(path, process.env, {
        run,
        delay,
      });
      await expect(entryPaths(reader)).rejects.toMatchObject({
        reason: "unavailable",
        message: expect.stringContaining(reason),
      });
      await reader.close();
      expect(run.mock.calls).toHaveLength(3);
      expect(delay.mock.calls).toEqual([[250], [500]]);
      expect(reader.provenance().map(({ exit_code }) => exit_code)).toEqual([
        1, 1, 1,
      ]);
    },
  );

  it("attaches after a localized transient refusal clears", async () => {
    const { host, state } = createOmittedInventoryHost();
    state.inventoryMode = "listed";
    state.detachAttempts = 4;
    const root = await createTestTempDirectory("rea-localized-dmg-transient-");
    const path = join(root, "image.dmg");
    await writeFile(path, "A disk image that is briefly busy.\n");
    let attempts = 0;
    const reader = await createAttachedReader(path, process.env, undefined, {
      ...host,
      delay: async () => {},
      async run(arguments_, signal, options) {
        if (arguments_[0] === "verify") {
          attempts += 1;
          if (attempts === 1)
            return localizedImageRefusal(
              path,
              "Recurso no disponible temporalmente",
            );
        }
        return host.run(arguments_, signal, options);
      },
    });
    onTestFinished(() => reader.close());
    expect(attempts).toBe(2);
    await reader.close();
    expect(state.attached).toBe(false);
  });

  it("classifies a localized refusal of a missing target as an I/O failure", async () => {
    const root = await createTestTempDirectory("rea-localized-dmg-io-");
    const path = join(root, "missing.dmg");
    const run = vi.fn(async () =>
      localizedImageRefusal(path, "No existe este archivo o directorio"),
    );
    const delay = vi.fn(async () => {});
    await expect(
      createAttachedReader(path, process.env, undefined, { run, delay }),
    ).rejects.toMatchObject({
      reason: "io",
      message: expect.stringContaining("No existe este archivo o directorio"),
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")(
    "does not block on a target replaced by a named pipe",
    async () => {
      const root = await createTestTempDirectory("rea-localized-dmg-fifo-");
      const path = join(root, "image.dmg");
      await execFileOutput("mkfifo", [path]);
      const run = vi.fn(async () =>
        localizedImageRefusal(path, "imagen no reconocida"),
      );
      await expect(
        createAttachedReader(path, process.env, undefined, {
          run,
          delay: async () => {},
        }),
      ).rejects.toMatchObject({ reason: "unavailable" });
      expect(run).toHaveBeenCalledTimes(3);
    },
    10_000,
  );

  it("keeps a localized failure without an untranslated status line unavailable", async () => {
    const run = vi.fn(async () => ({
      stdout: "",
      stderr: "hdiutil: verify failed - error desconocido\n",
      exitCode: 1,
    }));
    await expect(
      createAttachedReader("/tmp/image.dmg", process.env, undefined, { run }),
    ).rejects.toMatchObject({ reason: "unavailable" });
  });
});

describe("native DMG localized verification cleanup", () => {
  it("preserves cancellation that arrives before the localized target probe", async () => {
    const root = await createTestTempDirectory("rea-localized-dmg-cancel-");
    const path = join(root, "image.dmg");
    await writeFile(
      path,
      "Readable target; hdiutil refusal remains ambiguous.\n",
    );
    const controller = new AbortController();
    const run = vi.fn(async () => {
      controller.abort(new Error("cancel localized verification"));
      return localizedImageRefusal(path, "Recurso no disponible temporalmente");
    });
    const delay = vi.fn(async () => {});
    await expect(
      createAttachedReader(path, process.env, controller.signal, {
        run,
        delay,
      }),
    ).rejects.toMatchObject({ reason: "cancelled" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("retains a failed verification-probe close for reader cleanup", async () => {
    const root = await createTestTempDirectory("rea-localized-dmg-close-");
    const path = join(root, "image.dmg");
    await writeFile(
      path,
      "Readable target; hdiutil refusal remains ambiguous.\n",
    );
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementationOnce(() =>
        Promise.reject(new Error("injected probe descriptor close failure")),
      );
    try {
      const reader = new NativeDmgArtifactReader(path, process.env, {
        run: async () => localizedImageRefusal(path, "imagen no reconocida"),
        delay: async () => {},
      });
      await expect(entryPaths(reader)).rejects.toMatchObject({
        reason: "unavailable",
        message: expect.stringContaining("imagen no reconocida"),
        cleanup: {
          resources: expect.arrayContaining([
            `DMG verification target descriptor ${path}`,
          ]),
        },
      });
      await reader.close();
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      close.mockRestore();
    }
  });
});

describe("native DMG checksum-free images", () => {
  it("attaches after hdiutil reports no stored checksum and reports integrity as unverified", async () => {
    const { host, state } = createOmittedInventoryHost();
    state.inventoryMode = "listed";
    state.detachAttempts = 4;
    const verify = vi.fn(async () => ({
      stdout: "",
      stderr: 'hdiutil: verify: "/tmp/image.dmg" has no checksum.\n',
      exitCode: 1,
    }));
    const reader = new NativeDmgArtifactReader("/tmp/image.dmg", process.env, {
      ...host,
      run: (arguments_, signal, options) =>
        arguments_[0] === "verify"
          ? verify()
          : host.run(arguments_, signal, options),
    });
    onTestFinished(() => reader.close());
    const coverage: ArtifactReaderTraversal[] = [];
    const paths: string[] = [];
    for await (const entry of reader.entries(undefined, {
      onCoverage: (observed) => coverage.push(observed),
    }))
      paths.push(entry.path);

    expect(paths).toContain("image.dmg/Fixture/hello.txt");
    // Absence is a terminal answer, not a transient refusal to retry.
    expect(verify).toHaveBeenCalledTimes(1);
    expect(coverage).toEqual([
      {
        status: "complete",
        limitations: [
          expect.stringMatching(
            /no stored checksum .* integrity was not verified/u,
          ),
        ],
      },
    ]);
    expect(
      reader
        .provenance()
        .map(({ arguments: [operation], exit_code }) => [operation, exit_code]),
    ).toEqual([
      ["verify", 1],
      ["attach", 0],
    ]);
    await reader.close();
    expect(state.attached).toBe(false);
  });
});

describe("native DMG real verification diagnostics", () => {
  it.skipIf(process.platform !== "darwin")(
    "classifies a real hdiutil verify refusal as a format failure with captured output",
    async () => {
      const root = await createTestTempDirectory("rea-invalid-dmg-");
      const path = join(root, "invalid.dmg");
      await writeFile(path, "This is not a disk image.\n");
      const failure = await createAttachedReader(path, process.env).catch(
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(ArtifactReaderFailure);
      if (!(failure instanceof ArtifactReaderFailure)) return;
      // Only English output establishes the cause; a localized reason for a
      // readable target stays unknown (see the localized diagnostics suite).
      expect(failure.reason).toBe(
        /verify failed - image not recogni[sz]ed/u.test(failure.message)
          ? "format"
          : "unavailable",
      );
      expect(failure.message).toContain('"command":"/usr/bin/hdiutil"');
      expect(failure.message).toContain('"arguments":["verify"');
      expect(failure.message).toContain('"exitCode":1');
      expect(failure.message).toContain('"stdout":""');
      expect(failure.message).toContain('"stderr":"');
    },
  );

  it.skipIf(process.platform !== "darwin" || process.getuid?.() === 0)(
    "classifies real hdiutil target access failures as I/O, separately from malformed images",
    async () => {
      const root = await createTestTempDirectory("rea-dmg-target-errors-");
      const missingPath = join(root, "missing.dmg");
      const unreadablePath = join(root, "unreadable.dmg");
      await writeFile(unreadablePath, "not a disk image\n");
      await chmod(unreadablePath, 0);
      try {
        for (const path of [missingPath, unreadablePath]) {
          // hdiutil localizes the errno text, but not its own status line.
          const expectedDiagnostic = `hdiutil: verify: unable to recognize ${JSON.stringify(path)} as a disk image.`;
          const failure = await createAttachedReader(path, process.env).catch(
            (cause: unknown) => cause,
          );
          expect(failure).toBeInstanceOf(ArtifactReaderFailure);
          if (!(failure instanceof ArtifactReaderFailure)) continue;
          expect(failure.reason).toBe("io");
          expect(failure.message).toContain('"command":"/usr/bin/hdiutil"');
          expect(failure.message).toContain('"arguments":["verify"');
          expect(failure.message).toContain('"exitCode":1');
          expect(failure.message).toContain('"stdout":""');
          expect(failure.message).toContain("unable to recognize");
          expect(failure.cause).toBeInstanceOf(Error);
          if (!(failure.cause instanceof Error)) continue;
          expect(Reflect.get(failure.cause, "code")).toBe(1);
          expect(Reflect.get(failure.cause, "stderr")).toContain(
            expectedDiagnostic,
          );
        }
      } finally {
        await chmod(unreadablePath, 0o600);
      }
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "classifies a checksum mismatch in an hdiutil-created DMG as an integrity failure",
    async () => {
      const root = await createTestTempDirectory(
        "rea-dmg-checksum-corruption-",
      );
      const writableImagePath = join(root, "writable.dmg");
      const imagePath = join(root, "fixture.dmg");
      await execFileOutput("/usr/bin/hdiutil", [
        "create",
        "-quiet",
        "-size",
        "1m",
        "-layout",
        "NONE",
        "-type",
        "UDIF",
        writableImagePath,
      ]);
      await execFileOutput("/usr/bin/hdiutil", [
        "convert",
        "-quiet",
        writableImagePath,
        "-format",
        "UDRO",
        "-o",
        imagePath,
      ]);
      const valid = await execFileOutput("/usr/bin/hdiutil", [
        "verify",
        imagePath,
      ]);
      expect(valid.stderr).toContain("is VALID");

      const image = await readFile(imagePath);
      const footer = image.subarray(-512);
      expect(footer.subarray(0, 4).toString("ascii")).toBe("koly");
      const dataForkOffset = Number(footer.readBigUInt64BE(24));
      const dataForkLength = Number(footer.readBigUInt64BE(32));
      expect(dataForkLength).toBeGreaterThan(4096);
      const corruptionOffset = dataForkOffset + 4096;
      expect(corruptionOffset).toBeLessThan(dataForkOffset + dataForkLength);
      const originalByte = image[corruptionOffset];
      if (originalByte === undefined)
        throw new Error("expected a byte in the generated image data fork");
      image[corruptionOffset] = originalByte ^ 0x01;
      await writeFile(imagePath, image);

      const failure = await createAttachedReader(imagePath, process.env).catch(
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(ArtifactReaderFailure);
      if (!(failure instanceof ArtifactReaderFailure)) return;
      expect(failure.reason).toBe("integrity");
      expect(failure.message).toContain('"command":"/usr/bin/hdiutil"');
      expect(failure.message).toContain('"arguments":["verify"');
      expect(failure.message).toContain('"exitCode":1');
      // hdiutil localizes the CRC labels and failure reason, but not this status line.
      expect(failure.message).toContain("CRC32");
      expect(failure.message).toContain("is INVALID");
      expect(failure.cause).toBeInstanceOf(Error);
      if (!(failure.cause instanceof Error)) return;
      expect(Reflect.get(failure.cause, "code")).toBe(1);
      expect(Reflect.get(failure.cause, "stderr")).toContain("is INVALID");
    },
    60_000,
  );
});

it("owns the canonical mount root and detaches each observed whole image once", async () => {
  const calls: string[][] = [];
  const mount = createMountFixture();
  let attached = false;
  let mountPoint: string | undefined;
  const host: NativeDmgHost = {
    async run(arguments_) {
      calls.push([...arguments_]);
      if (arguments_[0] === "info")
        return {
          stdout:
            !attached || mountPoint === undefined
              ? emptyInfoPlist
              : infoPlist("/tmp/image.dmg", [
                  { "dev-entry": "/dev/disk41" },
                  { "dev-entry": "/dev/disk41s1" },
                  { "dev-entry": "/dev/disk41s2", "mount-point": mountPoint },
                  { "dev-entry": "/dev/disk42" },
                  { "dev-entry": "/dev/disk42s1" },
                ]),
          exitCode: 0,
        };
      if (arguments_[0] === "detach") {
        attached = false;
        return { stdout: "", exitCode: 0 };
      }
      if (arguments_[0] !== "attach") return { stdout: "", exitCode: 0 };
      const mounted = await mount.createVolume(arguments_, "hello");
      expect(mounted.mountRoot).toBe(await realpath(mounted.mountRoot));
      mountPoint = mounted.mountPoint;
      attached = true;
      return {
        stdout: attachPlist([
          { "dev-entry": "/dev/disk41" },
          { "dev-entry": "/dev/disk41s1" },
          { "dev-entry": "/dev/disk41s2", "mount-point": mountPoint },
          { "dev-entry": "/dev/disk42" },
          { "dev-entry": "/dev/disk42s1" },
        ]),
        exitCode: 0,
      };
    },
  };
  const reader = await createAttachedReader(
    "/tmp/image.dmg",
    process.env,
    undefined,
    host,
  );
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry.path);
    expect(entries).toContain("image.dmg/Fixture/hello.txt");
  } finally {
    await reader.close();
  }
  expect(calls.filter((call) => call[0] === "detach")).toEqual([
    ["detach", "/dev/disk42"],
    ["detach", "/dev/disk41"],
  ]);
});

// hdiutil reports the image disk and synthesized APFS container separately;
// detaching the container can already eject the image disk.
const apfsHost = (
  stillListed: readonly string[],
  listedInfoReads = Infinity,
) => {
  const calls: string[][] = [];
  let infoReads = 0;
  const mount = createMountFixture();
  let mountPoint: string | undefined;
  let attached = false;
  const host: NativeDmgHost = {
    delay: () => Promise.resolve(),
    async run(arguments_) {
      calls.push([...arguments_]);
      if (arguments_[0] === "detach" && arguments_[1] === "/dev/disk4")
        throw new Error("hdiutil: detach failed - No such file or directory");
      if (arguments_[0] === "info")
        return {
          stdout: build({
            images: !attached
              ? []
              : infoReads++ === 0
                ? [
                    {
                      "image-path": "/tmp/image.dmg",
                      "system-entities": [
                        { "dev-entry": "/dev/disk4" },
                        { "dev-entry": "/dev/disk4s1" },
                        {
                          "dev-entry": "/dev/disk5s1",
                          ...(mountPoint === undefined
                            ? {}
                            : { "mount-point": mountPoint }),
                        },
                        { "dev-entry": "/dev/disk5" },
                      ],
                    },
                  ]
                : stillListed.length === 0 || infoReads > listedInfoReads + 1
                  ? []
                  : [
                      {
                        "image-path": "/tmp/image.dmg",
                        "system-entities": stillListed.map((device) => ({
                          "dev-entry": device,
                        })),
                      },
                    ],
          }),
          exitCode: 0,
        };
      if (arguments_[0] !== "attach") return { stdout: "", exitCode: 0 };
      ({ mountPoint } = await mount.createVolume(arguments_));
      attached = true;
      return {
        stdout: attachPlist([
          { "dev-entry": "/dev/disk4" },
          { "dev-entry": "/dev/disk4s1" },
          { "dev-entry": "/dev/disk5s1", "mount-point": mountPoint },
          { "dev-entry": "/dev/disk5" },
        ]),
        exitCode: 0,
      };
    },
  };
  return { calls, host };
};

// One mounted device whose detach reports busy while `busy(attempt)` holds.
const singleDeviceHost = (busy: (attempt: number) => boolean) => {
  const mount = createMountFixture();
  const state = {
    attached: false,
    attempts: 0,
    mountRoot: undefined as string | undefined,
    waits: [] as number[],
  };
  const host: NativeDmgHost = {
    delay: (milliseconds) => {
      state.waits.push(milliseconds);
      return Promise.resolve();
    },
    async run(args) {
      if (args[0] === "attach") {
        const mounted = await mount.createVolume(args, "owned observation");
        state.mountRoot = mounted.mountRoot;
        state.attached = true;
        return {
          stdout: attachPlist([
            { "dev-entry": "/dev/disk7", "mount-point": mounted.mountPoint },
          ]),
          exitCode: 0,
        };
      }
      if (args[0] === "info")
        return {
          stdout: state.attached
            ? infoPlist("/tmp/image.dmg", [
                {
                  "dev-entry": "/dev/disk7",
                  "mount-point": join(state.mountRoot ?? "", "Fixture"),
                },
              ])
            : emptyInfoPlist,
          exitCode: 0,
        };
      if (args[0] === "detach") {
        state.attempts += 1;
        if (busy(state.attempts))
          return {
            stdout: "",
            stderr: "hdiutil: detach failed - Resource busy",
            exitCode: 16,
          };
        state.attached = false;
      }
      return { stdout: "", exitCode: 0 };
    },
  };
  return { host, state };
};

/** Close an APFS fixture and return the cleanup-phase hdiutil calls. */
const closeApfsFixture = async (
  ...listing: Parameters<typeof apfsHost>
): Promise<{
  readonly reader: NativeDmgArtifactReader;
  readonly cleanup: readonly string[][];
}> => {
  const { calls, host } = apfsHost(...listing);
  const reader = await createAttachedReader(
    "/tmp/image.dmg",
    process.env,
    undefined,
    host,
  );
  await reader.close();
  return {
    reader,
    cleanup: calls
      .slice(calls.findIndex((call) => call[0] === "attach") + 1)
      .slice(1),
  };
};

describe("APFS disk image detach", () => {
  it("accepts an image disk that its container detach already ejected", async () => {
    const { reader, cleanup } = await closeApfsFixture([]);
    expect(cleanup).toEqual([
      ["detach", "/dev/disk5"],
      ["detach", "/dev/disk4"],
      ["info", "-plist"],
    ]);
    expect(reader.provenance().map(({ arguments: args }) => args[0])).toEqual([
      "verify",
      "attach",
      "detach",
    ]);
  });

  it("still fails when the device that rejected detach remains attached", async () => {
    const { host } = apfsHost(["/dev/disk4", "/dev/disk4s1"]);
    const reader = await createAttachedReader(
      "/tmp/image.dmg",
      process.env,
      undefined,
      host,
    );
    await expect(reader.close()).rejects.toMatchObject({
      reason: "unavailable",
      message: expect.stringContaining("No such file or directory"),
      cleanup: {
        resources: expect.arrayContaining([
          "DMG device /dev/disk4",
          expect.stringMatching(/^DMG mount root /u),
        ]),
      },
    });
  });

  it("retains a failed attachment and its mount root until a later close detaches it", async () => {
    let busy = true;
    const { host, state } = singleDeviceHost(() => busy);
    const reader = await createAttachedReader(
      "/tmp/image.dmg",
      process.env,
      undefined,
      host,
    );
    await expect(reader.close()).rejects.toMatchObject({
      reason: "unavailable",
    });
    const { mountRoot } = state;
    if (mountRoot === undefined) throw new Error("missing owned mount root");
    expect
      .soft(
        await readFile(join(mountRoot, "Fixture", "hello.txt"), "utf8").catch(
          () => undefined,
        ),
      )
      .toBe("owned observation");
    busy = false;
    await reader.close();
    expect.soft(state.attached).toBe(false);
    await expect(
      readFile(join(mountRoot, "Fixture", "hello.txt")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("DMG detach recheck", () => {
  it("accepts an ejected device that hdiutil listed once more after its failed detach", async () => {
    const { cleanup } = await closeApfsFixture(
      ["/dev/disk4", "/dev/disk4s1"],
      1,
    );
    expect(cleanup).toEqual([
      ["detach", "/dev/disk5"],
      ["detach", "/dev/disk4"],
      ["info", "-plist"],
      ["info", "-plist"],
    ]);
  });

  it("detaches a device that was busy on its first attempt within one close", async () => {
    const { host, state } = singleDeviceHost((attempt) => attempt === 1);
    const reader = await createAttachedReader(
      "/tmp/image.dmg",
      process.env,
      undefined,
      host,
    );
    await reader.close();
    expect(state).toMatchObject({
      attempts: 2,
      attached: false,
      waits: [250],
    });
    if (state.mountRoot === undefined)
      throw new Error("missing owned mount root");
    await expect(
      readFile(join(state.mountRoot, "Fixture", "hello.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
