import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, it } from "vitest";

import {
  clientRegistrationEntry,
  effectiveClientServer,
  parseClientConfiguration,
  serializeClientConfiguration,
} from "../../../src/application/ClientConfigurationDocument.js";
import {
  clientConfigurationAligned,
  configureClientConfiguration,
  inspectClientConfiguration,
} from "../../../src/application/SetupClientConfiguration.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";
import {
  clientRegistrationEnvironment,
  clientRegistrationEnvironmentDetails,
  clientRegistrationEnvironmentDetailsWithBudget,
} from "../../../src/application/ClientRegistrationEnvironment.js";
import { snapshotEnvironment } from "../../../src/process/snapshotEnvironment.js";

import { ok } from "../../../src/domain/result.js";
import { MCP_STARTUP_POLICY } from "../../../src/mcpStartupPolicy.js";

const staleOwnedCommand = ["npx", "-y", "rea-agents@6.6.0", "mcp"] as const;

it("awaits the owner-parsed provider request budget without changing caller strings", async () => {
  const parsed = parseClientConfiguration(
    JSON.stringify({
      mcpServers: {
        rea: {
          command: "rea",
          args: ["mcp"],
          env: {
            REA_ANALYSIS_PROVIDER: "ida",
            REA_IDA_MCP_CONFIG: "/tmp/rea-registration.json/",
          },
        },
      },
    }),
    "json",
  );
  const details = await clientRegistrationEnvironmentDetailsWithBudget(
    parsed,
    {},
    "effective",
    async (provider) => {
      expect(provider).toBe("ida");
      return ok(17);
    },
  );
  expect(details).toMatchObject({
    ok: true,
    value: {
      values: { REA_IDA_MCP_CONFIG: "/tmp/rea-registration.json/" },
      timeoutInputs: { providerRequestTimeoutMs: 17 },
    },
  });
});

