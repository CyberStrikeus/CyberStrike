import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { buildNativeAotFixture } from "../../../scripts/lib/nativeaot-build.mjs";

const options = {
  dotnet: "dotnet",
  project: "fixture.csproj",
  runtime: "win-x64",
  output: "fixture-output",
};

it("restores the exact publish target before compiling without network restore", async () => {
  const run = vi.fn<(command: string, args: string[]) => void>();
  await buildNativeAotFixture(run, options);
  expect(run).toHaveBeenCalledTimes(2);
  const restore = run.mock.calls[0]?.[1] ?? [];
  const publish = run.mock.calls[1]?.[1] ?? [];
  expect(restore[0]).toBe("restore");
  expect(publish[0]).toBe("publish");
  expect(publish).toContain("--no-restore");
  for (const argument of [
    options.project,
    options.runtime,
    "-p:Configuration=Release",
    `-p:BaseIntermediateOutputPath=${join(options.output, "obj")}/`,
  ]) {
    expect(restore).toContain(argument);
    expect(publish).toContain(argument);
  }
});

it("retries without logging credential-bearing restore diagnostics", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const timeout = Object.assign(
    new Error(
      "dotnet restore ETIMEDOUT https://fixture-user:fixture-password@feed.invalid/v3/index.json",
    ),
    {
      code: "ETIMEDOUT",
    },
  );
  const run = vi
    .fn<(command: string, args: string[]) => void>()
    .mockImplementationOnce(() => {
      throw timeout;
    });
  try {
    await buildNativeAotFixture(run, options);
    expect(
      logged.mock.calls.flat().every((value) => typeof value === "string"),
    ).toBe(true);
    expect(logged.mock.calls.flat().join("\n")).not.toContain(
      "fixture-password",
    );
  } finally {
    logged.mockRestore();
  }
  expect(run.mock.calls.map((call) => call[1][0])).toEqual([
    "restore",
    "restore",
    "publish",
  ]);
});

it("stops after two restore failures and preserves the final diagnostic", async () => {
  const failure = new Error("NuGet source unavailable");
  const run = vi.fn<(command: string, args: string[]) => void>(() => {
    throw failure;
  });
  await expect(buildNativeAotFixture(run, options)).rejects.toMatchObject({
    message: "NativeAOT dependency restore failed after two attempts",
    cause: failure,
  });
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls.every((call) => call[1][0] === "restore")).toBe(true);
});

it("does not retry compilation failures", async () => {
  const failure = new Error("Native compiler rejected the fixture");
  const run = vi
    .fn<(command: string, args: string[]) => void>()
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(() => {
      throw failure;
    });
  await expect(buildNativeAotFixture(run, options)).rejects.toBe(failure);
  expect(run).toHaveBeenCalledTimes(2);
});
