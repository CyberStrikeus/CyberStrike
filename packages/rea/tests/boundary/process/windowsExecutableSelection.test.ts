import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

processTest.skipIf(process.platform !== "win32")(
  "pins default ADB, Apktool and update launches to the selected Windows PATH",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-windows-tool-selection-");
    const working = join(root, "project");
    const trusted = join(root, "selected tools");
    const marker = join(root, "selected-update.txt");
    const recorder = join(root, "record-update.cjs");
    await writeFile(
      recorder,
      `
      const [selection, marker, ...arguments_] = process.argv.slice(2);
      require('node:fs').appendFileSync(marker, JSON.stringify([selection, ...arguments_]) + '\\n');
      process.stdout.write(selection);
    `,
    );
    await Promise.all([mkdir(working), mkdir(trusted)]);
    for (const directory of [working, trusted]) {
      await copyFile(process.execPath, join(directory, "adb.exe"));
      await writeFile(join(directory, "apktool.cmd"), "@echo 2.12.1\r\n");
      await writeFile(
        join(directory, "npm.cmd"),
        `@"${process.execPath}" "${recorder}" "${directory === trusted ? "selected" : "cwd"}" "${marker}" %*\r\n`,
      );
    }
    const moduleUrl = (name: string) =>
      JSON.stringify(new URL(`../../../dist/${name}.js`, import.meta.url).href);
    const program = `
      import assert from 'node:assert/strict';
      import { resolveAdbBinary } from ${moduleUrl("adb/AdbConfiguration")};
      import { resolveApktoolCommand, inspectApktoolClient } from ${moduleUrl("apktool/ApktoolConfiguration")};
      import { ApktoolCommandCleanup } from ${moduleUrl("apktool/ApktoolCommandCleanup")};
      import { execFileOutput } from ${moduleUrl("process/ExecFileOutput")};
      import { UpdateCommandRunner } from ${moduleUrl("application/UpdateCommandRunner")};
      const environment = { ...process.env };
      for (const key of Object.keys(environment))
        if (['path', 'pathext', 'nodefaultcurrentdirectoryinexepath', 'rea_adb_path', 'rea_apktool_command'].includes(key.toLowerCase())) delete environment[key];
      environment.Path = ${JSON.stringify(trusted)};
      environment.PathExt = '.EXE;.CMD';
      const adb = await resolveAdbBinary(environment);
      assert.equal(adb.binary.toLowerCase(), ${JSON.stringify(join(trusted, "adb.exe").toLowerCase())});
      const native = await execFileOutput(adb.binary, ['-e', 'process.stdout.write(process.execPath)'], { env: adb.environment, timeout: 5000 });
      assert.equal(native.stdout.toLowerCase(), adb.binary.toLowerCase());
      const apktool = await resolveApktoolCommand(environment);
      assert.equal(apktool.command.toLowerCase(), ${JSON.stringify(join(trusted, "apktool.cmd").toLowerCase())});
      const apktoolCommands = new ApktoolCommandCleanup();
      try { assert.equal((await inspectApktoolClient(apktool, apktoolCommands, { environment })).version, '2.12.1'); }
      finally { await apktoolCommands.close(); }
      const runner = new UpdateCommandRunner();
      try {
        assert.deepEqual(await runner.runProbe(['npm', 'prefix', '--global'], environment), { ok: true, value: 'selected' });
        assert.deepEqual(await runner.runInstall(['npm', 'install', '--global', 'fixture@0.0.0'], environment, 'structured'), { ok: true, value: '' });
        const missing = { ...environment, Path: '' };
        await assert.rejects(resolveAdbBinary(missing), { code: 'binary_missing' });
        await assert.rejects(resolveApktoolCommand(missing), { code: 'command_missing' });
        assert.equal((await runner.runProbe(['npm', 'prefix'], missing)).ok, false);
        // A caller who explicitly includes '.' still selects that directory.
        const explicit = { ...environment, Path: '.' };
        assert.equal((await resolveAdbBinary(explicit)).binary.toLowerCase(), ${JSON.stringify(join(working, "adb.exe").toLowerCase())});
        assert.equal((await resolveApktoolCommand(explicit)).command.toLowerCase(), ${JSON.stringify(join(working, "apktool.cmd").toLowerCase())});
        assert.deepEqual(await runner.runProbe(['npm', 'prefix'], explicit), { ok: true, value: 'cwd' });
      } finally { await runner.close(); }
      process.stdout.write('verified');
    `;
    const result = await processes.run(
      process.execPath,
      ["--input-type=module", "--eval", program],
      {
        cwd: working,
        timeoutMs: 30_000,
        windowsHide: true,
      },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("verified");
    expect(
      (await readFile(marker, "utf8"))
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    ).toEqual([
      ["selected", "prefix", "--global"],
      ["selected", "install", "--global", "fixture@0.0.0"],
      ["cwd", "prefix"],
    ]);
  },
);

processTest.skipIf(process.platform !== "win32")(
  "runs real npm update metadata probes from a project containing an npm launcher",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-windows-real-npm-");
    const marker = join(root, "project-launcher.txt");
    await writeFile(
      join(root, "npm.cmd"),
      `@echo cwd>"${marker}"\r\n@echo cwd\r\n`,
    );
    const runnerUrl = JSON.stringify(
      new URL(
        "../../../dist/application/UpdateCommandRunner.js",
        import.meta.url,
      ).href,
    );
    const program = `
      import assert from 'node:assert/strict';
      import { isAbsolute } from 'node:path';
      import { UpdateCommandRunner } from ${runnerUrl};
      const environment = { ...process.env };
      for (const key of Object.keys(environment))
        if (key.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete environment[key];
      const runner = new UpdateCommandRunner();
      try {
        const version = await runner.runProbe(['npm', '--version'], environment);
        assert.equal(version.ok, true, JSON.stringify(version));
        assert.match(version.value, /^\\d+\\.\\d+\\.\\d+$/);
        for (const query of ['root', 'prefix']) {
          const result = await runner.runProbe(['npm', query, '--global'], environment);
          assert.equal(result.ok, true, JSON.stringify(result));
          assert.equal(isAbsolute(result.value), true, JSON.stringify(result));
        }
      } finally { await runner.close(); }
      process.stdout.write('verified-real-npm');
    `;
    const result = await processes.run(
      process.execPath,
      ["--input-type=module", "--eval", program],
      {
        cwd: root,
        timeoutMs: 40_000,
        windowsHide: true,
      },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("verified-real-npm");
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
