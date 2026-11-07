import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { BYTE_ENTROPY_PROVIDER } from "../../../src/domain/investigationProviders.js";
import { SUPPORTED_CLIENT_DEFINITIONS } from "../../../src/application/SupportedClients.js";
import { CLI_COMMAND_NAMES } from "../../../src/cliCommandNames.js";
import { createCli } from "../../../src/cli.js";
import { FRIDA_PROVIDER_IDENTITY } from "../../../src/frida/FridaInstrumentationManager.js";
import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";
import {
  HOPPER_OPERATIONS,
  HOPPER_PROVIDER_IDENTITY,
} from "../../../src/hopper/HopperProviderCapabilities.js";
import {
  GHIDRA_PROVIDER_IDENTITY,
  GHIDRA_OPERATIONS,
} from "../../../src/ghidra/GhidraProviderCapabilities.js";
import { OBJDUMP_PROVIDER_IDENTITY } from "../../../src/objdump/ObjdumpCommand.js";
import { RIZIN_PROVIDER_IDENTITY } from "../../../src/rizin/RizinCommand.js";
import { GDB_PROVIDER_IDENTITY } from "../../../src/gdb/GdbSessionManager.js";
import { PWNTOOLS_PROVIDER_IDENTITY } from "../../../src/native/pwntools/PwntoolsRelease.js";
import {
  documentationFactIssues,
  skillReferenceIssues,
} from "../../../scripts/lib/docs-facts.mjs";
import { ensureGeneratedFile } from "../../../scripts/lib/generated-file.mjs";
import {
  createCliInventory,
  cliCommandDescriptionIssues,
  cliCommandOptionNames,
} from "../../../scripts/lib/catalog-cli.mjs";
import {
  createProductCatalog,
  serializeProductCatalog,
} from "../../../scripts/lib/product-catalog.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("canonical product catalog", () => {
  it("admits every documented browser scenario through the named contract", async () => {
    const guide = await readFile(
      join(root, "docs/browser-scenario-contract.md"),
      "utf8",
    );
    const examples = [
      ...guide.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/gu),
    ].map((match) => match[1] ?? "");
    expect(examples.length).toBeGreaterThanOrEqual(2);
    const contract = TOOL_CONTRACTS.find(
      ({ name }) => name === "capture_browser_scenario",
    );
    if (contract === undefined)
      throw new Error("Missing browser scenario contract");
    for (const example of examples)
      expect(contract.inputSchema.safeParse(JSON.parse(example)).success).toBe(
        true,
      );
  });

  it("matches every source-derived build-generated product fact", async () => {
    const catalog = await createProductCatalog(root);
    expect(catalog.setup_clients.map(({ id }) => id)).toEqual(
      SUPPORTED_CLIENT_DEFINITIONS.map(({ name }) => name),
    );
    expect(catalog.cli.commands).toHaveLength(CLI_COMMAND_NAMES.length);
    expect(catalog.providers.map(({ id }) => id)).toEqual(
      expect.arrayContaining(
        [
          OBJDUMP_PROVIDER_IDENTITY,
          RIZIN_PROVIDER_IDENTITY,
          GDB_PROVIDER_IDENTITY,
        ].map(({ id }) => id),
      ),
    );
    expect(
      catalog.providers.find(({ id }) => id === HOPPER_PROVIDER_IDENTITY.id)
        ?.capabilities,
    ).toEqual([...HOPPER_OPERATIONS].sort());
    expect(
      catalog.providers.find(({ id }) => id === GHIDRA_PROVIDER_IDENTITY.id)
        ?.capabilities,
    ).toEqual([...GHIDRA_OPERATIONS].sort());
    expect(
      catalog.providers.find(({ id }) => id === FRIDA_PROVIDER_IDENTITY.id)
        ?.capabilities,
    ).toEqual(
      TOOL_CONTRACTS.filter(({ name }) => name.includes("frida"))
        .map(({ name }) => name)
        .sort(),
    );
    expect(
      catalog.providers.find(({ id }) => id === BYTE_ENTROPY_PROVIDER.id),
    ).toEqual({
      id: "byte-entropy",
      name: "REA byte entropy",
      version: "1",
      capabilities: ["inspect_byte_entropy"],
    });
    expect(
      catalog.providers.find(({ id }) => id === PWNTOOLS_PROVIDER_IDENTITY.id)
        ?.capabilities,
    ).toEqual(["inspect_binary_layout", "inspect_recorded_crash"]);
    expect(
      JSON.parse(await readFile("docs/public/product-catalog.json", "utf8")),
    ).toEqual(catalog);
    expect(await serializeProductCatalog(catalog)).toBe(
      await readFile("docs/public/product-catalog.json", "utf8"),
    );
    await expect(documentationFactIssues(root, catalog)).resolves.toEqual([]);
  }, 60_000);
});

