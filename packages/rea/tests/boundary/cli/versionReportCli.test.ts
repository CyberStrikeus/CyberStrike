import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { versionReportSchema } from "../../../src/domain/versionReport.js";
import { SUPPORTED_NODE_VERSION_RANGE } from "../../../src/domain/runtimeVersion.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const packageSchema = z.object({ name: z.string(), version: z.string() });

cliTest(
  "reports version and runtime as a document only when a format is selected",
  async ({ cli }) => {
    const { name, version } = packageSchema.parse(
      JSON.parse(await readFile("package.json", "utf8")),
    );
    // Unique private values: the report must carry none of them. Literal
    // report values such as "node" or "linux" cannot collide with these.
    const marker = `rea-private-${randomUUID()}`;
    const cwd = await createTestTempDirectory(`${marker}-cwd-`);
    const home = join(cwd, `${marker}-home`);
    await mkdir(home);
    const environment = {
      HOME: home,
      USERPROFILE: home,
      REA_VERSION_REPORT_PRIVATE_MARKER: marker,
    };

    const json = await cli.run({
      arguments: ["--version", "--json"],
      cwd,
      environment,
    });
    expect(json.exitCode, json.stderr).toBe(0);
    // Piped JSON is one compact document.
    expect(json.stdout.trimEnd().split("\n")).toHaveLength(1);
    const report = versionReportSchema.parse(JSON.parse(json.stdout));
    expect(report).toEqual({
      name,
      version,
      runtime: { id: "node", version: process.versions.node },
      platform: process.platform,
      architecture: process.arch,
      supported_runtime: {
        range: SUPPORTED_NODE_VERSION_RANGE,
        satisfied: true,
      },
    });
    expect(json.stdout).not.toContain(marker);

    const jsonl = await cli.run({
      arguments: ["--version", "--format", "jsonl"],
      cwd,
      environment,
    });
    expect(jsonl.exitCode, jsonl.stderr).toBe(0);
    expect(jsonl.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(versionReportSchema.parse(JSON.parse(jsonl.stdout))).toEqual(report);

    const yaml = await cli.run({
      arguments: ["--version", "--format=yaml"],
      cwd,
    });
    expect(yaml.exitCode, yaml.stderr).toBe(0);
    expect(yaml.stdout).toContain(`version: ${version}`);
    expect(yaml.stdout).toContain(`architecture: ${process.arch}`);

    // Plain --version keeps the bare version string.
    const plain = await cli.run({ arguments: ["--version"], cwd });
    expect(plain.exitCode, plain.stderr).toBe(0);
    expect(plain.stdout).toBe(`${version}\n`);

    // Valid other output controls keep the plain version; invalid
    // combinations keep their existing output-flag error.
    const filtered = await cli.run({
      arguments: ["--version", "--json", "--filter-output", "version"],
      cwd,
    });
    expect(filtered.exitCode, filtered.stderr).toBe(0);
    expect(filtered.stdout).toBe(`${version}\n`);
    const windowed = await cli.run({
      arguments: ["--version", "--json", "--token-limit", "5"],
      cwd,
    });
    expect(windowed.exitCode).toBe(1);
    expect(windowed.json).toMatchObject({
      error: { code: "UNSUPPORTED_OUTPUT_COMBINATION" },
    });

    // Help keeps precedence over --version.
    const help = await cli.run({
      arguments: ["--version", "--json", "--help"],
      cwd,
    });
    expect(help.exitCode, help.stderr).toBe(0);
    expect(help.stdout).toContain("Usage: rea");
  },
);
