import { requirePermissionDenial } from "../../tests/fixtures/permissionDenial.js";
import { execFile } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireHopperTargetLease,
  acquireLinuxHopperApplicationLease,
} from "../process/HopperLease.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const describePosix = describe.skipIf(process.platform === "win32");

describe.skipIf(process.platform === "win32")(
  "Hopper lease directory admission",
  () => {
    it("secures an existing owned directory without replacing it", async () => {
      const directory = await temporaryDirectory();
      await chmod(directory, 0o755);
      const before = await lstat(directory);
      const acquired = await acquireLinuxHopperApplicationLease({
        directory,
        runId: "permission-hardening",
      });
      if (!acquired.acquired)
        throw new Error("Expected the owned directory lease");
      try {
        const after = await lstat(directory);
        expect(after.dev).toBe(before.dev);
        expect(after.ino).toBe(before.ino);
        expect(after.mode & 0o777).toBe(0o700);
      } finally {
        await acquired.lease.release();
      }
    });

    it("rejects a directory symlink without changing its target", async () => {
      const directory = await temporaryDirectory();
      const realDirectory = join(directory, "actual");
      const alias = join(directory, "selected");
      await mkdir(realDirectory);
      await chmod(realDirectory, 0o755);
      await symlink(realDirectory, alias);
      await expect(
        acquireLinuxHopperApplicationLease({
          directory: alias,
          runId: "alias",
        }),
      ).rejects.toMatchObject({ _tag: "HopperStartError" });
      expect(await readdir(realDirectory)).toEqual([]);
      expect((await lstat(realDirectory)).mode & 0o777).toBe(0o755);
      expect((await lstat(alias)).isSymbolicLink()).toBe(true);
    });

    it.skipIf(process.platform === "win32")(
      "explains unreadable directory recovery without changing unverified permissions",
      async (context) => {
        await requirePermissionDenial(context, "directory-read");
        const directory = await temporaryDirectory();
        await chmod(directory, 0o333);
        try {
          await expect(
            acquireLinuxHopperApplicationLease({
              directory,
              runId: "unreadable",
            }),
          ).rejects.toMatchObject({
            _tag: "HopperStartError",
            cause: expect.objectContaining({ code: "EACCES" }),
            userMessage: expect.stringContaining(
              "restore owner-only read, write, and search permissions (0700)",
            ),
          });
          expect((await lstat(directory)).mode & 0o777).toBe(0o333);
          // This fixture owns the directory. Apply the documented recovery,
          // then exercise the same production acquisition again.
          await chmod(directory, 0o700);
          const recovered = await acquireLinuxHopperApplicationLease({
            directory,
            runId: "recovered-access",
          });
          if (!recovered.acquired) throw new Error("Expected recovered access");
          await recovered.lease.release();
          expect(await readdir(directory)).toEqual([]);
        } finally {
          await chmod(directory, 0o700);
        }
      },
    );
  },
);

