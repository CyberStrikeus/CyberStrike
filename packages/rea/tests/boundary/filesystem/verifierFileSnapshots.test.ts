import {
  access,
  chmod,
  readFile,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createPackageVerifierCommands } from "../../../scripts/lib/verify-package-commands.mjs";
import {
  assertVerifierFilesUnchanged,
  captureVerifierFileSnapshot,
} from "../../../scripts/lib/verifier-file-snapshots.mjs";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import {
  verifyInteractiveSetup,
  verifyRedirectedStdoutSetup,
} from "../../../scripts/lib/verify-setup-terminal.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

const snapshotCommands = (root: string) =>
  createPackageVerifierCommands({
    workspace: { path: root, close: async () => {} },
  });

it("preserves selected path spelling, UTF-8 bytes and missing-file facts", async () => {
  const root = await createTestTempDirectory("rea-verifier-snapshot-");
  const path = `${root}/./selected file.json`;
  const missing = join(root, "missing file.json");
  const content = '\uFEFF{"label":"保留","value":"\\u0000"}\r\n';
  await writeFile(path, content);
  const commands = await snapshotCommands(root);
  const snapshot = await withVerifierCleanup(
    () => captureVerifierFileSnapshot(commands, [missing, path]),
    [() => commands.close()],
  );

  expect(snapshot).toEqual([
    { path: missing, exists: false, content: null },
    { path, exists: true, content: Buffer.from(content, "utf8") },
  ]);
  expect(
    Buffer.compare(await readFile(path), Buffer.from(content, "utf8")),
  ).toBe(0);
});

it("detects distinct invalid UTF-8 bytes in verifier file readback", async () => {
  const root = await createTestTempDirectory("rea-verifier-byte-readback-");
  const path = join(root, "selected.json");
  await writeFile(path, Buffer.from([0x80]));
  const commands = await snapshotCommands(root);
  const rejection = await withVerifierCleanup(async () => {
    const snapshot = await captureVerifierFileSnapshot(commands, [path]);
    await writeFile(path, Buffer.from([0x81]));
    return assertVerifierFilesUnchanged(commands, snapshot, "Setup").then(
      () => undefined,
      (cause: unknown) => cause,
    );
  }, [() => commands.close()]);

  expect(rejection).toBeInstanceOf(Error);
  expect(rejection).toHaveProperty("message", `Setup changed ${path}`);
});

it.each(["content", "removed", "created"] as const)(
  "detects a %s change after an unchanged readback",
  async (change) => {
    const root = await createTestTempDirectory("rea-verifier-readback-");
    const path = join(root, "selected.json");
    if (change !== "created") await writeFile(path, "original\n");
    const commands = await snapshotCommands(root);
    const rejection = await withVerifierCleanup(async () => {
      const snapshot = await captureVerifierFileSnapshot(commands, [path]);
      await assertVerifierFilesUnchanged(commands, snapshot, "Setup");
      if (change === "removed") await unlink(path);
      else await writeFile(path, "changed\n");
      return assertVerifierFilesUnchanged(commands, snapshot, "Setup").then(
        () => undefined,
        (cause: unknown) => cause,
      );
    }, [() => commands.close()]);

    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).toHaveProperty("message", `Setup changed ${path}`);
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a direct broken symlink instead of recording an absent file",
  async () => {
    const root = await createTestTempDirectory("rea-verifier-broken-link-");
    const path = join(root, "selected.json");
    await symlink(join(root, "missing-target.json"), path);
    const commands = await snapshotCommands(root);
    const rejection = await withVerifierCleanup(
      () =>
        captureVerifierFileSnapshot(commands, [path]).then(
          () => undefined,
          (cause: unknown) => cause,
        ),
      [() => commands.close()],
    );

    expect(rejection).toHaveProperty("code", "ENOENT");
  },
);

it.skipIf(process.platform === "win32").each([
  ["interactive", verifyInteractiveSetup],
  ["redirected stdout", verifyRedirectedStdoutSetup],
] as const)(
  "finishes the %s baseline before launching setup",
  async (_mode, verify) => {
    const root = await createTestTempDirectory("rea-verifier-setup-baseline-");
    const path = join(root, "selected.json");
    const marker = join(root, "launched");
    const command = join(root, "setup-command");
    await symlink(join(root, "missing-target.json"), path);
    await writeFile(
      command,
      '#!/bin/sh\nprintf launched > "$REA_SETUP_LAUNCH_MARKER"\n',
    );
    await chmod(command, 0o700);
    const commands = await snapshotCommands(root);
    const rejection = await withVerifierCleanup(
      () =>
        verify({
          commands,
          command,
          environment: { ...process.env, REA_SETUP_LAUNCH_MARKER: marker },
          root,
          unchangedPaths: [path],
        }).then(
          () => undefined,
          (cause: unknown) => cause,
        ),
      [() => commands.close()],
    );
    const launched = await access(marker).then(
      () => true,
      (cause: unknown) => {
        if (
          cause instanceof Error &&
          "code" in cause &&
          cause.code === "ENOENT"
        )
          return false;
        throw cause;
      },
    );

    expect(rejection).toHaveProperty("code", "ENOENT");
    expect(launched).toBe(false);
  },
);

