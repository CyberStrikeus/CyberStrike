import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  TOOL_CONTRACTS,
  toolContract,
} from "../dist/contracts/toolContracts.js";
import { createVerifierCommands } from "./lib/verify-commands.mjs";
import { saveVerifierCommandOutput } from "./lib/verifier-command-output.mjs";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";
import {
  CLIENT_JAVASCRIPT_FIXTURE_SOURCE,
  assertClientJavaScriptFixtureEvidence,
} from "./verify/clients/javascript-fixture.mjs";
import {
  findClientResult,
  isClientJavaScriptEvidence,
} from "./verify/clients/result-discovery.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";
import { createGeminiModelFixture } from "./verify/clients/gemini-model-fixture.mjs";
import { importVerifierSource } from "./lib/verifier-source-loader.mjs";

const { geminiUnsupportedLiteral } = await importVerifierSource(
  new URL("./lib/gemini-schema-literals.mts", import.meta.url).href,
  import.meta.url,
);

const repo = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoot = process.env.REA_VERIFY_RUNTIME_ROOT ?? repo;
const command = process.env.REA_VERIFY_GEMINI_COMMAND ?? "gemini";
const mode = process.argv[2] ?? "call";
const schemaProfile = process.env.REA_VERIFY_GEMINI_SCHEMA_PROFILE ?? "full";
assert(["full", "compact"].includes(schemaProfile));
// npm installs of Gemini CLI provide a JavaScript entry point; on Windows only a gemini.cmd shim reaches
// PATH, which Node does not spawn without a shell, so a selected .js entry runs under this Node. It is
// resolved once, because the preflight runs from the caller's directory and the client from the workspace.
const entryPoint = /\.(c|m)?js$/iu.test(command) ? resolve(command) : undefined;
const launch = (args) =>
  entryPoint === undefined
    ? [command, args]
    : [process.execPath, [entryPoint, ...args]];
