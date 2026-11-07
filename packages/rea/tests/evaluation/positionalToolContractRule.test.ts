import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { RuleTester } from "oxlint/plugins-dev";
import rule from "../../scripts/lint/rules/no-positional-tool-contract.mjs";
import { collectToolCatalogSources } from "../../scripts/lint/rules/tool-catalog-sources.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const filename = fileURLToPath(
  new URL("../../src/server/ruleControl.ts", import.meta.url),
);
const catalog =
  'import { GPU_TOOL_CONTRACTS as contracts } from "../contracts/gpu/gpuToolContracts.js";';
const catalogSource = new URL(
  "../../src/contracts/gpu/gpuToolContracts.js",
  import.meta.url,
);
tester.run("no-positional-tool-contract", rule, {
  valid: [
    `import {GPU_TOOL_CONTRACTS as contracts} from ${JSON.stringify(catalogSource.href)}; function read(contracts: {name: string}[]) { return contracts[0].name; }`,
    'import {GPU_TOOL_CONTRACTS as contracts} from "https://example.test/src/contracts/gpu/gpuToolContracts.js"; contracts[0].name;',
    `import {GPU_TOOL_CONTRACTS as contracts} from ${JSON.stringify(`${catalogSource.href}#other`)}; contracts[0].name;`,
    `${catalog} for (const contract of contracts) register(contract);`,
    `${catalog} contracts.forEach(register);`,
    `${catalog} const selected = contracts.find(contract => contract.name === "inspect_gpu_code_objects");`,
    `${catalog} type Contract = (typeof contracts)[number];`,
    `${catalog} const copies = [...contracts];`,
    `${catalog} const [...copies] = contracts;`,
    `${catalog} function read(contracts: {name: string}[]) { return contracts[0].name; }`,
    `${catalog} function read() { const contracts = [{name: "local"}]; return contracts.at(0)?.name; }`,
    'import { GPU_TOOL_CONTRACTS as contracts } from "../unrelated.js"; contracts[0].name;',
    'import { unrelated as contracts } from "../contracts/gpu/gpuToolContracts.js"; contracts[0].name;',
    'const TOOL_CONTRACTS = [{name: "local"}]; TOOL_CONTRACTS[0].name;',
    `${catalog} const mutable = [...contracts]; mutable[0].inputSchema;`,
    `${catalog} contracts.length;`,
    `${catalog} contracts[0]; contracts.at(1); const [unused] = contracts;`,
    `${catalog} expect(contracts[0]?.description).toContain("documented behavior");`,
    `${catalog} const [first] = contracts; const toggled = contracts.map(contract => contract === first ? {...contract, returnsTargetContent: !contract.returnsTargetContent} : contract); createCatalogDigests(toggled);`,
    `${catalog} const selected = contracts[0]; const alias = selected; display(alias.description);`,
    `${catalog} const selected = contracts[0]; selected.name = "catalog-control";`,
    `${catalog} const [selected] = contracts; const { description } = selected; display(description);`,
    `${catalog} function toolRegistrationOptions(contract: unknown) {} toolRegistrationOptions(contracts[0]);`,
    `${catalog} { const contracts = [{name: "local"}]; contracts[0].name; }`,
    'import * as catalogs from "../contracts/gpu/gpuToolContracts.js"; function read(catalogs: {GPU_TOOL_CONTRACTS: {name: string}[]}) { return catalogs.GPU_TOOL_CONTRACTS[0].name; }',
    'import * as catalogs from "../contracts/gpu/gpuToolContracts.js"; catalogs.other[0].name;',
  ].map((code) => ({ code, filename })),
  invalid: [
    `import {GPU_TOOL_CONTRACTS as contracts} from ${JSON.stringify(catalogSource.href)}; contracts[0].name;`,
    `import {GPU_TOOL_CONTRACTS as contracts} from ${JSON.stringify(fileURLToPath(catalogSource))}; contracts[0].inputSchema;`,
    `${catalog} import {toolRegistrationOptions as options} from ${JSON.stringify(new URL("../../src/server/toolRegistrationOptions.js", import.meta.url).href)}; options(contracts[0]);`,
    `${catalog} register(contracts[0].name);`,
    `${catalog} contracts["0"].inputSchema.parse(input);`,
    `${catalog} contracts.at(-1)?.outputSchema;`,
    `${catalog} contracts["at"](1)?.name;`,
    `${catalog} const alias = contracts; alias[2].name;`,
    `${catalog} const first = contracts; const second = first; second[0].outputSchema;`,
    `${catalog} type Selected = (typeof contracts)[0];`,
    `${catalog} const [first] = contracts; register(first.name);`,
    `${catalog} const [, second] = contracts; const selected = second; selected.inputSchema;`,
    `${catalog} const selected = contracts[0]; const alias = selected; alias.inputSchema;`,
    `${catalog} const { inputSchema } = contracts[0];`,
    `${catalog} import {toolRegistrationOptions as options} from "./toolRegistrationOptions.js"; options(contracts[0]);`,
    `${catalog} import {applicationToolRegistrationOptions as options} from "./toolRegistrationOptions.ts"; const selected = contracts.at(0); options(selected);`,
    `${catalog} const selected = contracts[0]; selected.name; selected.outputSchema;`,
    'import * as catalogs from "../contracts/gpu/gpuToolContracts.js"; catalogs.GPU_TOOL_CONTRACTS[0].name;',
    'import * as catalogs from "../contracts/gpu/gpuToolContracts.js"; type Selected = (typeof catalogs.GPU_TOOL_CONTRACTS)[0];',
    'import { TOOL_CONTRACTS } from "../contracts/toolContracts.ts"; TOOL_CONTRACTS[0].name;',
    'import { MODEL_TOOL_CONTRACTS as selected } from "../contracts/model/modelToolContracts.js"; selected[0].inputSchema;',
    'import { IL2CPP_TOOL_CONTRACTS as selected } from "../contracts/il2cpp/il2cppToolContracts.js"; selected[0].outputSchema;',
    'import { BROWSER_SCENARIO_TOOL_CONTRACTS as nested } from "../contracts/browserScenarioToolContracts.js"; nested[0].name;',
    'import { FUNCTION_WORKFLOW_TOOL_CONTRACTS as nested } from "../contracts/functionWorkflowToolContracts.js"; nested.at(0)?.name;',
  ].map((code) => ({ code, filename, errors: [{ messageId: "positional" }] })),
});