processTest(
  "retains the exact failed file scope and directory until descriptor close is retried",
  async ({ processes }) => {
    const program = String.raw`
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import { access, writeFile } from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    import { join } from "node:path";
    import { tsImport } from "tsx/esm/api";
    import { createPackageVerifierCommands } from ${JSON.stringify(new URL("../../../scripts/lib/verify-package-commands.mjs", import.meta.url).href)};
    import { captureVerifierFileSnapshot } from ${JSON.stringify(new URL("../../../scripts/lib/verifier-file-snapshots.mjs", import.meta.url).href)};
    import { withVerifierCleanup } from ${JSON.stringify(new URL("../../../scripts/lib/verifier-cleanup.mjs", import.meta.url).href)};
    const { createTestWorkspace, removeTestWorkspace } = await tsImport(
      ${JSON.stringify(new URL("../../support/workspace/workspaceFixture.ts", import.meta.url).href)},
      ${JSON.stringify(import.meta.url)},
    );
    const workspace = await createTestWorkspace("rea-verifier-snapshot-owner-");
    const path = join(workspace.root, "input.json");
    const originalOpen = fs.promises.open;
    let commands;
    let handle;
    let realClose;
    let reads = 0;
    let contents;
    let attempts = 0;
    const scopes = [];
    const closeFailure = new Error("controlled real descriptor close failure");
    try {
      await writeFile(path, "source bytes\n");
      fs.promises.open = async (...arguments_) => {
        const opened = await originalOpen(...arguments_);
        if (arguments_[0] === path) {
          handle = opened;
          const close = opened.close.bind(opened);
          realClose = close;
          const read = opened.readFile.bind(opened);
          opened.readFile = async (...options) => {
            reads++;
            contents = await read(...options);
            return contents;
          };
          opened.close = async () => {
            attempts++;
            if (attempts === 1) throw closeFailure;
            await close();
          };
        }
        return opened;
      };
      syncBuiltinESMExports();
      commands = await createPackageVerifierCommands({
        workspace: { path: workspace.root, close: () => removeTestWorkspace(workspace.root) },
      });
      const adopt = commands.adopt.bind(commands);
      commands.adopt = (scope, resource) => {
        scopes.push(scope);
        adopt(scope, resource);
      };
      const observed = await withVerifierCleanup(async () => {
        const failure = await captureVerifierFileSnapshot(commands, [path]).then(
          () => undefined,
          error => error,
        );
        await access(workspace.root);
        return {
          failure,
          scope: scopes[0],
          retained: scopes[0]?.hasPending,
          descriptor: handle?.fd,
          attempts,
          reads,
          contents,
        };
      }, [() => commands.close()]);
      const directoryExists = await access(workspace.root).then(
        () => true,
        error => { if (error.code === "ENOENT") return false; throw error; },
      );
      assert.ok(observed.failure instanceof AggregateError);
      assert.equal(observed.failure.errors.length, 1);
      const retainedFailure = observed.failure.errors[0];
      assert.equal(scopes.length, 1);
      assert.equal(observed.retained, true);
      assert.ok(observed.descriptor >= 0);
      assert.equal(observed.attempts, 1);
      assert.equal(observed.reads, 1);
      assert.deepEqual(observed.contents, Buffer.from("source bytes\n"));
      assert.equal(retainedFailure.failedOwners[0].handle.handle, handle);
      assert.deepEqual(retainedFailure.cleanup.resources, [path]);
      assert.deepEqual(retainedFailure.cause.errors, [closeFailure]);
      assert.equal(observed.scope.hasPending, false);
      assert.equal(attempts, 2);
      assert.equal(handle.fd, -1);
      assert.equal(directoryExists, false);
      console.log(JSON.stringify({ exactHandleRetried: true, directoryReleasedAfterRetry: true }));
    } finally {
      fs.promises.open = originalOpen;
      syncBuiltinESMExports();
      if (handle !== undefined) handle.close = realClose;
      if (commands !== undefined) await commands.close();
      else await removeTestWorkspace(workspace.root);
    }
  `;
    const result = await processes.run(
      process.execPath,
      ["--input-type=module", "--eval", program],
      { timeoutMs: 20_000 },
    );

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.signal, result.stderr).toBeNull();
    expect(JSON.parse(result.stdout)).toEqual({
      exactHandleRetried: true,
      directoryReleasedAfterRetry: true,
    });
  },
);
