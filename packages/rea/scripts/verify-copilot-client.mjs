import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  TOOL_CONTRACTS,
  toolContract,
} from "../dist/contracts/toolContracts.js";
import { advertisedInputJsonSchema } from "../dist/contracts/toolSchemaMetadata.js";
import { presentAdvertisedInputSchema } from "../dist/contracts/compactInputSchema.js";
import { compactPresentationForMcpInputSchemaProfile } from "../dist/config/mcpInputSchemaProfile.js";
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
import { createOpenAiModelFixture } from "./verify/clients/model-fixture.mjs";

assert(
  process.platform !== "win32",
  "Native Copilot CLI verifier requires POSIX; Windows is unverified",
);
const repo = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoot = process.env.REA_VERIFY_RUNTIME_ROOT ?? repo;
const command = process.env.REA_VERIFY_COPILOT_COMMAND ?? "copilot";
const mode = process.argv[2] ?? "call";
const model = process.env.REA_VERIFY_COPILOT_MODEL ?? "gpt-5.4";
const wireModel = process.env.REA_VERIFY_COPILOT_WIRE_MODEL ?? model;
const inputSchemaProfile =
  process.env.REA_VERIFY_COPILOT_SCHEMA_PROFILE ?? "full";
assert(
  ["full", "compact"].includes(inputSchemaProfile),
  "REA_VERIFY_COPILOT_SCHEMA_PROFILE must be full or compact",
);
assert(
  ["chat", "call"].includes(mode),
  "Usage: verify-copilot-client.mjs [chat|call]",
);
const verifier = createVerifierRun();
const lab = await mkdtemp(join(tmpdir(), "rea-copilot-client-"));
const account = join(lab, "account");
const profile = join(lab, "selected profile");
const workspace = join(lab, "workspace");
const configPath = join(profile, "mcp-config.json");
const skillDirectory = join(
  account,
  ".agents",
  "skills",
  "reverse-engineer-anything",
);
let clientVersion = null;
let fixture;
let passed = false;
let skillRequested = false;
let skillLoaded = false;
let expectedSkillBody;
let evidenceSeen = false;
let finalSeen = false;
let catalogSize = null;
let schemasChecked = 0;
let spillReadRequested = false;
let artifactDigest;
const wireModels = [];
const commands = await createVerifierCommands();
await withVerifierCleanup(async () => {
  await withVerifierCleanup(async () => {
    await Promise.all([mkdir(account), mkdir(profile), mkdir(workspace)]);
    await commands.exec("git", ["init", "--quiet", workspace], {
      timeout: 30_000,
      stdin: "pipe",
    });
    // Do not inherit the caller's home or credentials into the isolated native profile.
    const environment = {
      PATH: process.env.PATH,
      NODE_OPTIONS: process.env.NODE_OPTIONS,
      HOME: account,
      USERPROFILE: account,
      COPILOT_HOME: profile,
      COPILOT_OFFLINE: "true",
      COPILOT_PROVIDER_TYPE: "openai",
      COPILOT_PROVIDER_WIRE_API: "completions",
      COPILOT_PROVIDER_API_KEY: "local-fixture-key",
      COPILOT_PROVIDER_API_KEY_COMMAND: "",
      COPILOT_PROVIDER_BEARER_TOKEN: "",
      COPILOT_PROVIDER_HEADERS: "",
      COPILOT_PROVIDER_MODEL_ID: model,
      COPILOT_PROVIDER_WIRE_MODEL: wireModel,
      COPILOT_PROVIDER_MAX_PROMPT_TOKENS: "1000000",
      COPILOT_PROVIDER_MAX_OUTPUT_TOKENS: "4096",
      REA_PROCESS_RUN_ID: verifier.run_id,
    };
    try {
      clientVersion = (
        await commands.exec(command, ["--version"], {
          env: environment,
          timeout: 30_000,
          stdin: "pipe",
        })
      ).stdout.trim();
    } catch (cause) {
      throw new Error(
        `Copilot CLI preflight failed for ${command}; install Copilot CLI or set REA_VERIFY_COPILOT_COMMAND. ${String(cause)}`,
        { cause },
      );
    }
    const target = join(lab, "fixture α测试");
    await mkdir(target);
    await writeFile(join(target, "app.js"), CLIENT_JAVASCRIPT_FIXTURE_SOURCE);
    const schemaValidator = new Ajv2020({
      strict: false,
      validateFormats: false,
    });
    const containsText = (value, text) => {
      if (typeof value === "string") return value.includes(text);
      if (value && typeof value === "object")
        return Object.values(value).some((nested) =>
          containsText(nested, text),
        );
      return false;
    };
    fixture = await createOpenAiModelFixture({
      directory: lab,
      prefix: "copilot",
      onRequest: async ({ body, tools, requestIndex }) => {
        assert.equal(
          body.model,
          wireModel,
          "Copilot must send the selected wire model",
        );
        wireModels.push(body.model);
        // Auxiliary requests without tools cannot execute the analyst's workflow.
        if (tools.length === 0)
          return { role: "assistant", content: "REA fixture title" };
        const analysis = tools.find((t) =>
          t.name.endsWith("analyze_javascript_application"),
        );
        assert(analysis, "Copilot CLI must expose the REA analysis tool");
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
          "Copilot CLI must forward the complete REA catalog",
        );
        if (schemasChecked === 0) {
          for (const tool of reaTools) {
            assert(
              tool.parameters,
              `${tool.name}: missing advertised input schema`,
            );
            assert(
              schemaValidator.validateSchema(tool.parameters),
              `${tool.name}: invalid input schema: ${JSON.stringify(schemaValidator.errors)}`,
            );
            assert.deepEqual(
              tool.parameters,
              presentAdvertisedInputSchema(
                advertisedInputJsonSchema(
                  toolContract(tool.name.slice(prefix.length)),
                ),
                compactPresentationForMcpInputSchemaProfile(inputSchemaProfile),
              ),
              `${tool.name}: Copilot must forward the selected ${inputSchemaProfile} input schema`,
            );
            schemasChecked++;
          }
        }
        const replies = body.messages.filter((m) => m.role === "tool");
        // Native skill activation injects its context as a user message after the acknowledgement.
        skillLoaded ||=
          skillRequested &&
          expectedSkillBody !== undefined &&
          containsText(body.messages, expectedSkillBody) &&
          containsText(body.messages, skillDirectory);
        const observed = findClientResult(replies, isClientJavaScriptEvidence);
        if (observed) {
          const { evidence } = await assertClientJavaScriptFixtureEvidence(
            observed,
            target,
          );
          const bytes = JSON.stringify(evidence);
          artifactDigest = createHash("sha256").update(bytes).digest("hex");
          await writeFile(join(lab, "copilot-evidence.json"), bytes);
          evidenceSeen = true;
        }
        if (mode === "chat" || evidenceSeen) {
          finalSeen = true;
          return { role: "assistant", content: "REA_CLIENT_COMPATIBILITY_OK" };
        }
        assert(
          requestIndex <= 8,
          "Local model workflow exceeded its turn budget",
        );
        const call = (name, args) => ({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call_rea_fixture_${requestIndex}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        });
        if (!skillRequested) {
          const skill = tools.find((t) => t.name === "skill");
          assert(skill, "Copilot CLI must expose its native skill tool");
          skillRequested = true;
          return call(skill.name, { skill: "reverse-engineer-anything" });
        }
        assert(
          skillLoaded,
          "Copilot CLI must load the installed personal REA skill",
        );
        const spilled = replies.find(
          (message) =>
            typeof message.content === "string" &&
            message.content.startsWith("Output too large to read at once "),
        );
        if (spilled) {
          assert(
            !spillReadRequested,
            "Copilot did not return complete Evidence after its native spill read",
          );
          const path = /\. Saved to: ([^\n]+)\n/u.exec(spilled.content)?.[1];
          assert(
            path &&
              isAbsolute(path) &&
              /^\d+-copilot-tool-output-[a-f\d]+\.txt$/u.test(basename(path)),
            "Unexpected native spill path",
          );
          const view = tools.find((tool) => tool.name === "view");
          assert(view, "Copilot must expose its native file reader");
          spillReadRequested = true;
          return call(view.name, { path, forceReadLargeFiles: true });
        }
        return call(analysis.name, { input_path: target, format: "directory" });
      },
    });
    const original = JSON.stringify(
      {
        mcpServers: {
          other: {
            type: "local",
            command: "unrelated-server",
            args: [],
            enabled: false,
          },
        },
      },
      null,
      2,
    );
    await writeFile(configPath, original);
    for (const args of [
      ["setup", "--client", "copilot_cli", "--dry-run"],
      ["setup", "--client", "copilot_cli", "--yes"],
      ["doctor", "--client", "copilot_cli", "--skill"],
    ]) {
      const result = await commands.exec(
        process.execPath,
        [join(runtimeRoot, "scripts/rea.mjs"), ...args, "--json"],
        { env: environment, cwd: workspace, timeout: 60_000, stdin: "pipe" },
      );
      await writeFile(
        join(
          lab,
          `${args[0]}${args.includes("--dry-run") ? "-plan" : ""}.json`,
        ),
        result.stdout,
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
            parsed.plannedActions.some((a) => a.target === skillDirectory),
          );
          assert(
            parsed.plannedActions.every(
              (a) =>
                a.target === configPath ||
                a.target === skillDirectory ||
                a.target.startsWith(skillDirectory + "/"),
            ),
          );
        }
      }
    }
    assert.equal(await readFile(`${configPath}.rea.backup`, "utf8"), original);
    const configured = await readFile(configPath, "utf8");
    assert(configured.includes("unrelated-server"));

    const repeated = await commands.exec(
      process.execPath,
      [
        join(runtimeRoot, "scripts/rea.mjs"),
        "setup",
        "--client",
        "copilot_cli",
        "--yes",
        "--json",
      ],
      { env: environment, cwd: workspace, timeout: 60_000, stdin: "pipe" },
    );
    assert.deepEqual(JSON.parse(repeated.stdout).appliedActions, []);
    assert.equal(await readFile(configPath, "utf8"), configured);
    assert.equal(await readFile(`${configPath}.rea.backup`, "utf8"), original);
    // Bind both choices explicitly: the server's default can change independently
    // of the profile this verifier promises to exercise and records in its receipt.
    const customized = JSON.parse(configured);
    assert(customized.mcpServers.rea);
    customized.mcpServers.rea.env = {
      ...customized.mcpServers.rea.env,
      REA_MCP_INPUT_SCHEMA_PROFILE: inputSchemaProfile,
    };
    await writeFile(configPath, JSON.stringify(customized, null, 2));
    const installedSkill = await readFile(
      join(skillDirectory, "SKILL.md"),
      "utf8",
    );
    assert(installedSkill.includes("name: reverse-engineer-anything"));
    const skillLines = installedSkill.split("\n");
    const headerEnd = skillLines.indexOf("---", 1);
    assert(
      skillLines[0] === "---" && headerEnd > 0,
      "Installed skill must have its authored frontmatter",
    );
    expectedSkillBody = skillLines
      .slice(headerEnd + 1)
      .join("\n")
      .trim();
    assert(expectedSkillBody.length > 0);
    for (const [name, args] of [
      ["mcp-list", ["mcp", "list"]],
      ["skill-add", ["skill", "add", skillDirectory]],
      ["skill-list", ["skill", "list"]],
    ]) {
      const result = await commands.exec(command, args, {
        env: environment,
        cwd: workspace,
        timeout: 30_000,
        stdin: "pipe",
      });
      await writeFile(join(lab, `${name}.stdout`), result.stdout);
      await writeFile(join(lab, `${name}.stderr`), result.stderr);
      if (name === "mcp-list") assert(result.stdout.includes("rea"));
      if (name === "skill-list")
        assert(result.stdout.includes("reverse-engineer-anything"));
    }
    const response = await saveVerifierCommandOutput(
      () =>
        commands.exec(
          command,
          [
            "--disable-builtin-mcps",
            "--disable-mcp-server",
            "other",
            "--no-ask-user",
            "--output-format",
            "json",
            "--model",
            model,
            "--allow-tool=skill",
            "--allow-tool=read",
            "--allow-tool=rea(analyze_javascript_application)",
            "--add-dir",
            target,
            "--prompt",
            mode === "chat"
              ? "Say hello briefly."
              : `Use the REA skill and tools to analyze the JavaScript directory ${target}. Report the result.`,
          ],
          {
            env: { ...environment, COPILOT_PROVIDER_BASE_URL: fixture.baseUrl },
            cwd: workspace,
            timeout: 120_000,
            stdin: "closed-pipe",
            maxBuffer: 10 * 1024 * 1024,
          },
        ),
      {
        stdout: join(lab, `${mode}.stdout`),
        stderr: join(lab, `${mode}.stderr`),
      },
    );
    assert.equal(fixture.failure, undefined);
    const events = response.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert(
      !events.some((event) => event.type === "session.error"),
      "Copilot emitted a session error",
    );
    assert(finalSeen);
    assert(
      events.some(
        (event) =>
          event.type === "assistant.message" &&
          event.data.content === "REA_CLIENT_COMPATIBILITY_OK",
      ),
      "Copilot must finish with the expected native assistant message",
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
      client: "Copilot CLI",
      clientVersion,
      mode,
      model,
      wireModel,
      inputSchemaProfile,
      passed,
      artifacts: lab,
      runtimeRoot,
      host: {
        platform: process.platform,
        architecture: process.arch,
        node: process.versions.node,
      },
      modelFixture:
        "loopback OpenAI completions/SSE, synthetic usage, requested one-million-token BYOK prompt capacity; effective capacity unknown; no live provider claim",
      skillDiscovery:
        "native COPILOT_HOME MCP configuration and caller-added isolated skill directory; default OS-home discovery unverified",
      capacityBoundary:
        inputSchemaProfile === "compact"
          ? "Explicit compact profile: complete inventory and canonical server validation; advertised schemas may be reduced. This does not fix the full-profile gpt-4.1 context boundary."
          : "Full advertised input schemas, checked at the client request boundary. Client model ID and wire model are recorded separately; effective token capacity and live provider compatibility remain unknown.",
      catalogSize,
      schemasChecked,
      spillReadRequested,
      evidenceSeen,
      skillLoaded,
      artifactDigest,
      finalSeen,
      wireModels,
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
