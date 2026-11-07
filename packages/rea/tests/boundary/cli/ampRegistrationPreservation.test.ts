import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeAmpRegistrationBackup } from "../../../src/cli/ampRegistrationBackup.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const ampSettings = (home: string) =>
  join(home, ".config", "amp", "settings.json");

cliTest(
  "mcp add preserves Amp environment and reports unreadable settings",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-amp-registration-");
    const home = join(root, "home");
    const environment = {
      HOME: home,
      USERPROFILE: home,
    };
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: [...arguments_, "--json"],
        cwd: root,
        environment,
        timeoutMs: 20_000,
      });

    // An existing rea registration keeps its environment map and the file is
    // backed up before the refresh.
    const settingsPath = ampSettings(home);
    const original = JSON.stringify(
      {
        "amp.mcpServers": {
          rea: {
            command: "npx",
            args: ["-y", "rea-agents@6.8.0", "mcp"],
            env: { KEEP_ME: "1" },
          },
          other: { command: "other" },
        },
        theme: "dark",
      },
      null,
      2,
    );
    await mkdir(join(home, ".config", "amp"), { recursive: true });
    await writeFile(settingsPath, original);

    const refreshed = await run(["mcp", "add", "--agent", "amp"]);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const after = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(after["amp.mcpServers"].rea).toMatchObject({
      command: expect.any(String),
      env: { KEEP_ME: "1" },
    });
    const registrationBackupPath = `${settingsPath}.rea.backup`;
    expect(await readFile(registrationBackupPath, "utf8")).toBe(original);
    expect(refreshed.stderr).toContain(registrationBackupPath);
    expect(after.theme).toBe("dark");

    // The equals form --agent=amp is parsed as a spaced form before Incur sees
    // it, so the Amp registration lands and keeps the environment map.
    const settingsBeforeEquals = await readFile(settingsPath, "utf8");
    const equals = await run(["mcp", "add", "--agent=amp"]);
    expect(equals.exitCode, equals.stderr).toBe(0);
    const afterEquals = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(afterEquals["amp.mcpServers"].rea).toMatchObject({
      command: expect.any(String),
      env: { KEEP_ME: "1" },
    });
    expect(await readFile(registrationBackupPath, "utf8")).toBe(original);
    const recoveryBackupPath = equals.stderr.match(
      /Amp MCP registration backup retained at (.+)/,
    )?.[1];
    expect(recoveryBackupPath).toContain(".recovery");
    if (recoveryBackupPath === undefined)
      throw new Error("Amp did not report the current recovery backup path.");
    expect(await readFile(recoveryBackupPath, "utf8")).toBe(
      settingsBeforeEquals,
    );

    // A malformed settings file is rejected instead of reporting success.
    const broken = join(root, "broken");
    const brokenSettings = ampSettings(broken);
    const malformed = '{ "amp.mcpServers": { "rea": {} ';
    await mkdir(join(broken, ".config", "amp"), { recursive: true });
    await writeFile(brokenSettings, malformed);
    const rejected = await cli.run({
      arguments: ["mcp", "add", "--agent", "amp", "--json"],
      cwd: root,
      environment: { HOME: broken, USERPROFILE: broken },
      timeoutMs: 20_000,
    });
    expect(rejected.exitCode, rejected.stderr).toBe(1);
    expect(rejected.json).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_value",
          missing: false,
          path: "amp",
        }),
      ]),
    });
    expect(await readFile(brokenSettings, "utf8")).toBe(malformed);

    // JSON null is valid JSON but not a settings object; reject it as a
    // validation error instead of letting property access throw.
    const nullHome = join(root, "null-settings");
    const nullSettings = ampSettings(nullHome);
    await mkdir(join(nullHome, ".config", "amp"), { recursive: true });
    await writeFile(nullSettings, "null\n");
    const nullRejected = await cli.run({
      arguments: ["mcp", "add", "--agent", "amp", "--json"],
      cwd: root,
      environment: { HOME: nullHome, USERPROFILE: nullHome },
      timeoutMs: 20_000,
    });
    expect(nullRejected.exitCode, nullRejected.stderr).toBe(1);
    expect(nullRejected.json).toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("must contain a JSON object"),
    });
    expect(await readFile(nullSettings, "utf8")).toBe("null\n");

    // An array-valued amp.mcpServers is rejected instead of claiming success.
    const arrayHome = join(root, "array");
    const arraySettings = ampSettings(arrayHome);
    const array = '{"amp.mcpServers": []}\n';
    await mkdir(join(arrayHome, ".config", "amp"), { recursive: true });
    await writeFile(arraySettings, array);
    const arrayRejected = await cli.run({
      arguments: ["mcp", "add", "--agent", "amp", "--json"],
      cwd: root,
      environment: { HOME: arrayHome, USERPROFILE: arrayHome },
      timeoutMs: 20_000,
    });
    expect(arrayRejected.exitCode, arrayRejected.stderr).toBe(1);
    expect(arrayRejected.json).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_value",
          missing: false,
          path: "amp",
        }),
      ]),
    });
    expect(await readFile(arraySettings, "utf8")).toBe(array);

    // A backup write failure is reported as a filesystem problem, not as bad
    // JSON.
    const backupHome = join(root, "backup-error");
    const backupSettings = ampSettings(backupHome);
    const backupPath = `${backupSettings}.rea.backup`;
    await mkdir(join(backupHome, ".config", "amp"), { recursive: true });
    await writeFile(backupSettings, '{"amp.mcpServers": {}}\n');
    await mkdir(backupPath);
    const backupRejected = await cli.run({
      arguments: ["mcp", "add", "--agent", "amp", "--json"],
      cwd: root,
      environment: { HOME: backupHome, USERPROFILE: backupHome },
      timeoutMs: 20_000,
    });
    expect(backupRejected.exitCode, backupRejected.stderr).toBe(1);
    expect(backupRejected.json).toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Unable to create Amp settings backup"),
    });
  },
);

