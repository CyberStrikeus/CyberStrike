import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  clientRegistrationEntry,
  parseClientConfiguration,
  effectiveClientServer,
} from "../../../src/application/ClientConfigurationDocument.js";
import {
  configureClientConfiguration,
  inspectClientConfiguration,
  clientConfigurationAligned,
} from "../../../src/application/SetupClientConfiguration.js";
import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  effectiveClientConfiguration,
  readClientConfigurationFiles,
} from "../../../src/application/ClientConfigurationFiles.js";
import { clientRegistrationEnvironmentDetails } from "../../../src/application/ClientRegistrationEnvironment.js";

const command = currentClientRegistrationCommand({
  platform: process.platform,
});
const language = "x86:LE:32:default";
const compiler = "borlandcpp";

it.each(["missing", "empty", "legacy", "native"] as const)(
  "uses effective OpenCode native activation when the upper layer is %s",
  async (shape) => {
    const home = await createTestTempDirectory(
      "rea-opencode-effective-dialect-",
    );
    const root = join(home, ".config", "opencode");
    await mkdir(root, { recursive: true });
    const lower = join(root, "opencode.json");
    const upper = join(root, "opencode.jsonc");
    const originalLower = JSON.stringify({
      mcp: {
        servers: {
          rea: { type: "local", command, disabled: true },
          other: { type: "local", command: ["other"], disabled: true },
        },
      },
    });
    await writeFile(lower, originalLower);
    if (shape !== "missing")
      await writeFile(
        upper,
        JSON.stringify({
          theme: "caller-theme",
          ...(shape === "legacy"
            ? {
                mcp: {
                  rea: {
                    type: "local",
                    command,
                    enabled: true,
                    future_policy: { retain: true },
                  },
                },
              }
            : {}),
          ...(shape === "native" ? { mcp: { servers: {} } } : {}),
        }),
      );
    const client = {
      name: "opencode",
      format: "opencode",
      configPath: upper,
      configPaths: [lower, upper],
    } as const;
    expect(
      await configureClientConfiguration(client, {}, command),
    ).toMatchObject({ status: "configured" });
    const files = await readClientConfigurationFiles(client);
    expect(files.ok).toBe(true);
    if (!files.ok) throw new Error(files.error.detail);
    const effective = effectiveClientConfiguration(files.value);
    expect(effective?.dialect).toBe("opencode_v2");
    expect(
      effective === undefined
        ? undefined
        : effectiveClientServer(effective, "rea"),
    ).toMatchObject({ disabled: false });
    const written = JSON.parse(await readFile(upper, "utf8"));
    expect(written.mcp.servers.rea).toMatchObject({
      type: "local",
      command,
      disabled: false,
    });
    if (shape === "legacy")
      expect(written.mcp.servers.rea.future_policy).toEqual({ retain: true });
    expect(written.mcp.rea).toBeUndefined();
    expect(await inspectClientConfiguration(client, {}, command)).toEqual({
      status: "already_current",
    });
    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "unchanged",
    });
    expect(await readFile(lower, "utf8")).toBe(originalLower);
  },
);

