import { access, chmod, copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { cliTest } from "../../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { analysisCliErrorEnvelopeSchema } from "../../../src/contracts/errorSchemas.js";

cliTest
  .skipIf(process.platform !== "linux")
  .for(["default-python-home", "missing-python-home"] as const)(
  "refuses an unauthenticated Hopper launcher through the public CLI before executing it (%s)",
  async (pythonHome, { cli }) => {
    const home = await createTestTempDirectory("rea-hopper-publisher-cli-");
    const launcher = join(home, "foreign-hopper");
    const target = join(home, "sample");
    const marker = join(home, "launched");
    await writeFile(
      launcher,
      '#!/bin/sh\nprintf launched > "$REA_HOPPER_TEST_MARKER"\nexit 99\n',
    );
    await chmod(launcher, 0o700);
    await copyFile("/usr/bin/true", target);
    const original = await readFile(target);
    const run = await cli.run({
      arguments: [
        "search",
        target,
        "fixture",
        "--provider",
        "hopper",
        "--kind",
        "strings",
        "--mode",
        "regex",
        "--json",
      ],
      environment: {
        HOME: home,
        TMPDIR: home,
        HOPPER_LAUNCHER_PATH: launcher,
        REA_HOPPER_TEST_MARKER: marker,
        REA_LOG_LEVEL: "silent",
        // Publisher rejection must not depend on the display probe's Python.
        ...(pythonHome === "missing-python-home"
          ? { PYTHONHOME: join(home, "missing-python-home") }
          : {}),
        // Reject deterministically without pretending to authenticate a build.
        NODE_OPTIONS: `--import=${new URL("../../fixtures/hopperRejectionFeed.mjs", import.meta.url).href}`,
      },
    });
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(1);
    expect(analysisCliErrorEnvelopeSchema.parse(run.json)).toMatchObject({
      code: "provider_unavailable",
      details: {
        stage: "launch",
        launch_rejection: {
          boundary: "publisher_verification",
          reason: "unsupported_hopper_build",
        },
      },
    });
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(Buffer.compare(await readFile(target), original)).toBe(0);
  },
);
