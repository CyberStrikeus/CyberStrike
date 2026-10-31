import { requirePermissionDenial } from "../../tests/fixtures/permissionDenial.js";
import {
  chmod,
  mkdir,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createIdaTarget,
  RecordingIdaMcp,
} from "../../tests/fixtures/idaMcp.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { IdaSessionClient } from "./IdaSessionClient.js";
import { IdaWorkspace } from "./IdaWorkspace.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await chmod(root, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});

const clientFor = (root: string, target: BinaryTarget) => {
  const producer = new RecordingIdaMcp(target, "headless");
  const client = new IdaSessionClient(
    {
      command: "fixture",
      args: [],
      env: {},
      mode: "headless",
      timeoutMs: 1000,
      workspaceRoot: root,
    },
    target,
    producer,
  );
  return { client, producer };
};

describe("IDA workspace ownership before input preparation", () => {
  it.skipIf(process.platform === "win32").each([
    ["missing", "ENOENT"],
    ["file", "ENOTDIR"],
  ] as const)(
    "retains the native %s-component failure as the workspace configuration cause",
    async (component, code) => {
      const { root, target } = await createIdaTarget();
      roots.push(root);
      const lexical = join(root, "workspace");
      await mkdir(lexical);
      if (component === "file")
        await writeFile(join(root, component), "not a directory");
      const selected = `${root}/${component}/../workspace`;
      await expect(
        IdaWorkspace.allocate(target, selected),
      ).rejects.toMatchObject({
        _tag: "ConfigurationError",
        cause: { code, path: selected },
        settings: [
          {
            setting: "workspaceRoot",
            constraint: expect.stringContaining(code),
          },
        ],
        diagnostics: { workspace_root: selected },
      });
      expect(await readdir(lexical)).toEqual([]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "allocates in the physical parent selected through a symlink and ..",
    async () => {
      const { root, target } = await createIdaTarget();
      roots.push(root);
      await mkdir(join(root, "physical", "inner"), { recursive: true });
      await mkdir(join(root, "physical", "workspace"));
      await mkdir(join(root, "workspace"));
      await symlink(join(root, "physical", "inner"), join(root, "link"));
      const selected = `${root}/link/../workspace`;
      for (const parent of [selected, await realpath(selected)]) {
        const workspace = await IdaWorkspace.allocate(target, parent);
        try {
          expect(dirname(workspace.directory)).toBe(await realpath(selected));
          expect(await readdir(join(root, "workspace"))).toEqual([]);
        } finally {
          await workspace.remove();
        }
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "opens the private input through a canonical path when the workspace root is a symlink",
    async () => {
      const { root, target } = await createIdaTarget();
      roots.push(root);
      const linked = join(
        await createTestTempDirectory("rea-ida-link-"),
        "root",
      );
      await symlink(root, linked);
      const { client, producer } = clientFor(linked, target);
      expect((await client.execute("health", {})).ok).toBe(true);
      const open = producer.calls.find(({ name }) => name === "idb_open");
      expect(
        String(open?.args.input_path).startsWith(`${await realpath(root)}/`),
      ).toBe(true);
      expect((await client.close()).ok).toBe(true);
    },
  );

  it("retains cleanup ownership when copying the admitted input fails", async () => {
    const { root, target } = await createIdaTarget();
    roots.push(root);
    await rm(target.path);
    const { client, producer } = clientFor(root, target);
    const failed = await client.execute("health", {});
    expect(failed.ok).toBe(false);
    if (!failed.ok)
      expect(failed.error.cause).toMatchObject({ code: "ENOENT" });
    expect(await readdir(root)).toHaveLength(1);
    expect(producer.calls.some(({ name }) => name === "idb_open")).toBe(false);
    expect((await client.close()).ok).toBe(true);
    expect(await readdir(root)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "preserves the input identity failure and retries workspace removal after permission recovery",
    async (context) => {
      await requirePermissionDenial(context, "directory-write");
      const { root, target } = await createIdaTarget();
      roots.push(root);
      const { client, producer } = clientFor(root, {
        ...target,
        sha256: "a".repeat(64),
      });
      const failed = await client.execute("health", {});
      expect(failed.ok).toBe(false);
      if (!failed.ok) expect(failed.error.message).toContain("target changed");
      const workspace = (await readdir(root)).find((name) =>
        name.startsWith("rea-ida-"),
      );
      expect(workspace).toBeDefined();
      expect(producer.calls.some(({ name }) => name === "idb_open")).toBe(
        false,
      );
      await chmod(root, 0o500);
      try {
        const closed = await client.close();
        expect(closed.ok).toBe(false);
        if (!closed.ok) {
          expect(closed.error.cleanupIncomplete).toBe(true);
          expect(closed.error.cleanupResources).toEqual([
            expect.stringContaining(workspace ?? "missing workspace"),
          ]);
          // No open was attempted, so there is no worker to report.
          expect(closed.error).not.toHaveProperty(
            "diagnostics.upstream_sessions",
          );
        }
        expect(producer.detaches).toBe(1);
      } finally {
        await chmod(root, 0o700);
      }
      expect((await client.close()).ok).toBe(true);
      expect(producer.detaches).toBe(1);
      expect(await readdir(root)).toEqual(["target.elf"]);
    },
  );
});

it("attributes an unusable workspace parent to workspaceRoot without opening a worker", async () => {
  const { root, target } = await createIdaTarget();
  roots.push(root);
  const { client, producer } = clientFor(join(root, "missing-parent"), target);
  const result = await client.execute("health", {});
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "ConfigurationError",
      settings: [
        {
          setting: "workspaceRoot",
          constraint: expect.stringContaining("ENOENT"),
        },
      ],
    },
  });
  expect(producer.calls.some(({ name }) => name === "idb_open")).toBe(false);
  expect((await client.close()).ok).toBe(true);
});
