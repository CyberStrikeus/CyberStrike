import { readFile } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";

import { saveVerifierCommandOutput } from "../../../scripts/lib/verifier-command-output.mjs";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const workspaces: string[] = [];
afterEach(async () => {
  for (const root of workspaces.splice(0)) await removeTestWorkspace(root);
});

const createOutputWorkspace = async () => {
  const workspace = await createTestWorkspace("rea-verifier-command-output-");
  workspaces.push(workspace.root);
  return workspace;
};

const rejection = (operation: Promise<unknown>): Promise<unknown> =>
  operation.then(
    () => {
      throw new Error("Expected command output persistence to reject");
    },
    (cause: unknown) => cause,
  );

it("writes exact Unicode and empty output bytes and returns the original output", async () => {
  const workspace = await createOutputWorkspace();
  const paths = {
    stdout: workspace.path("stdout"),
    stderr: workspace.path("stderr"),
  };
  const output = { stdout: "observed α测试\0\n", stderr: "" };

  expect(await saveVerifierCommandOutput(async () => output, paths)).toBe(
    output,
  );
  expect(
    Buffer.compare(await readFile(paths.stdout), Buffer.from(output.stdout)),
  ).toBe(0);
  expect(Buffer.compare(await readFile(paths.stderr), Buffer.alloc(0))).toBe(0);
});

it("retains both failed-command streams while preserving its exact cause", async () => {
  const workspace = await createOutputWorkspace();
  const paths = {
    stdout: workspace.path("stdout"),
    stderr: workspace.path("stderr"),
  };
  const cause = Object.assign(new Error("selected command failed"), {
    snapshot: {
      stdout: { text: "" },
      stderr: { text: "partial diagnostics α测试\n" },
    },
  });

  await expect(
    saveVerifierCommandOutput(async () => {
      throw cause;
    }, paths),
  ).rejects.toBe(cause);
  expect(Buffer.compare(await readFile(paths.stdout), Buffer.alloc(0))).toBe(0);
  expect(
    Buffer.compare(
      await readFile(paths.stderr),
      Buffer.from(cause.snapshot.stderr.text),
    ),
  ).toBe(0);
});

it("writes available partial failure output without replacing unavailable evidence", async () => {
  const workspace = await createOutputWorkspace();
  const original = Buffer.from("retained caller output\0\n");
  const paths = {
    stdout: await workspace.write("stdout", original),
    stderr: workspace.path("stderr"),
  };
  const cause = {
    snapshot: {
      stdout: { text: null },
      stderr: { text: "available failure diagnostics\n" },
    },
  };

  await expect(
    saveVerifierCommandOutput(async () => {
      throw cause;
    }, paths),
  ).rejects.toBe(cause);
  expect(Buffer.compare(await readFile(paths.stdout), original)).toBe(0);
  expect(await readFile(paths.stderr, "utf8")).toBe(cause.snapshot.stderr.text);
});

it.each([undefined, null])(
  "preserves the opaque %s failure and both existing output artifacts",
  async (cause) => {
    const workspace = await createOutputWorkspace();
    const paths = {
      stdout: await workspace.write("stdout", "retained stdout\n"),
      stderr: await workspace.write("stderr", "retained stderr\n"),
    };

    await expect(
      saveVerifierCommandOutput(async () => {
        throw cause;
      }, paths),
    ).rejects.toBe(cause);
    expect(await readFile(paths.stdout, "utf8")).toBe("retained stdout\n");
    expect(await readFile(paths.stderr, "utf8")).toBe("retained stderr\n");
  },
);

it.skipIf(process.platform === "win32")(
  "retains the command cause and actual stdout write failure while writing stderr",
  async () => {
    const workspace = await createOutputWorkspace();
    const paths = {
      stdout: await workspace.mkdir("stdout-directory"),
      stderr: workspace.path("stderr"),
    };
    const cause = Object.assign(new Error("primary command failure"), {
      snapshot: {
        stdout: { text: "command stdout" },
        stderr: { text: "command stderr\n" },
      },
    });

    const failure = await rejection(
      saveVerifierCommandOutput(async () => {
        throw cause;
      }, paths),
    );
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw failure;
    expect(failure.cause).toBe(cause);
    expect(failure.errors).toHaveLength(2);
    expect(failure.errors[0]).toBe(cause);
    expect(failure.errors[1]).toMatchObject({
      code: "EISDIR",
      path: paths.stdout,
    });
    expect(await readFile(paths.stderr, "utf8")).toBe(
      cause.snapshot.stderr.text,
    );
  },
);

it.skipIf(process.platform === "win32")(
  "attempts stderr persistence after a successful command's stdout write fails",
  async () => {
    const workspace = await createOutputWorkspace();
    const paths = {
      stdout: await workspace.mkdir("stdout-directory"),
      stderr: workspace.path("stderr"),
    };
    const output = {
      stdout: "successful stdout",
      stderr: "successful stderr\n",
    };

    const failure = await rejection(
      saveVerifierCommandOutput(async () => output, paths),
    );
    expect(failure).not.toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      code: "EISDIR",
      path: paths.stdout,
    });
    expect(await readFile(paths.stderr, "utf8")).toBe(output.stderr);
  },
);

it.skipIf(process.platform === "win32")(
  "retains both independent filesystem errors when neither output can be written",
  async () => {
    const workspace = await createOutputWorkspace();
    const paths = {
      stdout: await workspace.mkdir("stdout-directory"),
      stderr: await workspace.mkdir("stderr-directory"),
    };

    const failure = await rejection(
      saveVerifierCommandOutput(
        async () => ({ stdout: "stdout", stderr: "stderr" }),
        paths,
      ),
    );
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw failure;
    expect(failure.errors).toHaveLength(2);
    expect(failure.errors[0]).toMatchObject({
      code: "EISDIR",
      path: paths.stdout,
    });
    expect(failure.errors[1]).toMatchObject({
      code: "EISDIR",
      path: paths.stderr,
    });
    expect(failure.cause).toBe(failure.errors[0]);
  },
);