it("preserves owner-parsed registration facts and revalidates later inspections", async () => {
  const home = await createTestTempDirectory("rea-registration-snapshot-");
  const configPath = join(home, "mcp.json");
  const environment = {
    REA_ANALYSIS_PROVIDER: "ida",
    REA_IDA_MCP_CONFIG: "/tmp/rea-registration.json/",
    REA_MCP_INPUT_SCHEMA_PROFILE: "compact",
  };
  const original = JSON.stringify({
    mcpServers: {
      rea: {
        command: "rea",
        args: ["mcp"],
        env: environment,
        startupTimeoutMs: MCP_STARTUP_POLICY.kimiStartupTimeoutMs,
        toolTimeoutMs: 450_000,
      },
    },
  });
  await writeFile(configPath, original);
  const client = { name: "kimi", format: "kimi", configPath } as const;
  let providerTimeoutMs = 17;
  const observedBudgets = new Set<number>();
  const resolveBudget = async (
    provider: string,
    observedEnvironment: Readonly<Record<string, string>>,
  ) => {
    expect(observedEnvironment.REA_IDA_MCP_CONFIG).toBe(
      environment.REA_IDA_MCP_CONFIG,
    );
    expect(provider).toBe("ida");
    observedBudgets.add(providerTimeoutMs);
    return ok(providerTimeoutMs);
  };

  expect(
    await clientConfigurationAligned(client, {}, ["rea", "mcp"], resolveBudget),
  ).toBe(true);
  expect(observedBudgets.has(17)).toBe(true);

  expect(
    await inspectClientConfiguration(client, {}, ["rea", "mcp"], resolveBudget),
  ).toEqual({ status: "already_current" });
  providerTimeoutMs = 1_000_000;
  // Revalidate the budget while preserving the caller's positive timeout.
  expect(
    await inspectClientConfiguration(client, {}, ["rea", "mcp"], resolveBudget),
  ).toEqual({ status: "already_current" });
  expect(observedBudgets.has(providerTimeoutMs)).toBe(true);
  expect(await readFile(configPath, "utf8")).toBe(original);
  await expect(access(`${configPath}.rea.backup`)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each(["win32", "linux"] as const)(
  "uses the selected %s identity when inspecting lowercase registration settings",
  async (platform) => {
    const home = await createTestTempDirectory("rea-selected-platform-env-");
    const path = join(home, ".cursor/mcp.json");
    await mkdir(join(home, ".cursor"));
    await writeFile(
      path,
      JSON.stringify({
        mcpServers: {
          rea: clientRegistrationEntry(
            "json",
            currentClientRegistrationCommand({ platform }),
            { rea_analysis_provider: "invalid provider" },
          ),
        },
      }),
    );
    const statuses = await readClientRegistrationStatuses(
      home,
      currentClientRegistrationCommand({ platform })[1],
      {
        platform,
        environment: {},
      },
    );
    expect(statuses.find(({ client }) => client === "cursor")).toMatchObject({
      state: platform === "win32" ? "invalid" : "aligned",
    });
  },
);

it.skipIf(process.platform !== "win32").each([
  {
    key: "rea_analysis_provider",
    override: "REA_ANALYSIS_PROVIDER",
    value: "ghidra",
    duplicate: false,
  },
  { key: "true", override: "TRUE", value: "chosen", duplicate: false },
  { key: '"true"', override: "true", value: "chosen", duplicate: true },
  {
    key: "rea_analysis_provider",
    override: "REA_ANALYSIS_PROVIDER",
    value: "ghidra",
    duplicate: true,
  },
])(
  "preserves DSH scalar-key identity and comments when replacing $key",
  async ({ key, override, value, duplicate }) => {
    const root = await createTestTempDirectory("rea-dsh-alias-comments-");
    const configPath = join(root, "cordis.patch.yml");
    const source = `- insert:\n    - id: rea-mcp\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: rea\n        transport: stdio\n        command: old-rea\n        args: [mcp]\n        env:\n          # retain preceding rationale\n          ${key}: "hopper" # retain inline rationale\n${duplicate ? `          ${override}: "ghidra" # retain winning rationale\n` : ""}          CUSTOM: !!js caller.custom\n`;
    await writeFile(configPath, source);
    const client = { name: "dsh", format: "dsh", configPath } as const;
    const result = await configureClientConfiguration(
      client,
      { [override]: value },
      ["rea", "mcp"],
    );
    expect(result, JSON.stringify(result)).toMatchObject({
      status: "configured",
    });
    const text = await readFile(configPath, "utf8");
    expect(text).toContain("# retain preceding rationale");
    expect(text).toContain("# retain inline rationale");
    if (duplicate) expect(text).toContain("# retain winning rationale");
    expect(text).toContain("!!js caller.custom");
    const env = clientRegistrationEnvironmentDetails(
      parseClientConfiguration(text, "dsh"),
    );
    expect(env.ok).toBe(true);
    if (!env.ok) throw env.error;
    expect(env.value.values).toHaveProperty(override, value);
    expect(
      Object.keys(env.value.values).filter(
        (name) => name.toUpperCase() === override.toUpperCase(),
      ),
    ).toEqual([override]);
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(source);
    expect(
      await configureClientConfiguration(client, { [override]: value }, [
        "rea",
        "mcp",
      ]),
    ).toEqual({ status: "unchanged" });
  },
);

it.skipIf(process.platform !== "win32")(
  "preserves a lowercase explicit Kimi schema profile instead of inserting a conflicting default",
  async () => {
    const home = await createTestTempDirectory("rea-kimi-case-");
    await mkdir(join(home, ".kimi-code"));
    const configPath = join(home, ".kimi-code/mcp.json");
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          rea: {
            command: staleOwnedCommand[0],
            args: staleOwnedCommand.slice(1),
            env: { rea_mcp_input_schema_profile: "full" },
          },
        },
      }),
    );
    const client = { name: "kimi", format: "kimi", configPath } as const;
    const command = currentClientRegistrationCommand();
    expect(
      await configureClientConfiguration(client, {}, command),
    ).toMatchObject({ status: "configured" });
    const parsed = parseClientConfiguration(
      await readFile(configPath, "utf8"),
      "kimi",
    );
    expect(effectiveClientServer(parsed, "rea")).toHaveProperty("env", {
      rea_mcp_input_schema_profile: "full",
    });
    const statuses = await readClientRegistrationStatuses(home, command[1], {
      environment: {},
    });
    expect(statuses.find(({ client }) => client === "kimi")).toMatchObject({
      state: "aligned",
    });
  },
);