describePosix("Hopper target leases", () => {
  it("reports the owning REA session for a duplicate target and profile", async () => {
    const directory = await temporaryDirectory();
    const targetPath = await temporaryTarget();
    const first = await acquireHopperTargetLease({
      ...leaseInput(targetPath),
      directory,
      runId: "session-first",
    });
    expect(first.acquired).toBe(true);
    if (!first.acquired) return;

    const duplicate = await acquireHopperTargetLease({
      ...leaseInput(targetPath),
      directory,
      runId: "session-second",
    });
    expect(duplicate).toMatchObject({
      acquired: false,
      owner: { runId: "session-first", processId: process.pid },
    });

    await first.lease.release();
    const reopened = await acquireHopperTargetLease({
      ...leaseInput(targetPath),
      directory,
      runId: "session-third",
    });
    expect(reopened.acquired).toBe(true);
    if (reopened.acquired) await reopened.lease.release();
  });

  it("keeps different Hopper profiles independent", async () => {
    const directory = await temporaryDirectory();
    const targetPath = await temporaryTarget();
    const first = await acquireHopperTargetLease({
      ...leaseInput(targetPath),
      directory,
      runId: "session-one",
    });
    const second = await acquireHopperTargetLease({
      ...leaseInput(targetPath),
      directory,
      loaderArgs: ["--aarch64"],
      runId: "session-two",
    });
    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(true);
    if (first.acquired) await first.lease.release();
    if (second.acquired) await second.lease.release();
  });

  it.skipIf(process.platform === "win32")(
    "shares one lease for symlink aliases of the same target",
    async () => {
      const directory = await temporaryDirectory();
      const targetPath = await temporaryTarget();
      const alias = join(dirname(targetPath), "sample-alias");
      await symlink(targetPath, alias);
      const first = await acquireHopperTargetLease({
        ...leaseInput(targetPath),
        directory,
        runId: "canonical-owner",
      });
      expect(first.acquired).toBe(true);
      if (!first.acquired) return;
      try {
        expect(
          await acquireHopperTargetLease({
            ...leaseInput(alias),
            directory,
            runId: "alias-request",
          }),
        ).toMatchObject({
          acquired: false,
          owner: { runId: "canonical-owner" },
        });
      } finally {
        await first.lease.release();
      }
    },
  );

  it.each(["missing", "not-directory"] as const)(
    "does not create a lease endpoint when target canonicalization fails for %s",
    async (failure) => {
      const directory = await temporaryDirectory();
      const parent = await temporaryDirectory();
      const targetPath =
        failure === "missing"
          ? join(parent, "missing-target")
          : join(await temporaryTarget(parent), "child");
      await expect(
        acquireHopperTargetLease({
          ...leaseInput(targetPath),
          directory,
          runId: "unresolvable-target",
        }),
      ).rejects.toMatchObject({
        _tag: "HopperStartError",
        userMessage: expect.stringContaining("canonical path"),
        cause: expect.objectContaining({
          code: failure === "missing" ? "ENOENT" : "ENOTDIR",
        }),
      });
      expect(await readdir(directory)).toEqual([]);
    },
  );
});

describePosix("Linux Hopper application leases", () => {
  it("reserves the shared application until its owner releases it", async () => {
    const directory = await temporaryDirectory();
    const first = await acquireLinuxHopperApplicationLease({
      directory,
      runId: "first",
    });
    expect(first.acquired).toBe(true);
    if (!first.acquired) return;
    try {
      expect(
        await acquireLinuxHopperApplicationLease({
          directory,
          runId: "second",
        }),
      ).toMatchObject({
        acquired: false,
        owner: { runId: "first", processId: process.pid },
      });
    } finally {
      await first.lease.release();
    }
    const reopened = await acquireLinuxHopperApplicationLease({
      directory,
      runId: "third",
    });
    expect(reopened.acquired).toBe(true);
    if (reopened.acquired) await reopened.lease.release();
  });

  it.each(["silent", "malformed", "invalid-pid", "closed"] as const)(
    "keeps a live endpoint when its owner response is %s",
    async (behavior) => {
      const directory = await temporaryDirectory();
      const socketPath = await releasedApplicationSocket(directory);
      let responsive = false;
      const sockets = new Set<Socket>();
      const owner = { runId: "existing-owner", processId: process.pid };
      const server = createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => undefined);
        if (responsive) socket.end(`${JSON.stringify(owner)}\n`);
        else if (behavior === "malformed") socket.end("not JSON\n");
        else if (behavior === "invalid-pid")
          socket.end('{"runId":"existing-owner","processId":-1}\n');
        else if (behavior === "closed") socket.end();
      });
      server.listen(socketPath);
      await once(server, "listening");
      try {
        await expect(
          acquireLinuxHopperApplicationLease({
            directory,
            runId: "new-owner",
          }),
        ).rejects.toMatchObject({
          _tag: "HopperStartError",
          userMessage: expect.stringContaining("left unchanged"),
        });
        expect((await lstat(socketPath)).isSocket()).toBe(true);
        responsive = true;
        expect(
          await acquireLinuxHopperApplicationLease({
            directory,
            runId: "retry",
          }),
        ).toEqual({
          acquired: false,
          owner,
        });
      } finally {
        for (const socket of sockets) socket.destroy();
        server.close();
        await once(server, "close");
      }
    },
  );

  it("preserves a Unicode owner identity split across socket writes", async () => {
    const directory = await temporaryDirectory();
    const socketPath = await releasedApplicationSocket(directory);
    const owner = { runId: "session-中文-🔬", processId: process.pid };
    const response = Buffer.from(`${JSON.stringify(owner)}\n`);
    const split = response.indexOf(Buffer.from("中")) + 1;
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => undefined);
      socket.write(response.subarray(0, split), () => {
        // Let the client consume the incomplete UTF-8 sequence before the tail.
        setImmediate(() =>
          setImmediate(() => socket.end(response.subarray(split))),
        );
      });
    });
    server.listen(socketPath);
    await once(server, "listening");
    try {
      expect(
        await acquireLinuxHopperApplicationLease({ directory, runId: "next" }),
      ).toEqual({ acquired: false, owner });
      expect((await lstat(socketPath)).isSocket()).toBe(true);
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, "close");
    }
  });

  it("recovers a socket left by a process that exited without releasing it", async () => {
    const directory = await temporaryDirectory();
    const socketPath = await releasedApplicationSocket(directory);
    await leaveStaleSocket(socketPath);
    expect((await lstat(socketPath)).isSocket()).toBe(true);
    const recovered = await acquireLinuxHopperApplicationLease({
      directory,
      runId: "recovered",
    });
    expect(recovered.acquired).toBe(true);
    if (recovered.acquired) await recovered.lease.release();
  });
});

