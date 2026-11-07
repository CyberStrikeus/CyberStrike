import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { expect, it } from "vitest";

import { supportedClients } from "../../../src/application/SupportedClients.js";
import { configureClientConfiguration } from "../../../src/application/SetupClientConfiguration.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("registers VS Code in VSCODE_APPDATA and preserves its configuration", async () => {
  const root = await createTestTempDirectory("rea-vscode-appdata-");
  const home = join(root, "home");
  const appdata = join(root, "selected data");
  const expectedPath = join(appdata, "Code", "User", "mcp.json");
  await mkdir(join(appdata, "Code", "User"), { recursive: true });
  const original =
    '{\n // Keep this comment.\n "servers": {"other": {"command": "other"}}\n}\n';
  await writeFile(expectedPath, original);
  const client = supportedClients(home, "linux", {
    VSCODE_APPDATA: appdata,
  }).find(({ name }) => name === "vscode");
  expect(client).toBeDefined();
  if (client === undefined) throw new Error("VS Code client missing");
  expect(
    await configureClientConfiguration(client, {}, ["rea", "mcp"]),
  ).toMatchObject({ status: "configured" });
  expect(parse(await readFile(expectedPath, "utf8"))).toMatchObject({
    servers: {
      other: { command: "other" },
      rea: { command: "rea", args: ["mcp"] },
    },
  });
  expect(await readFile(expectedPath, "utf8")).toContain(
    "// Keep this comment.",
  );
  expect(await readFile(`${expectedPath}.rea.backup`, "utf8")).toBe(original);
  expect(
    await configureClientConfiguration(client, {}, ["rea", "mcp"]),
  ).toMatchObject({ status: "unchanged" });
  await expect(access(join(home, ".config", "Code"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each([
  {
    name: "portable wins over appdata",
    env: { VSCODE_PORTABLE: "portable", VSCODE_APPDATA: "ignored" },
    suffix: "portable/user-data",
  },
  {
    name: "empty portable allows appdata",
    env: { VSCODE_PORTABLE: "", VSCODE_APPDATA: "appdata" },
    suffix: "appdata/Code",
  },
  {
    name: "relative appdata uses VSCODE_CWD",
    env: { VSCODE_APPDATA: "appdata" },
    suffix: "appdata/Code",
  },
  {
    name: "empty overrides use relative XDG default",
    env: { VSCODE_PORTABLE: "", VSCODE_APPDATA: "", XDG_CONFIG_HOME: "xdg" },
    suffix: "xdg/Code",
  },
])("writes the selected VS Code file when $name", async ({ env, suffix }) => {
  const root = await createTestTempDirectory("rea-vscode-precedence-");
  const home = join(root, "home");
  const expectedPath = join(root, suffix, "User", "mcp.json");
  const client = supportedClients(home, "linux", {
    ...env,
    VSCODE_CWD: root,
  }).find(({ name }) => name === "vscode");
  expect(client?.configPath).toBe(expectedPath);
  if (client === undefined) throw new Error("VS Code client missing");
  expect(
    await configureClientConfiguration(client, {}, ["rea", "mcp"]),
  ).toMatchObject({ status: "configured" });
  expect(parse(await readFile(expectedPath, "utf8"))).toMatchObject({
    servers: { rea: { command: "rea" } },
  });
  await expect(access(join(home, ".config", "Code"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each(["", undefined])(
  "resolves relative VS Code data against cwd when VSCODE_CWD is %s",
  (cwd) => {
    const client = supportedClients("/unused-home", "linux", {
      VSCODE_APPDATA: "relative data",
      VSCODE_CWD: cwd,
    }).find(({ name }) => name === "vscode");
    expect(client?.configPath).toBe(
      join(process.cwd(), "relative data", "Code", "User", "mcp.json"),
    );
  },
);

it.each([
  { platform: "linux", suffix: ".config/Code/User/mcp.json" },
  {
    platform: "darwin",
    suffix: "Library/Application Support/Code/User/mcp.json",
  },
  { platform: "win32", suffix: "AppData/Roaming/Code/User/mcp.json" },
] as const)(
  "retains the $platform default without VS Code overrides",
  async ({ platform, suffix }) => {
    const home = await createTestTempDirectory("rea-vscode-default-");
    const client = supportedClients(home, platform, {}).find(
      ({ name }) => name === "vscode",
    );
    expect(client?.configPath).toBe(join(home, suffix));
  },
);
