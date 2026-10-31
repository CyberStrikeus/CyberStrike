import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { expect } from "vitest";

import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "root update flag uses the verified workflow and preserves executable output policies",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-update-alias-");
    const bin = join(home, "bin");
    const script = join(home, "npm-fixture.mjs");
    const log = join(home, "commands.jsonl");
    await mkdir(bin);
    await writeFile(log, "");
    await writeFile(
      script,
      `
    import {appendFileSync} from 'node:fs';
    import {join} from 'node:path';
    const args=process.argv.slice(2);
    appendFileSync(process.env.REA_TEST_NPM_LOG, JSON.stringify(args)+'\\n');
    if(args[0]==='root') console.log(join(process.env.USERPROFILE,'unowned','node_modules'));
    else if(args[0]==='prefix') console.log(join(process.env.USERPROFILE,'unowned'));
    else if(args[0]==='view') {
      if(process.env.REA_TEST_NPM_FAILURE==='1') {process.stderr.write('owned fake registry denied');process.exitCode=2;}
      else if(process.env.REA_TEST_NPM_OVERSIZED==='1') process.stdout.write(JSON.stringify(${JSON.stringify(PRODUCT_IDENTITY.packageVersion)})+' '.repeat(4 * 1024 * 1024));
      else console.log(JSON.stringify(${JSON.stringify(PRODUCT_IDENTITY.packageVersion)}));
    } else {process.stderr.write('No installation or unexpected package-manager commands are allowed');process.exitCode=97;}
  `,
    );
    await writeFile(
      join(bin, process.platform === "win32" ? "npm.cmd" : "npm"),
      process.platform === "win32"
        ? '@echo off\r\n"%REA_TEST_NODE%" "%REA_TEST_NPM_SCRIPT%" %*\r\n'
        : '#!/bin/sh\nexec "$REA_TEST_NODE" "$REA_TEST_NPM_SCRIPT" "$@"\n',
      { mode: 0o700 },
    );
    const run = (
      arguments_: readonly string[],
      failure = false,
      oversized = false,
    ) =>
      cli.run({
        arguments: arguments_,
        cwd: home,
        timeoutMs: 20_000,
        environment: {
          USERPROFILE: home,
          PATH: [
            bin,
            ...(process.platform === "win32"
              ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32")]
              : ["/usr/bin", "/bin"]),
          ].join(delimiter),
          npm_config_prefix: join(home, "prefix"),
          npm_config_cache: join(home, "cache"),
          npm_config_user_agent: "npm/test",
          REA_TEST_NODE: process.execPath,
          REA_TEST_NPM_SCRIPT: script,
          REA_TEST_NPM_LOG: log,
          REA_TEST_NPM_FAILURE: failure ? "1" : "0",
          REA_TEST_NPM_OVERSIZED: oversized ? "1" : "0",
          CI: "1",
          NO_UPDATE_NOTIFIER: "1",
        },
      });
    const canonical = await run(["update", "--json"]);
    expect(canonical.exitCode, canonical.stderr).toBe(0);
    expect(canonical.json).toMatchObject({
      status: "current",
      currentVersion: PRODUCT_IDENTITY.packageVersion,
      latestVersion: PRODUCT_IDENTITY.packageVersion,
    });
    const alias = await run(["--json", "--update"]);
    expect(alias.exitCode, alias.stderr).toBe(0);
    expect(alias.json).toEqual(canonical.json);
    const filtered = await run([
      "--update",
      "--format=json",
      "--full-output",
      "--filter-output=status",
    ]);
    expect(filtered.exitCode, filtered.stderr).toBe(0);
    expect(filtered.json).toMatchObject({
      ok: true,
      data: "current",
      meta: { command: expect.stringContaining("update") },
    });
    const failed = await run(["--update", "--json"], true);
    expect(failed.exitCode).toBe(1);
    expect(failed.json).toMatchObject({
      status: "failed",
      reason: "version-check",
      remediation: expect.stringContaining("owned fake registry denied"),
    });
    const oversized = await run(["update", "--json"], false, true);
    expect(oversized.exitCode).toBe(1);
    expect(oversized.json).toMatchObject({
      status: "failed",
      reason: "version-check",
      remediation: expect.stringContaining("complete-output retention budget"),
    });
    const before = await readFile(log, "utf8");
    const ambiguous = await run(["providers", "--update", "--json"]);
    expect(ambiguous.exitCode).toBe(1);
    expect(ambiguous.json).toMatchObject({
      code: "UPDATE_FAILED",
      message: expect.stringContaining("rea update"),
    });
    expect(await readFile(log, "utf8")).toBe(before);
    const help = await run(["--update", "--help"]);
    expect(help.exitCode, help.stderr).toBe(0);
    expect(help.stdout).toContain("update");
    expect(await readFile(log, "utf8")).toBe(before);
    const commands: unknown[] = before
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(commands.length).toBeGreaterThan(0);
    expect(commands).toEqual(
      expect.arrayContaining([expect.arrayContaining(["view"])]),
    );
    for (const command of commands) expect(command).not.toContain("install");
  },
);
