import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createCli } from "../../../src/cli.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("setup carries explicit Hopper loader selections into Cursor without persisting target or unrelated settings", async () => {
  const home = await createTestTempDirectory("rea-setup-loader-environment-");
  const path = join(home, ".cursor/mcp.json");
  await mkdir(join(home, ".cursor"));
  await writeFile(path, '{"caller":"retain"}\n');
  const environment = {
    HOME: home,
    USERPROFILE: home,
    HOPPER_LAUNCHER_PATH: join(home, "missing-hopper"),
    GHIDRA_INSTALL_DIR: join(home, "missing-ghidra"),
    JAVA_HOME: join(home, "missing-java"),
    HOPPER_LOADER_ARGS_JSON: '["", "--loader", "Mach-O"]',
    HOPPER_TARGET_PATH: join(home, "per-target"),
    HOPPER_TARGET_KIND: "executable",
    CALLER_UNRELATED_SETTING: "do not persist",
  };
  const setup = async () => {
    let stdout = "";
    await createCli(environment).serve(
      ["setup", "--client", "cursor", "--skill=false", "--yes", "--json"],
      {
        env: environment,
        stdout: (chunk) => {
          stdout += chunk;
        },
        exit: () => undefined,
      },
    );
    return JSON.parse(stdout) as unknown;
  };
  const loaderFromSavedRegistration = async () => {
    const document = JSON.parse(await readFile(path, "utf8"));
    expect(document.caller).toBe("retain");
    const saved = document.mcpServers.rea.env;
    expect(saved).not.toHaveProperty("CALLER_UNRELATED_SETTING");
    expect(saved).not.toHaveProperty("HOPPER_TARGET_PATH");
    expect(saved).not.toHaveProperty("HOPPER_TARGET_KIND");
    const config = parseConfig(saved);
    if (!config.ok) throw config.error;
    return config.value.hopperLoaderArgs;
  };

  expect(await setup()).toMatchObject({ status: "ready" });
  expect(await loaderFromSavedRegistration()).toEqual([
    "",
    "--loader",
    "Mach-O",
  ]);
  const created = await readFile(path, "utf8");
  expect(JSON.parse(created).mcpServers.rea.env.HOPPER_LOADER_ARGS_JSON).toBe(
    environment.HOPPER_LOADER_ARGS_JSON,
  );
  environment.HOPPER_LOADER_ARGS_JSON = "[]";
  expect(await setup()).toMatchObject({ status: "ready" });
  expect(await loaderFromSavedRegistration()).toEqual([]);
  const updated = await readFile(path, "utf8");
  expect(JSON.parse(updated).mcpServers.rea.env.HOPPER_LOADER_ARGS_JSON).toBe(
    "[]",
  );
  environment.HOPPER_LOADER_ARGS_JSON = "{";
  expect(await setup()).toMatchObject({
    status: "needs_human",
    plannedActions: [],
    appliedActions: [],
  });
  expect(await readFile(path, "utf8")).toBe(updated);
});
