import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

import { assertClientConfig } from "../../../scripts/verify-package-setup.mjs";
import { terminalModesRestored } from "../../../scripts/lib/verify-setup-terminal.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const cli = resolve("scripts/rea.mjs");

it("requires positive canonical-input and echo terminal mode tokens", () => {
  expect(terminalModesRestored("speed 38400 baud; icanon echo isig")).toBe(
    true,
  );
  expect(terminalModesRestored("speed 38400 baud; -icanon -echo isig")).toBe(
    false,
  );
  expect(terminalModesRestored("speed 38400 baud; -icanon echo isig")).toBe(
    false,
  );
  expect(terminalModesRestored("speed 38400 baud; icanon -echo isig")).toBe(
    false,
  );
});

it("rejects a backup replaced with the post-setup client configuration", async () => {
  const directory = await createTestTempDirectory("rea-client-backup-");
  const path = join(directory, "client.json");
  const original = Buffer.from('{"existing":true,"model":"caller"}\n');
  const configured = JSON.stringify({
    existing: true,
    model: "caller",
    mcpServers: { rea: { command: process.execPath, args: [cli, "mcp"] } },
  });
  await writeFile(path, configured);
  await writeFile(`${path}.rea.backup`, original);
  await assertClientConfig(cli, path, original);

  await writeFile(`${path}.rea.backup`, configured);
  await expect(assertClientConfig(cli, path, original)).rejects.toThrow(
    "packaged client backup failed",
  );
  expect(await readFile(path, "utf8")).toBe(configured);
});

it("compares backup bytes even when invalid UTF-8 decodes to the same text", async () => {
  const directory = await createTestTempDirectory("rea-client-backup-bytes-");
  const path = join(directory, "client.json");
  const original = Buffer.from('{"existing":true,"note":"\uFFFD"}\n');
  const configured = JSON.stringify({
    existing: true,
    mcpServers: { rea: { command: process.execPath, args: [cli, "mcp"] } },
  });
  const changed = Buffer.concat([
    Buffer.from('{"existing":true,"note":"'),
    Buffer.from([0xff]),
    Buffer.from('"}\n'),
  ]);
  expect(changed.toString("utf8")).toBe(original.toString("utf8"));
  await writeFile(path, configured);
  await writeFile(`${path}.rea.backup`, changed);
  await expect(assertClientConfig(cli, path, original)).rejects.toThrow(
    "packaged client backup failed",
  );
});