describe("canonical CLI catalog", () => {
  it("uses the same primary command names as the actual Incur router", () => {
    const inventory = createCliInventory(createCli());
    expect(inventory.primary).toEqual([...CLI_COMMAND_NAMES].sort());
    expect(inventory.aliases).toEqual([]);
  }, 30_000);

  it("describes every primary command argument and option", () => {
    expect(cliCommandDescriptionIssues(createCli())).toEqual([]);
  });

  it("exposes the shared provider selector on every deep-analysis command", () => {
    const cli = createCli();
    for (const name of [
      "analyze",
      "inspect",
      "decompile",
      "xrefs",
      "trace",
      "function",
      "annotate-native-function",
      "inspect-native-api",
      "search",
    ]) {
      expect(cliCommandOptionNames(cli, name)).toContain("provider");
    }
  });

  it("does not impose a private result limit on feature tracing", () => {
    expect(cliCommandOptionNames(createCli(), "trace")).not.toContain("limit");
  });
});

describe("canonical product catalog drift", () => {
  it("rejects missing and repository-only links in an independently installed skill", async () => {
    const directory = await createTestTempDirectory("rea-skill-references-");
    const bundle = join(directory, "skill");
    await mkdir(bundle);
    await writeFile(join(directory, "repo-only.md"), "Repository-only guide");
    await writeFile(join(bundle, "local.md"), "Bundled guide");
    await writeFile(
      join(bundle, "SKILL.md"),
      [
        "[bundled](local.md#guide)",
        "[missing](missing.md)",
        "[repository-only](../repo-only.md)",
        "[public](https://example.test/guide)",
      ].join("\n"),
    );
    expect(await skillReferenceIssues(bundle)).toEqual([
      "SKILL.md: missing skill reference: missing.md",
      "SKILL.md: reference escapes installed skill bundle: ../repo-only.md",
    ]);
  });

  it("requires setup-client facts in the canonical installation guide", async () => {
    const catalog = await createProductCatalog(root);
    const drifted = {
      ...catalog,
      setup_clients: [
        ...catalog.setup_clients,
        {
          id: "future_client",
          display_name: "Future Client",
          format: "json",
          configuration: "managed",
        },
      ],
    };
    const issues = await documentationFactIssues(root, drifted);
    expect(issues).toContain("docs/installation.md: missing Future Client");
    expect(issues).not.toContain("README.md: missing Future Client");
  });

  it("fails check mode without rewriting a stale generated artifact", async () => {
    const directory = await createTestTempDirectory("rea-generated-check-");
    temporaryRoots.push(directory);
    const path = join(directory, "catalog.json");
    await writeFile(path, "stale\n", "utf8");
    await expect(
      ensureGeneratedFile({
        path,
        source: "current\n",
        check: true,
        generateCommand: "npm run docs:generate",
      }),
    ).rejects.toThrow("missing or stale");
    expect(await readFile(path, "utf8")).toBe("stale\n");
    await expect(
      ensureGeneratedFile({
        path,
        source: "current\n",
        check: false,
        generateCommand: "npm run docs:generate",
      }),
    ).resolves.toEqual({ changed: true });
    expect(await readFile(path, "utf8")).toBe("current\n");
  });

  it("accepts and preserves native generated-file line endings", async () => {
    const directory = await createTestTempDirectory("rea-generated-eol-");
    temporaryRoots.push(directory);
    const path = join(directory, "catalog.json");
    await writeFile(path, "current\r\n", "utf8");
    await expect(
      ensureGeneratedFile({
        path,
        source: "current\n",
        check: true,
        generateCommand: "npm run docs:generate",
      }),
    ).resolves.toEqual({ changed: false });
    expect(await readFile(path, "utf8")).toBe("current\r\n");
    await expect(
      ensureGeneratedFile({
        path,
        source: "updated\n",
        check: false,
        generateCommand: "npm run docs:generate",
      }),
    ).resolves.toEqual({ changed: true });
    expect(await readFile(path, "utf8")).toBe("updated\r\n");
  });
});