const layered = async (lower: unknown, upper: unknown) => {
  const home = await createTestTempDirectory("rea-layered-environment-");
  const directory = join(home, ".config/opencode");
  await mkdir(directory, { recursive: true });
  const paths = [
    join(directory, "opencode.json"),
    join(directory, "opencode.jsonc"),
  ];
  const sources = [lower, upper].map((environment) =>
    JSON.stringify({
      mcp: {
        rea: {
          ...clientRegistrationEntry("opencode", command, {}),
          environment,
        },
      },
    }),
  );
  for (const [index, path] of paths.entries())
    await writeFile(path, sources[index]!);
  const client = {
    name: "opencode",
    format: "opencode",
    configPath: paths[1]!,
    configPaths: paths,
  } as const;
  const status = async () =>
    (
      await readClientRegistrationStatuses(home, command[1], {
        environment: { XDG_CONFIG_HOME: join(home, ".config") },
      })
    ).find(({ client }) => client === "opencode");
  const unchanged = async () => {
    for (const [index, path] of paths.entries()) {
      expect(await readFile(path, "utf8")).toBe(sources[index]);
      await expect(access(`${path}.rea.backup`)).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  };
  return { client, paths, sources, status, unchanged };
};

it.skipIf(process.platform !== "win32").each([
  { REA_ANALYSIS_PROVIDER: "ghidra", rea_analysis_provider: "hopper" },
  { rea_analysis_provider: "hopper", REA_ANALYSIS_PROVIDER: "ghidra" },
])(
  "keeps explicit overrides above inherited Windows aliases: %j",
  async (lower) => {
    const fixture = await layered(lower, {});
    expect(
      await configureClientConfiguration(
        fixture.client,
        { REA_ANALYSIS_PROVIDER: "ghidra" },
        command,
      ),
    ).toMatchObject({ status: "configured" });
    const sources = await readClientConfigurationFiles(fixture.client);
    expect(sources.ok).toBe(true);
    if (!sources.ok) throw new Error(sources.error.detail);
    const environment = clientRegistrationEnvironmentDetails(
      effectiveClientConfiguration(sources.value),
    );
    expect(environment.ok).toBe(true);
    if (!environment.ok) throw environment.error;
    expect(environment.value.timeoutInputs?.analysisProvider).toBe("ghidra");
    expect(environment.value.values).toHaveProperty(
      "REA_ANALYSIS_PROVIDER",
      "ghidra",
    );
    expect(environment.value.values).not.toHaveProperty(
      "rea_analysis_provider",
    );
    expect(await readFile(fixture.paths[0]!, "utf8")).toBe(fixture.sources[0]);
    expect(
      await configureClientConfiguration(
        fixture.client,
        { REA_ANALYSIS_PROVIDER: "ghidra" },
        command,
      ),
    ).toEqual({ status: "unchanged" });
  },
);

it("validates language/compiler settings in the effective OpenCode environment", async () => {
  const fixture = await layered(
    { REA_GHIDRA_LANGUAGE_ID: language },
    { REA_GHIDRA_COMPILER_SPEC_ID: compiler },
  );
  expect(await inspectClientConfiguration(fixture.client, {}, command)).toEqual(
    { status: "already_current" },
  );
  expect(await clientConfigurationAligned(fixture.client, {}, command)).toBe(
    true,
  );
  expect(await fixture.status()).toMatchObject({ state: "aligned" });
  expect(
    await configureClientConfiguration(fixture.client, {}, command),
  ).toEqual({ status: "unchanged" });
  await fixture.unchanged();
});

it("rejects a companion absent from the complete layered environment", async () => {
  const fixture = await layered(
    { CALLER_SETTING: "keep" },
    { REA_GHIDRA_COMPILER_SPEC_ID: compiler },
  );
  expect(
    await inspectClientConfiguration(fixture.client, {}, command),
  ).toMatchObject({
    status: "invalid",
    remediation: expect.stringContaining("REA_GHIDRA_COMPILER_SPEC_ID"),
  });
  expect(await clientConfigurationAligned(fixture.client, {}, command)).toBe(
    false,
  );
  expect(await fixture.status()).toMatchObject({
    state: "invalid",
    remediation: expect.stringContaining("REA_GHIDRA_COMPILER_SPEC_ID"),
  });
  expect(
    await configureClientConfiguration(fixture.client, {}, command),
  ).toMatchObject({ status: "failed" });
  await fixture.unchanged();
});

it("keeps higher-priority values and does not copy inherited settings into the write layer", async () => {
  const fixture = await layered(
    {
      REA_GHIDRA_LANGUAGE_ID: language,
      HOPPER_LOADER_ARGS_JSON: '["lower"]',
      ["__proto__"]: "lower caller value",
    },
    {
      REA_GHIDRA_COMPILER_SPEC_ID: compiler,
      HOPPER_LOADER_ARGS_JSON: '[""]',
      ["__proto__"]: "selected caller value",
    },
  );
  expect(
    await configureClientConfiguration(
      fixture.client,
      { REA_LOG_LEVEL: "debug" },
      command,
    ),
  ).toMatchObject({ status: "configured" });
  expect(await readFile(fixture.paths[0]!, "utf8")).toBe(fixture.sources[0]);
  const configured = parseClientConfiguration(
    await readFile(fixture.client.configPath, "utf8"),
    "opencode",
  );
  expect(effectiveClientServer(configured, "rea")).toHaveProperty(
    "environment",
    {
      REA_GHIDRA_COMPILER_SPEC_ID: compiler,
      HOPPER_LOADER_ARGS_JSON: '[""]',
      REA_LOG_LEVEL: "debug",
      ["__proto__"]: "selected caller value",
    },
  );
  expect(
    await readFile(`${fixture.client.configPath}.rea.backup`, "utf8"),
  ).toBe(fixture.sources[1]);
  expect(await fixture.status()).toMatchObject({ state: "aligned" });
  expect(await clientConfigurationAligned(fixture.client, {}, command)).toBe(
    true,
  );
  expect(
    await configureClientConfiguration(fixture.client, {}, command),
  ).toEqual({ status: "unchanged" });
});

it("merges caller server names as own keys without inventing absent registrations", () => {
  const lower = parseClientConfiguration(
    '{"mcp":{"__proto__":{"type":"local","command":["peer"],"environment":{"LOWER":"retained"}}}}',
    "opencode",
  );
  const upper = parseClientConfiguration(
    '{"mcp":{"__proto__":{"environment":{"UPPER":"selected"}}}}',
    "opencode",
  );
  expect(effectiveClientServer(lower, "constructor")).toBeUndefined();
  const effective = effectiveClientConfiguration([
    { ...lower, sourcePath: "lower.json" },
    { ...upper, sourcePath: "upper.json" },
  ]);
  expect(effective).toBeDefined();
  if (effective === undefined) throw new Error("missing layered configuration");
  expect(Object.keys(effective.servers)).toEqual(["__proto__"]);
  expect(effectiveClientServer(effective, "__proto__")).toEqual({
    type: "local",
    command: ["peer"],
    environment: { LOWER: "retained", UPPER: "selected" },
  });
  expect(effectiveClientServer(effective, "toString")).toBeUndefined();
});

it.each([
  ["invalid JSON", { HOPPER_LOADER_ARGS_JSON: "{" }],
  ["invalid value type", { HOPPER_LOADER_ARGS_JSON: 42 }],
  ["invalid environment map", []],
])(
  "does not hide a lower-priority %s behind a valid override",
  async (_name, lower) => {
    const fixture = await layered(lower, { HOPPER_LOADER_ARGS_JSON: "[]" });
    expect(
      await inspectClientConfiguration(fixture.client, {}, command),
    ).toMatchObject({
      status: "invalid",
      remediation: expect.stringContaining(fixture.paths[0]!),
    });

    expect(await fixture.status()).toMatchObject({ state: "invalid" });
    expect(
      await configureClientConfiguration(fixture.client, {}, command),
    ).toMatchObject({ status: "failed" });
    await fixture.unchanged();
  },
);

it("uses inherited settings when creating a missing write layer", async () => {
  const fixture = await layered({ REA_GHIDRA_LANGUAGE_ID: language }, {});
  await rm(fixture.client.configPath);
  const overrides = { REA_GHIDRA_COMPILER_SPEC_ID: compiler };
  expect(
    await inspectClientConfiguration(fixture.client, overrides, command),
  ).toEqual({ status: "create" });
  expect(
    await configureClientConfiguration(fixture.client, overrides, command),
  ).toMatchObject({ status: "configured" });
  const parsed = parseClientConfiguration(
    await readFile(fixture.client.configPath, "utf8"),
    "opencode",
  );
  expect(effectiveClientServer(parsed, "rea")).toHaveProperty(
    "environment",
    overrides,
  );
  expect(await readFile(fixture.paths[0]!, "utf8")).toBe(fixture.sources[0]);
  expect(await fixture.status()).toMatchObject({ state: "aligned" });
  await expect(
    access(`${fixture.client.configPath}.rea.backup`),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("replaces the selected write layer rather than the last loaded layer", async () => {
  const fixture = await layered(
    { REA_GHIDRA_LANGUAGE_ID: language },
    { REA_GHIDRA_COMPILER_SPEC_ID: compiler },
  );
  const client = { ...fixture.client, configPath: fixture.paths[0]! };
  const overrides = { REA_LOG_LEVEL: "debug" };
  expect(await inspectClientConfiguration(client, {}, command)).toEqual({
    status: "already_current",
  });
  expect(
    await configureClientConfiguration(client, overrides, command),
  ).toMatchObject({ status: "configured" });
  const parsed = parseClientConfiguration(
    await readFile(client.configPath, "utf8"),
    "opencode",
  );
  expect(effectiveClientServer(parsed, "rea")).toHaveProperty("environment", {
    REA_GHIDRA_LANGUAGE_ID: language,
    ...overrides,
  });
  expect(await readFile(fixture.paths[1]!, "utf8")).toBe(fixture.sources[1]);
  expect(await readFile(`${client.configPath}.rea.backup`, "utf8")).toBe(
    fixture.sources[0],
  );
  expect(await clientConfigurationAligned(client, {}, command)).toBe(true);
  expect(await fixture.status()).toMatchObject({ state: "aligned" });
});