assert(
  ["chat", "call"].includes(mode),
  "Usage: verify-gemini-client.mjs [chat|call]",
);
const verifier = createVerifierRun();
const lab = await mkdtemp(join(tmpdir(), "rea-gemini-client-"));
const account = join(lab, "account");
const profile = join(lab, "selected profile");
const workspace = join(lab, "workspace");
const configPath = join(profile, ".gemini", "settings.json");
const skillPath = join(
  profile,
  ".agents",
  "skills",
  "reverse-engineer-anything",
  "SKILL.md",
);
let clientVersion = null;
let fixture;
let passed = false;
let evidenceSeen = false;
let skillLoaded = false;
let skillRequested = false;
let finalSeen = false;
let catalogSize = null;
let schemasChecked = 0;
let examplesChecked = 0;
let artifactDigest;
const commands = await createVerifierCommands();
await withVerifierCleanup(async () => {
  await withVerifierCleanup(async () => {
    await Promise.all([
      mkdir(account),
      mkdir(workspace),
      mkdir(join(profile, ".gemini"), { recursive: true }),
    ]);
    await commands.exec("git", ["init", "--quiet", workspace], {
      timeout: 30_000,
      stdin: "pipe",
    });
    await writeFile(join(lab, "system-settings.json"), "{}\n");
    await writeFile(join(lab, "system-defaults.json"), "{}\n");
    const environment = {
      PATH: process.env.PATH ?? "",
      USERPROFILE: account,
      GEMINI_CLI_HOME: profile,
      GEMINI_CLI_SYSTEM_SETTINGS_PATH: join(lab, "system-settings.json"),
      GEMINI_CLI_SYSTEM_DEFAULTS_PATH: join(lab, "system-defaults.json"),
      // Preserve the caller's bounded Node heap instead of the launcher's host-memory auto-sizing.
      GEMINI_CLI_NO_RELAUNCH: "1",
      GEMINI_CLI_TRUST_WORKSPACE: "true",
      REA_PROCESS_RUN_ID: verifier.run_id,
      REA_MCP_INPUT_SCHEMA_PROFILE: schemaProfile,
    };
    try {
      clientVersion = (
        await commands.exec(...launch(["--version"]), {
          env: environment,
          timeout: 30_000,
          stdin: "pipe",
        })
      ).stdout.trim();
    } catch (cause) {
      const windowsHint =
        process.platform === "win32"
          ? " On Windows, select the JavaScript entry point; npm installs provide it as node_modules/@google/gemini-cli/bundle/gemini.js."
          : "";
      throw new Error(
        `Gemini preflight failed for ${command}; install Gemini CLI or set REA_VERIFY_GEMINI_COMMAND.${windowsHint} ${String(cause)}`,
        { cause },
      );
    }
    const original = JSON.stringify(
      {
        security: {
          auth: { selectedType: "gemini-api-key" },
          folderTrust: { enabled: false },
        },
        telemetry: { enabled: false },
        advanced: { autoConfigureMemory: false },
        model: { name: "gemini-2.5-flash", maxSessionTurns: 8 },
        mcpServers: { other: { command: "unrelated-server" } },
      },
      null,
      2,
    );
    await writeFile(configPath, original);
    for (const args of [
      ["setup", "--client", "gemini_cli", "--dry-run"],
      ["setup", "--client", "gemini_cli", "--yes"],
      ["doctor", "--client", "gemini_cli", "--skill"],
    ]) {
      const result = await commands.exec(
        process.execPath,
        [join(runtimeRoot, "scripts/rea.mjs"), ...args, "--json"],
        { env: environment, cwd: workspace, timeout: 60_000, stdin: "pipe" },
      );
      const parsed = JSON.parse(result.stdout);
      if (args[0] === "doctor") assert.equal(parsed.healthy, true);
      else {
        assert.equal(
          parsed.status,
          args.includes("--dry-run") ? "planned" : "ready",
        );
        if (args.includes("--dry-run")) {
          assert(parsed.plannedActions.some((a) => a.target === configPath));
          assert(
            parsed.plannedActions.some((a) =>
              a.target.startsWith(join(profile, ".agents", "skills") + sep),
            ),
          );
          assert(
            parsed.plannedActions.every((a) =>
              a.target.startsWith(profile + sep),
            ),
          );
        }
      }
      await writeFile(
        join(
          lab,
          `${args[0]}${args.includes("--dry-run") ? "-plan" : ""}.json`,
        ),
        result.stdout,
      );
    }
    assert.equal(await readFile(`${configPath}.rea.backup`, "utf8"), original);
    const configured = await readFile(configPath, "utf8");
    assert.deepEqual(JSON.parse(configured).mcpServers.other, {
      command: "unrelated-server",
    });
    const repeated = await commands.exec(
      process.execPath,
      [
        join(runtimeRoot, "scripts/rea.mjs"),
        "setup",
        "--client",
        "gemini_cli",
        "--yes",
        "--json",
      ],
      { env: environment, cwd: workspace, timeout: 60_000, stdin: "pipe" },
    );
    assert.deepEqual(JSON.parse(repeated.stdout).appliedActions, []);
    assert.equal(await readFile(configPath, "utf8"), configured);
    assert.equal(await readFile(`${configPath}.rea.backup`, "utf8"), original);
    assert(
      (await readFile(skillPath, "utf8")).includes(
        "name: reverse-engineer-anything",
      ),
    );
    const target = join(lab, "fixture α测试");
    await mkdir(target);
    await writeFile(join(target, "app.js"), CLIENT_JAVASCRIPT_FIXTURE_SOURCE);
    const schemaValidator = new Ajv2020({
      strict: false,
      validateFormats: false,
    });
    const decodeGeminiResult = (text) => {
      if (
        text.startsWith("<untrusted_context>\n") &&
        text.endsWith("\n</untrusted_context>")
      )
        return decodeGeminiResult(
          text.slice(
            "<untrusted_context>\n".length,
            -"\n</untrusted_context>".length,
          ),
        );
      return JSON.parse(text);
    };
    fixture = await createGeminiModelFixture({
      directory: lab,
      onRequest: async ({ body, tools }) => {
        const analysis = tools.find((t) =>
          t.name.endsWith("analyze_javascript_application"),
        );
        assert(analysis, "Gemini must expose the REA analysis tool");
        const prefix = analysis.name.slice(
          0,
          -"analyze_javascript_application".length,
        );
        const expected = TOOL_CONTRACTS.map((t) => prefix + t.name).sort();
        const reaTools = tools.filter((t) => expected.includes(t.name));
        catalogSize = reaTools.length;
        assert.deepEqual(
          reaTools.map((t) => t.name).sort(),
          expected,
          "Gemini must forward the complete REA tool catalog",
        );
        if (schemasChecked === 0) {
          for (const tool of reaTools) {
            assert(
              tool.parametersJsonSchema,
              `${tool.name}: missing advertised JSON Schema`,
            );
            assert(
              schemaValidator.validateSchema(tool.parametersJsonSchema),
              `${tool.name}: invalid advertised JSON Schema: ${JSON.stringify(schemaValidator.errors)}`,
            );
            const unsupportedLiteral = geminiUnsupportedLiteral(
              tool.parametersJsonSchema,
            )?.path;
            assert.equal(
              unsupportedLiteral,
              undefined,
              `${tool.name}: Gemini SDK declaration retains a boolean or empty-string const/enum at ${unsupportedLiteral}`,
            );
            const name = tool.name.slice(prefix.length);
            const contract = toolContract(name);
            const validate = schemaValidator.compile(tool.parametersJsonSchema);
            for (const example of contract.examples) {
              assert(
                validate(example.input),
                `${tool.name}: Gemini SDK declaration rejects canonical example ${example.title}: ${JSON.stringify(schemaValidator.errors)}`,
              );
              examplesChecked++;
            }
            schemasChecked++;
          }
        }
        const responses = body.contents
          .flatMap((c) => c.parts ?? [])
          .filter((p) => p.functionResponse)
          .map((p) => p.functionResponse);
        skillLoaded ||= responses.some(
          (r) =>
            r.name === "activate_skill" &&
            r.response?.output?.includes(
              `<activated_skill name="reverse-engineer-anything">`,
            ) &&
            r.response.output.includes(
              join(profile, ".agents", "skills", "reverse-engineer-anything"),
            ),
        );
        const observed = findClientResult(
          responses,
          isClientJavaScriptEvidence,
          decodeGeminiResult,
        );
        if (observed) {
          const { evidence } = await assertClientJavaScriptFixtureEvidence(
            observed,
            target,
          );
          const bytes = JSON.stringify(evidence);
          artifactDigest = createHash("sha256").update(bytes).digest("hex");
          await writeFile(join(lab, "gemini-evidence.json"), bytes);
          evidenceSeen = true;
        }
        if (mode === "chat" || evidenceSeen) {
          finalSeen = true;
          return [{ text: "REA_CLIENT_COMPATIBILITY_OK" }];
        }
        if (!skillRequested) {
          const skill = tools.find((t) => t.name === "activate_skill");
          assert(skill, "Gemini must expose its native skill activation tool");
          skillRequested = true;
          return [
            {
              functionCall: {
                name: skill.name,
                args: { name: "reverse-engineer-anything" },
              },
            },
          ];
        }
        assert(
          skillLoaded,
          "Gemini must load the installed personal REA skill",
        );
        return [
          {
            functionCall: {
              name: analysis.name,
              args: { input_path: target, format: "directory" },
            },
          },
        ];
      },
    });
    const response = await saveVerifierCommandOutput(
      () =>
        commands.exec(
          ...launch([
            "--model",
            "gemini-2.5-flash",
            "--approval-mode",
            mode === "chat" ? "default" : "yolo",
            "--allowed-mcp-server-names",
            "rea",
            "--output-format",
            "stream-json",
            "-p",
            mode === "chat"
              ? "Say hello briefly."
              : `Use REA to analyze the JavaScript directory ${target}. Report the result.`,
          ]),
          {
            env: {
              ...environment,
              GEMINI_API_KEY: "local-fixture-key",
              GOOGLE_GEMINI_BASE_URL: fixture.baseUrl,
            },
            cwd: workspace,
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
            stdin: "pipe",
          },
        ),
      {
        stdout: join(lab, `${mode}.stdout`),
        stderr: join(lab, `${mode}.stderr`),
      },
    );
    const events = response.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(
      events.findLast((e) => e.type === "result")?.status,
      "success",
    );
    assert.equal(fixture.failure, undefined);
    assert(
      finalSeen && response.stdout.includes("REA_CLIENT_COMPATIBILITY_OK"),
    );
    if (mode === "call") assert(evidenceSeen && skillLoaded);
  }, [
    () => commands.close(),
    async () => {
      await fixture?.close();
    },
  ]);
  passed = true;
}, [
  async () => {
    const lineage = await completeVerifierRun(verifier);
    const receipt = {
      client: "Gemini CLI",
      clientVersion,
      mode,
      schemaProfile,
      schemasChecked,
      examplesChecked,
      passed,
      artifacts: lab,
      runtimeRoot,
      host: {
        platform: process.platform,
        architecture: process.arch,
        node: process.versions.node,
      },
      modelFixture:
        "loopback native Gemini API adapter; token counts synthetic; no live Google API claim",
      skillDiscovery:
        "native GEMINI_CLI_HOME personal shared directory; isolated Git project",
      catalogSize,
      evidenceSeen,
      skillLoaded,
      artifactDigest,
      finalSeen,
      requests: fixture?.requests,
      probes: fixture?.probes,
      fixtureFailure: fixture?.failure,
      verifier: lineage,
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