it("keeps the first Amp registration backup and secures later recovery copies", async () => {
  const root = await createTestTempDirectory("rea-amp-backup-permissions-");
  const settingsPath = join(root, "settings.json");
  const settingsText =
    '{"amp.mcpServers":{"rea":{"env":{"TOKEN":"secret"}}}}\n';
  await writeFile(settingsPath, settingsText);

  const backup = await writeAmpRegistrationBackup(settingsPath, settingsText);
  if (!backup.ok)
    throw new Error(
      `${backup.error.kind} ${backup.error.path}: ${backup.error.detail}`,
    );
  const backupPath = backup.value;
  expect(await readFile(backupPath, "utf8")).toBe(settingsText);
  if (process.platform !== "win32")
    expect((await stat(backupPath)).mode & 0o777).toBe(0o600);

  await chmod(backupPath, 0o644);
  const updatedSettings = "updated settings";
  await writeFile(settingsPath, updatedSettings);
  const updatedBackup = await writeAmpRegistrationBackup(
    settingsPath,
    updatedSettings,
  );
  if (!updatedBackup.ok)
    throw new Error(
      `${updatedBackup.error.kind} ${updatedBackup.error.path}: ${updatedBackup.error.detail}`,
    );
  const updatedBackupPath = updatedBackup.value;
  expect(updatedBackupPath).not.toBe(backupPath);
  expect(await readFile(updatedBackupPath, "utf8")).toBe(updatedSettings);
  expect(await readFile(backupPath, "utf8")).toBe(settingsText);
  if (process.platform !== "win32")
    expect((await stat(updatedBackupPath)).mode & 0o777).toBe(0o600);
  if (process.platform !== "win32")
    expect((await stat(backupPath)).mode & 0o777).toBe(0o600);
});

it("returns a tagged failure when the Amp backup path is occupied", async () => {
  const root = await createTestTempDirectory("rea-amp-backup-occupied-");
  const settingsPath = join(root, "settings.json");
  const backupPath = `${settingsPath}.rea.backup`;
  await writeFile(settingsPath, "{}\n");
  await mkdir(backupPath);

  const result = await writeAmpRegistrationBackup(settingsPath, "{}\n");
  expect(result).toMatchObject({
    ok: false,
    error: {
      kind: "occupied",
      path: backupPath,
    },
  });
});
