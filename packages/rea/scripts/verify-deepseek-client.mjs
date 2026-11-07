import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import { TOOL_CONTRACTS } from "../dist/contracts/toolContracts.js";
import { pathExists } from "./lib/verify-package-core.mjs";
import { createVerifierCommands } from "./lib/verify-commands.mjs";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";
import { saveVerifierCommandOutput } from "./lib/verifier-command-output.mjs";
import {
  CLIENT_JAVASCRIPT_FIXTURE_SOURCE,
  assertClientJavaScriptFixtureEvidence,
} from "./verify/clients/javascript-fixture.mjs";
import {
  findClientResult,
  isClientJavaScriptEvidence,
} from "./verify/clients/result-discovery.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";
import { importVerifierSource } from "./lib/verifier-source-loader.mjs";
import { createOpenAiModelFixture } from "./verify/clients/model-fixture.mjs";

const mode = process.argv[2] ?? "call";
assert(["chat", "call"].includes(mode), "Select chat or call.");
assert(process.platform !== "win32", "Native Windows coverage is unverified.");
const { assertClientSchemaPatterns } = await importVerifierSource(
  new URL("./lib/client-schema-patterns.mts", import.meta.url).href,
  import.meta.url,
);

const repo = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoot = process.env.REA_VERIFY_RUNTIME_ROOT ?? repo;
const command = process.env.REA_VERIFY_DEEPSEEK_COMMAND ?? "dsh";
const lab = await mkdtemp(join(tmpdir(), "rea-deepseek-client-"));
const account = join(lab, "account");
const profile = join(lab, "selected profile");
const workspace = join(lab, "workspace");
const target = join(workspace, "fixture α测试");
const skillPath = join(
  account,
  ".agents",
  "skills",
  "reverse-engineer-anything",
  "SKILL.md",
);
const cli = join(runtimeRoot, "scripts", "rea.mjs");
const configPath = join(profile, "cordis.patch.yml");
const verifier = createVerifierRun();
let clientVersion = null;
let fixture;
let passed = false;
let catalog;
let patternCount = 0;
let skillRequested = false;
let skillLoaded = false;
let evidenceSeen = false;
let finalSeen = false;
let artifactDigest;
let mainRequests = 0;
const lifecycle = [];
const patterns = new Set();
const commands = await createVerifierCommands();
await withVerifierCleanup(async () => {
  await withVerifierCleanup(async () => {
    await Promise.all([
      mkdir(account),
      mkdir(profile),
      mkdir(target, { recursive: true }),
    ]);
    const environment = {
      PATH: process.env.PATH ?? "",
      HOME: account,
      USERPROFILE: account,
      DSH_HOME: profile,
      OPENAI_API_KEY: "local-fixture-key",
      REA_PROCESS_RUN_ID: verifier.run_id,
    };
    // A temporary directory under the checkout must not inherit its project skills or AGENTS.md.
    await commands.exec(
      "git",
      ["-c", "init.defaultBranch=main", "init", "--quiet", workspace],
      {
        env: environment,
        timeout: 30_000,
        stdin: "pipe",
      },
    );
    await writeFile(join(target, "app.js"), CLIENT_JAVASCRIPT_FIXTURE_SOURCE);
    clientVersion = (
      await commands.exec(command, ["--version"], {
        env: environment,
        cwd: workspace,
        timeout: 30_000,
        stdin: "pipe",
      })
    ).stdout.trim();
    const runRea = async (args, artifact) => {
      const result = await commands.exec(
        process.execPath,
        [cli, ...args, "--json"],
        {
          env: environment,
          cwd: workspace,
          timeout: 60_000,
          stdin: "pipe",
        },
      );
      await writeFile(join(lab, `${artifact}.json`), result.stdout);
      return JSON.parse(result.stdout);
    };
    const patches = (text) =>
      parseYaml(text, {
        customTags: [
          {
            tag: "tag:yaml.org,2002:js",
            resolve: (source) => ({ __jsExpr: source }),
          },
        ],
      });
    const withoutRea = (text) =>
      patches(text).flatMap((op) => {
        if (op.id === "rea-mcp") return [];
        if (!Array.isArray(op.insert)) return [op];
        const insert = op.insert.filter((entry) => entry.id !== "rea-mcp");
        return insert.length === 0 ? [] : [{ ...op, insert }];
      });

    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    fixture = await createOpenAiModelFixture({
      directory: lab,
      prefix: `deepseek-${mode}`,
      onRequest: async ({ body, tools, requestIndex }) => {
        // Harness generates a session title in a separate, tool-free model request.
        if (tools.length === 0)
          return { role: "assistant", content: "REA validation" };
        assert(
          ++mainRequests <= 4,
          "Harness did not complete the bounded fixture workflow.",
        );
        const rea = tools.filter((tool) => tool.name.startsWith("mcp__rea__"));
        const observedCatalog = rea
          .map((tool) => tool.name.slice("mcp__rea__".length))
          .sort();
        assert.deepEqual(
          observedCatalog,
          TOOL_CONTRACTS.map((tool) => tool.name).sort(),
        );
        if (catalog === undefined) {
          catalog = observedCatalog;
          for (const tool of rea) {
            assert(
              ajv.validateSchema(tool.parameters),
              `${tool.name}: ${ajv.errorsText(ajv.errors)}`,
            );
            const forwardedPatterns = assertClientSchemaPatterns(
              tool.parameters,
            );
            for (const pattern of forwardedPatterns) patterns.add(pattern);
            patternCount += forwardedPatterns.length;
          }
          assert(
            patternCount > 0,
            "The advertised regex constraints must reach the model.",
          );
        }
        const toolMessages = (body.messages ?? []).filter(
          (message) => message.role === "tool",
        );
        const serialized = JSON.stringify(toolMessages);
        skillLoaded ||=
          serialized.includes(
            '<skill_content name=\\"reverse-engineer-anything\\">',
          ) && serialized.includes(dirname(skillPath));
        for (const message of toolMessages) {
          const found = findClientResult(
            message.content,
            isClientJavaScriptEvidence,
          );
          if (found === undefined) continue;
          const { evidence } = await assertClientJavaScriptFixtureEvidence(
            found,
            target,
          );
          const text = JSON.stringify(evidence);
          await writeFile(join(lab, "evidence.json"), text);
          artifactDigest = createHash("sha256").update(text).digest("hex");
          evidenceSeen = true;
        }
        if (mode === "chat" || evidenceSeen) {
          finalSeen = true;
          return { role: "assistant", content: "REA_CLIENT_COMPATIBILITY_OK" };
        }
        const call = (name, args) => ({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call_rea_${requestIndex}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        });
        if (!skillRequested) {
          assert(tools.some((tool) => tool.name === "skill"));
          skillRequested = true;
          return call("skill", { name: "reverse-engineer-anything" });
        }
        assert(
          skillLoaded,
          "Harness must load the installed skill before analysis.",
        );
        return call("mcp__rea__analyze_javascript_application", {
          input_path: target,
          format: "directory",
        });
      },
    });
    // Seed model settings and a stale registration; the public setup workflow
    // must produce the registration this native client actually boots.
    const original = `
- id: llm-pi-ai
  config:
    providers:
      rea-fixture:
        apiKeyEnv: OPENAI_API_KEY
        api: openai-completions
        baseURL: ${fixture.baseUrl}
        defaultMaxTokens: 4096
        retryPolicy:
          mode: normal
          maxRetries: 0
        models:
          - id: rea-client-fixture
            contextWindow: 1000000
- id: agent-default-model
  config:
    provider: rea-fixture
    model: rea-client-fixture
- insert:
    - id: rea-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
        cwd: !!js process.cwd()
        env:
          REA_PROCESS_RUN_ID: ${JSON.stringify(verifier.run_id)}
`;
    await writeFile(configPath, original);
    const planned = await runRea(
      ["setup", "--client", "dsh", "--dry-run"],
      "setup-plan",
    );
    assert.equal(planned.status, "planned");
    assert(
      planned.plannedActions.some((action) => action.target === configPath),
    );
    assert(
      planned.plannedActions.some(
        (action) => action.target === dirname(skillPath),
      ),
    );
    assert(
      planned.plannedActions.every(
        (action) =>
          action.target === configPath || action.target === dirname(skillPath),
      ),
    );
    assert.equal(await readFile(configPath, "utf8"), original);
    assert.equal(await pathExists(`${configPath}.rea.backup`), false);
    lifecycle.push("dry-run");
    const setup = await runRea(["setup", "--client", "dsh", "--yes"], "setup");
    assert.equal(setup.status, "ready");
    assert.equal(await readFile(`${configPath}.rea.backup`, "utf8"), original);
    const configured = await readFile(configPath, "utf8");
    assert.deepEqual(withoutRea(configured), withoutRea(original));
    assert(configured.includes("!!js process.cwd()"));
    assert(
      (await readFile(skillPath, "utf8")).includes(
        "name: reverse-engineer-anything",
      ),
    );
    lifecycle.push("setup");
    const repeated = await runRea(
      ["setup", "--client", "dsh", "--yes"],
      "setup-repeat",
    );
    assert.deepEqual(repeated.appliedActions, []);
    assert.equal(await readFile(configPath, "utf8"), configured);
    assert.equal(await readFile(`${configPath}.rea.backup`, "utf8"), original);
    lifecycle.push("idempotent-setup");
    const doctor = await runRea(
      ["doctor", "--client", "dsh", "--skill"],
      "doctor",
    );
    assert.equal(doctor.healthy, true);
    lifecycle.push("doctor");
    const result = await saveVerifierCommandOutput(
      () =>
        commands.exec(
          command,
          [
            "--profile",
            "headless",
            "--json",
            mode === "chat"
              ? "Say hello briefly."
              : `Use REA to analyze ${target}.`,
          ],
          {
            env: environment,
            cwd: workspace,
            timeout: 120_000,
            stdin: "closed-pipe",
            maxBuffer: 10 * 1024 * 1024,
          },
        ),
      {
        stdout: join(lab, "client.stdout"),
        stderr: join(lab, "client.stderr"),
      },
    );
    assert.equal(fixture.failure, undefined);
    assert(finalSeen && result.stdout.includes("REA_CLIENT_COMPATIBILITY_OK"));
    if (mode === "call") assert(evidenceSeen && skillLoaded);
    lifecycle.push(mode === "call" ? "native-tool-invocation" : "native-chat");
    const uninstall = await runRea(["uninstall"], "uninstall");
    assert.equal(uninstall.status, "complete");
    assert(
      uninstall.items.some(
        (item) => item.name === "dsh" && item.status === "removed",
      ),
    );
    assert.deepEqual(
      patches(await readFile(configPath, "utf8")),
      withoutRea(original),
    );
    assert.equal(await pathExists(skillPath), false);
    lifecycle.push("uninstall");
  }, [
    () => commands.close(),
    async () => {
      await fixture?.close();
    },
  ]);
  passed = true;
}, [
  async () => {
    const receipt = {
      client: "deepseek-harness",
      clientVersion,
      mode,
      lifecycle,
      passed,
      artifacts: lab,
      runtimeRoot,
      host: {
        platform: process.platform,
        architecture: process.arch,
        node: process.versions.node,
      },
      modelFixture:
        "loopback custom OpenAI-compatible adapter; no live DeepSeek provider claim",
      modelContextWindow: 1000000,
      skillDiscovery:
        "native HOME shared personal directory; isolated project root",
      catalogSize: catalog?.length,
      patternCount,
      uniquePatterns: patterns.size,
      skillLoaded,
      evidenceSeen,
      artifactDigest,
      finalSeen,
      requests: fixture?.requests,
      fixtureFailure: fixture?.failure,
      verifier: await completeVerifierRun(verifier),
    };
    await withVerifierCleanup(
      () =>
        writeFile(join(lab, "receipt.json"), JSON.stringify(receipt, null, 2)),
      [
        () => {
          console.log(JSON.stringify(receipt));
        },
      ],
    );
  },
]);