const sourcePath = (name: string) =>
  fileURLToPath(new URL(`./catalog-rule-fixture/${name}`, import.meta.url));

describe("canonical catalog source composition", () => {
  it("discovers newly composed exports and nested groups without evaluating modules", () => {
    const sources = new Map([
      [
        sourcePath("toolContracts.ts"),
        `
        import { NEW_CATALOG as renamed } from "./newCatalog.js";
        import { GROUP } from "./group.js";
        import { UNUSED } from "./unused.js";
        const generated = buildContracts();
        const local = [...renamed, ...GROUP, ...generated, ...UNUSED.map(makeContract)];
        const alias = local;
        export const TOOL_CONTRACTS = [...alias] as const;
      `,
      ],
      [
        sourcePath("newCatalog.ts"),
        `
        throw new Error("Must never execute the runtime catalog");
        export const NEW_CATALOG = [{name: "new_tool"}];
      `,
      ],
      [
        sourcePath("group.ts"),
        `
        import { NESTED as alias } from "./nested.ts";
        export const GROUP = [...alias] satisfies readonly unknown[];
      `,
      ],
      [
        sourcePath("nested.ts"),
        'export const NESTED = [{name: "nested_tool"}];',
      ],
    ]);
    const actual = collectToolCatalogSources(
      sourcePath("toolContracts.ts"),
      (path) => {
        const source = sources.get(path);
        if (source === undefined)
          throw new Error(`Unexpected source read: ${path}`);
        return source;
      },
    );
    expect(actual).toEqual(
      new Map([
        [sourcePath("toolContracts"), new Set(["TOOL_CONTRACTS"])],
        [sourcePath("newCatalog"), new Set(["NEW_CATALOG"])],
        [sourcePath("group"), new Set(["GROUP"])],
        [sourcePath("nested"), new Set(["NESTED"])],
      ]),
    );
  });

  it("accepts official computed definitions while discovering imported catalog groups", () => {
    const actual = collectToolCatalogSources(
      fileURLToPath(
        new URL("../../src/contracts/toolContracts.ts", import.meta.url),
      ),
    );
    const official = fileURLToPath(
      new URL("../../src/contracts/officialToolContracts", import.meta.url),
    );
    const definitions = fileURLToPath(
      new URL("../../src/contracts/hopperMemoryContracts", import.meta.url),
    );
    const nested = fileURLToPath(
      new URL(
        "../../src/contracts/browserScenarioToolContracts",
        import.meta.url,
      ),
    );
    expect(actual.get(official)).toEqual(new Set(["OFFICIAL_TOOL_CONTRACTS"]));
    expect(actual.has(definitions)).toBe(false);
    expect(actual.get(nested)).toEqual(
      new Set(["BROWSER_SCENARIO_TOOL_CONTRACTS"]),
    );
  });

  it("propagates source-read and parse failures instead of disabling enforcement", () => {
    const failure = new Error("catalog source unavailable");
    expect(() =>
      collectToolCatalogSources(sourcePath("toolContracts.ts"), () => {
        throw failure;
      }),
    ).toThrow(failure);
    expect(() =>
      collectToolCatalogSources(
        sourcePath("toolContracts.ts"),
        () => "export const TOOL_CONTRACTS = [",
      ),
    ).toThrow();
  });

  it.each([
    "export const TOOL_CONTRACTS = buildCatalog();",
    "export const OTHER = [];",
    "const alias = alias; export const TOOL_CONTRACTS = [...alias];",
    "export const TOOL_CONTRACTS = [...unresolved];",
  ])("refuses unsupported or missing canonical composition: %s", (source) => {
    expect(() =>
      collectToolCatalogSources(sourcePath("toolContracts.ts"), () => source),
    ).toThrow();
  });
});