it
  .skipIf(process.platform !== "win32")
  .each(["hopper", "!!js caller.provider"])(
  "replaces a Windows DSH environment alias without evaluating %s",
  async (stored) => {
    const root = await createTestTempDirectory("rea-dsh-case-");
    const configPath = join(root, "cordis.patch.yml");
    const source = `- insert:\n    - id: rea-mcp\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: rea\n        transport: stdio\n        command: old-rea\n        args: [mcp]\n        env:\n          rea_analysis_provider: ${stored}\n          CUSTOM: !!js caller.custom\n`;
    await writeFile(configPath, source);
    const client = { name: "dsh", format: "dsh", configPath } as const;
    const overrides = { REA_ANALYSIS_PROVIDER: "ghidra" };
    const configured = await configureClientConfiguration(client, overrides, [
      "rea",
      "mcp",
    ]);
    expect(configured, JSON.stringify(configured)).toMatchObject({
      status: "configured",
    });
    const text = await readFile(configPath, "utf8");
    expect(text).not.toContain("rea_analysis_provider:");
    expect(text).toContain("REA_ANALYSIS_PROVIDER: ghidra");
    expect(text).toContain("!!js caller.custom");
    const details = clientRegistrationEnvironmentDetails(
      parseClientConfiguration(text, "dsh"),
    );
    expect(details.ok).toBe(true);
    if (!details.ok) throw details.error;
    expect(details.value.timeoutInputs?.analysisProvider).toBe("ghidra");
    expect(
      await configureClientConfiguration(client, overrides, ["rea", "mcp"]),
    ).toEqual({ status: "unchanged" });
  },
);

it.skipIf(process.platform !== "win32").each([
  {
    existing: { rea_analysis_provider: "hopper" },
    overrides: { REA_ANALYSIS_PROVIDER: "ghidra" },
    expected: "ghidra",
  },
  {
    existing: { REA_ANALYSIS_PROVIDER: "ghidra" },
    overrides: { rea_analysis_provider: "hopper" },
    expected: "hopper",
  },
])(
  "keeps Windows override precedence consistent with the launched environment: $expected",
  ({ existing, overrides, expected }) => {
    const parsed = parseClientConfiguration(
      JSON.stringify({
        mcpServers: { rea: { command: "rea", args: ["mcp"], env: existing } },
      }),
      "json",
    );
    const result = clientRegistrationEnvironmentDetails(parsed, overrides);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.timeoutInputs?.analysisProvider).toBe(expected);
    expect(snapshotEnvironment(result.value.values).REA_ANALYSIS_PROVIDER).toBe(
      expected,
    );
    expect(Object.keys(result.value.values)).toHaveLength(1);
    const child = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write(process.env.REA_ANALYSIS_PROVIDER ?? '')"],
      {
        env: result.value.values,
        encoding: "utf8",
        timeout: 5_000,
      },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe(expected);
  },
);