it.skipIf(process.platform === "win32")(
  "leaves a stale socket unchanged while another process reserves its recovery",
  async () => {
    const directory = await temporaryDirectory();
    const socketPath = await releasedApplicationSocket(directory);
    await leaveStaleSocket(socketPath);
    const recoveryPath = `${socketPath}.recovery`;
    await mkdir(recoveryPath, { mode: 0o700 });
    const stale = await lstat(socketPath);
    await expect(
      acquireLinuxHopperApplicationLease({ directory, runId: "competing" }),
    ).rejects.toMatchObject({
      _tag: "HopperStartError",
      userMessage: expect.stringContaining(recoveryPath),
    });
    expect((await lstat(socketPath)).ino).toBe(stale.ino);
    await rmdir(recoveryPath);
    const recovered = await acquireLinuxHopperApplicationLease({
      directory,
      runId: "after-recovery",
    });
    expect(recovered.acquired).toBe(true);
    if (recovered.acquired) await recovered.lease.release();
    expect(await readdir(directory)).toEqual([]);
  },
);

const leaveStaleSocket = async (socketPath: string): Promise<void> => {
  await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "-e",
    'import {createServer} from "node:net"; createServer().listen(process.argv[1],()=>process.exit(0));',
    socketPath,
  ]);
};

const releasedApplicationSocket = async (
  directory: string,
): Promise<string> => {
  const initial = await acquireLinuxHopperApplicationLease({
    directory,
    runId: "initial",
  });
  if (!initial.acquired)
    throw new Error("Initial application lease was unavailable");
  const [name] = await readdir(directory);
  await initial.lease.release();
  if (name === undefined)
    throw new Error("Application lease did not create a socket");
  return join(directory, name);
};

const leaseInput = (targetPath: string) => ({
  targetPath,
  targetKind: "executable" as const,
  loaderArgs: [],
});

const temporaryTarget = async (parent?: string): Promise<string> => {
  const directory = parent ?? (await temporaryDirectory());
  const targetPath = join(directory, "sample-binary");
  await writeFile(targetPath, "admitted target bytes");
  return targetPath;
};

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join("/tmp", "rea-hl-"));
  directories.push(directory);
  return directory;
};