it.skipIf(process.platform !== "win32")(
  "rejects invalid lowercase known settings before writing a Windows registration",
  async () => {
    const root = await createTestTempDirectory(
      "rea-invalid-lowercase-environment-",
    );
    const configPath = join(root, "config.json");
    const original = JSON.stringify({
      mcpServers: {
        rea: {
          command: "rea",
          args: ["mcp"],
          env: { rea_analysis_provider: "invalid provider" },
        },
      },
    });
    await writeFile(configPath, original);
    const result = await configureClientConfiguration(
      { name: "cursor", format: "json", configPath },
      {},
      ["rea", "mcp"],
    );
    expect(result).toMatchObject({ status: "failed" });
    expect(await readFile(configPath, "utf8")).toBe(original);
    await expect(access(`${configPath}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.each([
  ["cursor", "json", "mcpServers", "env"],
  ["codex", "toml", "mcp_servers", "env"],
  ["opencode", "opencode", "mcp", "environment"],
  ["hermes", "hermes", "mcp_servers", "env"],
] as const)(
  "preserves %s server environment through command and provider updates",
  async (name, format, serversKey, environmentKey) => {
    const root = await createTestTempDirectory("rea-setup-environment-");
    const configPath = join(root, "config");
    const client = { name, format, configPath };
    const custom = {
      REA_MCP_INPUT_SCHEMA_PROFILE: "compact",
      REA_MCP_OUTPUT_SCHEMA_PROFILE: "off",
      REA_MCP_MAX_RESPONSE_BYTES: "33554432",
      REA_BROWSER_EXECUTABLE: join(root, "custom-browser"),
      GHIDRA_INSTALL_DIR: join(root, "old-ghidra"),
      HOPPER_LOADER_ARGS_JSON: '["", "--loader", "Mach-O"]',
      REA_REFERENCE_SECRET_PATTERNS_JSON: '["*.private", "local/**"]',
      REA_GHIDRA_LANGUAGE_ID: "x86:LE:32:default",
      REA_GHIDRA_COMPILER_SPEC_ID: "borlandcpp",
      CALLER_SETTING: "preserve exactly",
      ["__proto__"]: "caller prototype setting",
      constructor: "caller constructor setting",
      toString: "caller string setting",
    };
    const serialized = serializeClientConfiguration(
      {
        ["__proto__"]: { caller: "retain root value" },
        [serversKey]: {
          rea: clientRegistrationEntry(format, staleOwnedCommand, custom),
          other: clientRegistrationEntry(format, ["other"], { OTHER: "keep" }),
          ["__proto__"]: clientRegistrationEntry(format, ["peer"], {}),
        },
      },
      format,
    );
    if (!serialized.ok) throw new Error("fixture serialization failed");
    const original = serialized.value;
    const originalParsed = parseClientConfiguration(original, format);
    await writeFile(configPath, original);
    const providers = { GHIDRA_INSTALL_DIR: join(root, "new-ghidra") };
    const command = ["rea", "mcp"];
    expect(
      await inspectClientConfiguration(client, providers, command),
    ).toMatchObject({ status: "update" });
    expect(
      await configureClientConfiguration(client, providers, command),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    const parsed = parseClientConfiguration(configured, format);
    expect(Object.hasOwn(parsed.document, "__proto__")).toBe(true);
    expect(parsed.document["__proto__"]).toEqual({
      caller: "retain root value",
    });
    expect(Object.hasOwn(parsed.servers, "__proto__")).toBe(true);
    expect(effectiveClientServer(parsed, "__proto__")).toEqual(
      effectiveClientServer(originalParsed, "__proto__"),
    );
    expect(effectiveClientServer(parsed, "rea")).toHaveProperty(
      environmentKey,
      { ...custom, ...providers },
    );
    expect(effectiveClientServer(parsed, "other")).toEqual(
      effectiveClientServer(originalParsed, "other"),
    );
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
    expect(await clientConfigurationAligned(client, providers, command)).toBe(
      true,
    );
    expect(
      await inspectClientConfiguration(client, providers, command),
    ).toEqual({ status: "already_current" });
    expect(
      await configureClientConfiguration(client, providers, command),
    ).toEqual({ status: "unchanged" });
    expect(await readFile(configPath, "utf8")).toBe(configured);
  },
);

it.each(["linux", "win32"] as const)(
  "retains every literal Cordis environment key for %s",
  (platform) => {
    const source = `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: rea
        args: [mcp]
        env:
          "__proto__": selected
          constructor: caller
          CUSTOM: !!js caller.custom
`;
    const details = clientRegistrationEnvironmentDetails(
      parseClientConfiguration(source, "dsh"),
      {},
      "effective",
      platform,
    );
    expect(details.ok).toBe(true);
    if (!details.ok) throw details.error;
    expect(Object.entries(details.value.values)).toEqual([
      ["__proto__", "selected"],
      ["constructor", "caller"],
    ]);
    expect(details.value.unresolvedSettings).toEqual(new Set(["CUSTOM"]));
    expect(details.value.timeoutInputs?.analysisProvider).toBe("auto");
  },
);

it("retains an unresolved JEB endpoint expression until a selected literal replaces it", async () => {
  const parsed = parseClientConfiguration(
    `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        env:
          REA_JEB_MCP_URL: !!js caller.endpoint
`,
    "dsh",
  );
  const unresolved = await clientRegistrationEnvironmentDetailsWithBudget(
    parsed,
    {},
    "effective",
    undefined,
  );
  expect(unresolved.ok).toBe(true);
  if (!unresolved.ok) throw unresolved.error;
  expect(unresolved.value.unresolvedSettings).toEqual(
    new Set(["REA_JEB_MCP_URL"]),
  );
  const endpoint = "http://127.0.0.1:8426/mcp/";
  const selected = clientRegistrationEnvironmentDetails(parsed, {
    REA_JEB_MCP_URL: endpoint,
  });
  expect(selected.ok).toBe(true);
  if (!selected.ok) throw selected.error;
  expect(selected.value.values.REA_JEB_MCP_URL).toBe(endpoint);
  expect(selected.value.unresolvedSettings.size).toBe(0);
});

it.each(
  [
    "REA_ANALYSIS_PROVIDER",
    "REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS",
    "REA_GHIDRA_STARTUP_TIMEOUT_MS",
    "REA_HOPPER_STARTUP_TIMEOUT_MS",
    "REA_JEB_MCP_TIMEOUT_MS",
  ].flatMap((setting) =>
    (["linux", "win32"] as const).map((platform) => ({ setting, platform })),
  ),
)(
  "keeps expression-backed $setting unknown on $platform when deriving timeout guidance",
  async ({ setting, platform }) => {
    const parsed = parseClientConfiguration(
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        env:
          ${platform === "win32" ? setting.toLowerCase() : setting}: !!js caller.setting
          CALLER_SETTING: retained
`,
      "dsh",
    );
    const values = clientRegistrationEnvironment(
      parsed,
      {},
      "effective",
      platform,
    );
    expect(values).toMatchObject({
      ok: true,
      value: { CALLER_SETTING: "retained" },
    });
    const details = clientRegistrationEnvironmentDetails(
      parsed,
      {},
      "effective",
      platform,
    );
    expect(details.ok).toBe(true);
    if (!details.ok) throw details.error;
    expect(details.value.values).toEqual({ CALLER_SETTING: "retained" });
    expect(details.value.unresolvedSettings).toEqual(new Set([setting]));
    expect(details.value.timeoutInputs).toBeUndefined();
    let resolved = false;
    const budget = await clientRegistrationEnvironmentDetailsWithBudget(
      parsed,
      {},
      "effective",
      async () => {
        resolved = true;
        return ok(17);
      },
      platform,
    );
    expect(budget).toMatchObject({
      ok: false,
      error: { settings: [{ setting }] },
    });
    expect(resolved).toBe(false);
    const overridden = clientRegistrationEnvironmentDetails(
      parsed,
      {
        [setting]: setting === "REA_ANALYSIS_PROVIDER" ? "ghidra" : "17000",
      },
      "effective",
      platform,
    );
    expect(overridden.ok).toBe(true);
    if (!overridden.ok) throw overridden.error;
    expect(overridden.value.unresolvedSettings.size).toBe(0);
    expect(overridden.value.timeoutInputs).toBeDefined();
  },
);

it("retains an unknown companion while deriving unrelated literal timeout facts", () => {
  const parsed = parseClientConfiguration(
    `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        env:
          REA_GHIDRA_LANGUAGE_ID: !!js caller.language
          REA_GHIDRA_COMPILER_SPEC_ID: borlandcpp
          REA_GHIDRA_STARTUP_TIMEOUT_MS: "17000"
`,
    "dsh",
  );
  const details = clientRegistrationEnvironmentDetails(parsed);
  expect(details.ok).toBe(true);
  if (!details.ok) throw details.error;
  expect(details.value.unresolvedSettings).toEqual(
    new Set(["REA_GHIDRA_LANGUAGE_ID"]),
  );
  expect(details.value.timeoutInputs?.ghidraStartupTimeoutMs).toBe(17000);
});

it("does not resolve a provider budget from an expression omitted from literal values", async () => {
  const parsed = parseClientConfiguration(
    `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        env:
          REA_ANALYSIS_PROVIDER: ida
          REA_IDA_MCP_CONFIG: !!js caller.idaConfig
`,
    "dsh",
  );
  const observations: string[] = [];
  const resolveBudget = async (
    provider: string,
    environment: Readonly<Record<string, string>>,
  ) => {
    observations.push(provider, environment.REA_IDA_MCP_CONFIG ?? "missing");
    return ok(17);
  };
  expect(
    await clientRegistrationEnvironmentDetailsWithBudget(
      parsed,
      {},
      "effective",
      undefined,
    ),
  ).toMatchObject({
    ok: true,
    value: { timeoutInputs: { analysisProvider: "ida" } },
  });
  expect(
    await clientRegistrationEnvironmentDetailsWithBudget(
      parsed,
      {},
      "effective",
      resolveBudget,
    ),
  ).toMatchObject({
    ok: false,
    error: { settings: [{ setting: "REA_IDA_MCP_CONFIG" }] },
  });
  expect(observations).toEqual([]);
  const resolved = await clientRegistrationEnvironmentDetailsWithBudget(
    parsed,
    { REA_IDA_MCP_CONFIG: "/selected/ida.json" },
    "effective",
    resolveBudget,
  );
  expect(resolved).toMatchObject({
    ok: true,
    value: { timeoutInputs: { providerRequestTimeoutMs: 17 } },
  });
  expect(observations).toEqual(["ida", "/selected/ida.json"]);
});

it("rejects a non-string caller environment key before editing configuration", async () => {
  const root = await createTestTempDirectory("rea-invalid-own-environment-");
  const configPath = join(root, "config.json");
  const source =
    '{"mcpServers":{"rea":{"command":"rea","args":["mcp"],"env":{"__proto__":123}}}}';
  await writeFile(configPath, source);
  const details = clientRegistrationEnvironmentDetails(
    parseClientConfiguration(source, "json"),
  );
  expect(details).toMatchObject({
    ok: false,
    error: { settings: [{ setting: "env.__proto__" }] },
  });
  expect(
    await configureClientConfiguration(
      { name: "cursor", format: "json", configPath },
      {},
      ["rea", "mcp"],
    ),
  ).toEqual({ status: "failed", reason: "readback" });
  expect(await readFile(configPath, "utf8")).toBe(source);
  await expect(access(`${configPath}.rea.backup`)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("does not hide an invalid JEB endpoint in an untouched configuration layer", async () => {
  const root = await createTestTempDirectory("rea-jeb-layer-validation-");
  const lower = join(root, "lower.json");
  const configPath = join(root, "opencode.json");
  const bad = JSON.stringify({
    mcp: {
      rea: clientRegistrationEntry("opencode", ["rea", "mcp"], {
        REA_JEB_MCP_URL: "https://example.com/mcp",
      }),
    },
  });
  await writeFile(lower, bad);
  await writeFile(configPath, "{}\n");
  const client = {
    name: "opencode",
    format: "opencode",
    configPath,
    configPaths: [lower, configPath],
  } as const;
  const selected = { REA_JEB_MCP_URL: "http://127.0.0.1:8426/mcp" };
  expect(
    await inspectClientConfiguration(client, selected, ["rea", "mcp"]),
  ).toMatchObject({
    status: "invalid",
    remediation: expect.stringContaining(lower),
  });
  expect(await readFile(lower, "utf8")).toBe(bad);
  expect(await readFile(configPath, "utf8")).toBe("{}\n");
});

it("retains legacy OpenCode environment when migrating into a native server table", async () => {
  const root = await createTestTempDirectory("rea-opencode-environment-");
  const configPath = join(root, "opencode.json");
  const client = { name: "opencode", format: "opencode", configPath } as const;
  const custom = { REA_MCP_INPUT_SCHEMA_PROFILE: "compact" };
  await writeFile(
    configPath,
    JSON.stringify({
      mcp: {
        rea: clientRegistrationEntry("opencode", staleOwnedCommand, custom),
        servers: {
          other: clientRegistrationEntry("opencode_v2", ["other"], {}),
        },
      },
    }),
  );
  expect(
    await configureClientConfiguration(client, {}, ["rea", "mcp"]),
  ).toMatchObject({ status: "configured" });
  const parsed = parseClientConfiguration(
    await readFile(configPath, "utf8"),
    "opencode",
  );
  expect(parsed.legacyServers).toEqual({});
  expect(parsed.servers.rea).toEqual(
    clientRegistrationEntry("opencode_v2", ["rea", "mcp"], custom),
  );
  expect(
    await configureClientConfiguration(client, {}, ["rea", "mcp"]),
  ).toEqual({ status: "unchanged" });
});

it.each([
  [
    "non-string member",
    { REA_MCP_INPUT_SCHEMA_PROFILE: "compact", PORT: 8080 },
    "env.PORT",
  ],
  [
    "boolean member",
    { REA_MCP_INPUT_SCHEMA_PROFILE: "compact", FLAG: true },
    "env.FLAG",
  ],
  [
    "null member",
    { REA_MCP_INPUT_SCHEMA_PROFILE: "compact", VALUE: null },
    "env.VALUE",
  ],
  ["array", [], "env"],
  ["string", "not-a-map", "env"],
  ["null map", null, "env"],
  [
    "empty profile",
    { REA_MCP_INPUT_SCHEMA_PROFILE: "" },
    "REA_MCP_INPUT_SCHEMA_PROFILE",
  ],
  [
    "invalid profile",
    { REA_MCP_INPUT_SCHEMA_PROFILE: "bogus" },
    "REA_MCP_INPUT_SCHEMA_PROFILE",
  ],
  [
    "empty output profile",
    { REA_MCP_OUTPUT_SCHEMA_PROFILE: "" },
    "REA_MCP_OUTPUT_SCHEMA_PROFILE",
  ],
  [
    "invalid output profile",
    { REA_MCP_OUTPUT_SCHEMA_PROFILE: "bogus" },
    "REA_MCP_OUTPUT_SCHEMA_PROFILE",
  ],
  [
    "invalid response budget",
    { REA_MCP_MAX_RESPONSE_BYTES: "1" },
    "REA_MCP_MAX_RESPONSE_BYTES",
  ],
  [
    "ASAR header admission above its maximum",
    { REA_ASAR_MAX_HEADER_BYTES: "268435457" },
    "REA_ASAR_MAX_HEADER_BYTES",
  ],
  [
    "regex matching deadline of zero",
    { REA_REGEX_MATCHING_DEADLINE_MS: "0" },
    "REA_REGEX_MATCHING_DEADLINE_MS",
  ],
  [
    "capture decoder heap below its floor",
    { REA_CAPTURE_DECODER_OLD_GENERATION_MIB: "7" },
    "REA_CAPTURE_DECODER_OLD_GENERATION_MIB",
  ],
  [
    "regex worker heap request below its floor",
    { REA_REGEX_WORKER_HEAP_REQUEST_MIB: "6" },
    "REA_REGEX_WORKER_HEAP_REQUEST_MIB",
  ],
  [
    "bridge request ceiling below its floor",
    { REA_BRIDGE_MAX_REQUEST_BYTES: "7463" },
    "REA_BRIDGE_MAX_REQUEST_BYTES",
  ],
  [
    "bridge request ceiling above its maximum",
    { REA_BRIDGE_MAX_REQUEST_BYTES: "536870888" },
    "REA_BRIDGE_MAX_REQUEST_BYTES",
  ],
  [
    "MCP initialize budget of zero",
    { REA_MCP_INITIALIZE_BUDGET_MS: "0" },
    "REA_MCP_INITIALIZE_BUDGET_MS",
  ],
  [
    "MCP tools/list budget above its maximum",
    { REA_MCP_TOOLS_LIST_BUDGET_MS: "2147483648" },
    "REA_MCP_TOOLS_LIST_BUDGET_MS",
  ],
  [
    "MCP first-catalog budget with a leading zero",
    { REA_MCP_FIRST_CATALOG_BUDGET_MS: "020000" },
    "REA_MCP_FIRST_CATALOG_BUDGET_MS",
  ],
  [
    "MCP doctor deadline that is not decimal",
    { REA_MCP_DOCTOR_DEADLINE_MS: "30_000" },
    "REA_MCP_DOCTOR_DEADLINE_MS",
  ],
  [
    "malformed loader JSON",
    { HOPPER_LOADER_ARGS_JSON: "{" },
    "HOPPER_LOADER_ARGS_JSON",
  ],
  [
    "non-array loader JSON",
    { HOPPER_LOADER_ARGS_JSON: "{}" },
    "HOPPER_LOADER_ARGS_JSON",
  ],
  [
    "NUL loader argument",
    { HOPPER_LOADER_ARGS_JSON: JSON.stringify(["a\0b"]) },
    "HOPPER_LOADER_ARGS_JSON",
  ],
  [
    "malformed exclusion JSON",
    { REA_REFERENCE_SECRET_PATTERNS_JSON: "{" },
    "REA_REFERENCE_SECRET_PATTERNS_JSON",
  ],
  [
    "empty exclusion pattern",
    { REA_REFERENCE_SECRET_PATTERNS_JSON: '[""]' },
    "REA_REFERENCE_SECRET_PATTERNS_JSON",
  ],
  [
    "unpaired compiler specification",
    { REA_GHIDRA_COMPILER_SPEC_ID: "borlandcpp" },
    "REA_GHIDRA_COMPILER_SPEC_ID",
  ],
] as const)(
  "refuses %s before changing the configuration",
  async (_name, env, setting) => {
    const home = await createTestTempDirectory("rea-invalid-environment-");
    const directory = join(home, ".cursor");
    const configPath = join(directory, "mcp.json");
    await mkdir(directory);
    const original = JSON.stringify({
      mcpServers: { rea: { command: "rea", args: ["mcp"], env } },
    });
    await writeFile(configPath, original);
    const client = { name: "cursor", format: "json", configPath } as const;
    expect(
      await inspectClientConfiguration(client, {}, ["rea", "mcp"]),
    ).toMatchObject({
      status: "invalid",
      remediation: expect.stringContaining(setting),
    });
    expect(
      await configureClientConfiguration(client, {}, ["rea", "mcp"]),
    ).toEqual({ status: "failed", reason: "readback" });
    expect(await clientConfigurationAligned(client, {}, ["rea", "mcp"])).toBe(
      false,
    );
    const statuses = await readClientRegistrationStatuses(home, "rea", {
      environment: {},
    });
    expect(statuses.find(({ client }) => client === "cursor")).toMatchObject({
      state: "invalid",
      remediation: expect.stringContaining(setting),
    });
    expect(await readFile(configPath, "utf8")).toBe(original);
    await expect(access(`${configPath}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("refuses an unidentified launch command before creating a client configuration", async () => {
  const home = await createTestTempDirectory("rea-registration-unidentified-");
  const configPath = join(home, "missing", "mcp.json");
  const result = await configureClientConfiguration(
    { name: "claude_code", configPath, format: "json" },
    {},
    [],
  );
  expect(result).toMatchObject({
    status: "failed",
    reason: "registration_ownership",
  });
  await expect(access(join(home, "missing"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
