import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { createCatalogIdentity } from "../dist/catalogIdentity.js";
import {
  compactPresentationForMcpInputSchemaProfile,
  parseMcpInputSchemaProfile,
} from "../dist/config/mcpInputSchemaProfile.js";
import { parseMcpOutputSchemaProfile } from "../dist/config/mcpOutputSchemaProfile.js";
import {
  TOOL_CONTRACTS,
  toolContract,
} from "../dist/contracts/toolContracts.js";
import { createVerifierCommands } from "./lib/verify-commands.mjs";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";
import { saveVerifierCommandOutput } from "./lib/verifier-command-output.mjs";
import {
  CLIENT_JAVASCRIPT_FIXTURE_SOURCE,
  assertClientJavaScriptFixtureEvidence,
} from "./verify/clients/javascript-fixture.mjs";
import {
  expandMcpSessionStatus,
  sortVerifierNames,
} from "./lib/mcp-verifier-results.mjs";
import {
  findClientResult,
  isClientJavaScriptEvidence,
} from "./verify/clients/result-discovery.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";
import { createAnthropicModelFixture } from "./verify/clients/anthropic-model-fixture.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoot = process.env.REA_VERIFY_RUNTIME_ROOT ?? repo;
const command = process.env.REA_VERIFY_CLAUDE_COMMAND ?? "claude";
const mode = process.argv[2] ?? "call";
assert(
  ["chat", "call"].includes(mode),
  "Usage: verify-claude-client.mjs [chat|call]",
);
const verifier = createVerifierRun();
const lab = await mkdtemp(join(tmpdir(), "rea-claude-client-"));
const profile = join(lab, "selected profile");
const workspace = join(lab, "workspace");
const configPath = join(profile, ".claude.json");
const skillDirectory = join(profile, "skills", "reverse-engineer-anything");
let clientVersion = null;
let fixture;
let passed = false;
let skillRequested = false;
let sessionRequested = false;
let sessionStatusSeen = false;
let skillLoaded = false;
let expectedSkillBody;
let evidenceSeen = false;
let finalSeen = false;
let catalogSize = null;
let schemasChecked = 0;
let pendingServerWaits = 0;
let artifactDigest;
const commands = await createVerifierCommands();
await withVerifierCleanup(async () => {
  await withVerifierCleanup(async () => {
    await Promise.all([mkdir(profile), mkdir(workspace)]);
    await commands.exec("git", ["init", "--quiet", workspace], {
      timeout: 30_000,
      stdin: "pipe",
    });
    const environment = {
      ...process.env,
      CLAUDE_CONFIG_DIR: profile,
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
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
      // npm installs put only a claude.cmd shim on PATH, which Node does not spawn without a shell.
      const windowsHint =
        process.platform === "win32"
          ? " On Windows, select claude.exe; npm installs provide it under node_modules/@anthropic-ai/claude-code/bin."
          : "";
      throw new Error(
        `Claude Code preflight failed for ${command}; install Claude Code or set REA_VERIFY_CLAUDE_COMMAND.${windowsHint} ${String(cause)}`,
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
    const decodeClaudeResult = (text) =>
      JSON.parse(
        // Native Claude appends this resource hint. Original bodies remain in request artifacts.
        text.replace(
          /\n\n<system-reminder>\n<total_tokens>\d+ tokens left<\/total_tokens>\n<\/system-reminder>$/u,
          "",
        ),
      );
    fixture = await createAnthropicModelFixture({
      directory: lab,
      onRequest: async ({ body, tools, requestIndex }) => {
        if (tools.length === 0)
          return [{ type: "text", text: "REA fixture title" }];
        assert(
          requestIndex <= 8,
          "Local model workflow exceeded its turn budget",
        );
        const call = (name, input) => [
          { type: "tool_use", id: `toolu_rea_${requestIndex}`, name, input },
        ];
        const analysis = tools.find((t) =>
          t.name.endsWith("analyze_javascript_application"),
        );
        if (!analysis) {
          // Native automatic discovery can begin the conversation while MCP is still connecting.
          const wait = tools.find((t) => t.name === "WaitForMcpServers");
          assert(
            wait,
            "Claude must expose REA tools or its native pending-server wait",
          );
          pendingServerWaits++;
          return call(wait.name, { servers: ["rea"] });
        }
        const prefix = analysis.name.slice(
          0,
          -"analyze_javascript_application".length,
        );
        const expected = sortVerifierNames(
          TOOL_CONTRACTS.map((t) => prefix + t.name),
        );
        const reaTools = tools.filter((t) => t.name.startsWith(prefix));
        catalogSize = reaTools.length;
        assert.deepEqual(
          sortVerifierNames(reaTools.map((t) => t.name)),
          expected,
          "Claude must forward the complete REA catalog after connection",
        );
        if (schemasChecked === 0) {
          for (const tool of reaTools) {
            assert(
              tool.input_schema,
              `${tool.name}: missing advertised input schema`,
            );
            assert(
              schemaValidator.validateSchema(tool.input_schema),
              `${tool.name}: invalid input schema: ${JSON.stringify(schemaValidator.errors)}`,
            );
            schemasChecked++;
          }
        }
        if (mode === "call" && !sessionStatusSeen) {
          const observedStatus = findClientResult(
            body.messages,
            (value) =>
              Boolean(value.result?.server_identity) &&
              Array.isArray(value.result?.tool_availability?.groups),
            decodeClaudeResult,
          );
          if (observedStatus) {
            const parsedStatus =
              toolContract("binary_session").outputSchema.parse(observedStatus);
            const status = {
              ...parsedStatus,
              result: expandMcpSessionStatus(parsedStatus.result),
            };
            const inputProfile = parseMcpInputSchemaProfile(
              environment.REA_MCP_INPUT_SCHEMA_PROFILE,
            );
            const outputProfile = parseMcpOutputSchemaProfile(
              environment.REA_MCP_OUTPUT_SCHEMA_PROFILE,
            );
            assert.ok(inputProfile.ok);
            assert.ok(outputProfile.ok);
            assert.deepEqual(
              status.result.server_identity.catalog,
              createCatalogIdentity({
                compactPresentation:
                  compactPresentationForMcpInputSchemaProfile(
                    inputProfile.value,
                  ),
                outputSchemaProfile: outputProfile.value ?? "full",
              }),
              "binary_session must return the selected input/output profile's catalog identity",
            );
            assert.equal(
              Object.hasOwn(status.result.server_identity.catalog, "tools"),
              false,
              "binary_session must not inline the duplicated canonical tool catalog",
            );
            assert.deepEqual(
              sortVerifierNames(
                status.result.tool_availability.map((entry) => entry.name),
              ),
              sortVerifierNames(
                TOOL_CONTRACTS.map((contract) => contract.name),
              ),
              "binary_session must retain complete canonical tool availability",
            );
            sessionStatusSeen = true;
          } else {
            assert(
              !sessionRequested,
              "Claude must return the inline binary_session result before continuing",
            );
            const session = tools.find(
              (tool) => tool.name === `${prefix}binary_session`,
            );
            assert(session, "Claude must expose the REA binary_session tool");
            sessionRequested = true;
            return call(session.name, {});
          }
        }
        skillLoaded ||=
          expectedSkillBody !== undefined &&
          containsText(body.messages, expectedSkillBody) &&
          containsText(body.messages, skillDirectory);
        const observed = findClientResult(
          body.messages,
          isClientJavaScriptEvidence,
          decodeClaudeResult,
        );
        if (observed) {
          const { evidence } = await assertClientJavaScriptFixtureEvidence(
            observed,
            target,
          );
          const bytes = JSON.stringify(evidence);
          artifactDigest = createHash("sha256").update(bytes).digest("hex");
          await writeFile(join(lab, "claude-evidence.json"), bytes);
          evidenceSeen = true;
        }
        if (mode === "chat" || (sessionStatusSeen && evidenceSeen)) {
          finalSeen = true;
          return [{ type: "text", text: "REA_CLIENT_COMPATIBILITY_OK" }];
        }
        if (!skillRequested) {
          const skill = tools.find((t) => t.name === "Skill");
          assert(skill, "Claude must expose its native Skill tool");
          skillRequested = true;
          return call(skill.name, { skill: "reverse-engineer-anything" });
        }
        assert(
          skillLoaded,
          "Claude must load the complete installed personal REA skill",
        );
        return call(analysis.name, { input_path: target, format: "directory" });
      },
    });
    const original = JSON.stringify(
      { theme: "light", mcpServers: {} },
      null,
      2,
    );
    await writeFile(configPath, original);
    for (const args of [
      ["setup", "--client", "claude_code", "--dry-run"],
      ["setup", "--client", "claude_code", "--yes"],
      ["doctor", "--client", "claude_code", "--skill"],
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
                a.target === configPath || a.target.startsWith(skillDirectory),
            ),
          );
        }
      }
    }
    assert.equal(await readFile(`${configPath}.rea.backup`, "utf8"), original);
    const configured = await readFile(configPath, "utf8");
    assert.equal(JSON.parse(configured).theme, "light");
    const repeated = await commands.exec(
      process.execPath,
      [
        join(runtimeRoot, "scripts/rea.mjs"),
        "setup",
        "--client",
        "claude_code",
        "--yes",
        "--json",
      ],
      { env: environment, cwd: workspace, timeout: 60_000, stdin: "pipe" },
    );
    assert.deepEqual(JSON.parse(repeated.stdout).appliedActions, []);
    assert.equal(await readFile(configPath, "utf8"), configured);
    assert.equal(await readFile(`${configPath}.rea.backup`, "utf8"), original);
    const installedSkill = await readFile(
      join(skillDirectory, "SKILL.md"),
      "utf8",
    );
    assert(installedSkill.includes("name: reverse-engineer-anything"));
    const lines = installedSkill.split("\n");
    const headerEnd = lines.indexOf("---", 1);
    assert(
      lines[0] === "---" && headerEnd > 0,
      "Installed skill must have its authored frontmatter",
    );
    expectedSkillBody = lines
      .slice(headerEnd + 1)
      .join("\n")
      .trim();
    assert(expectedSkillBody.length > 0);
    const response = await saveVerifierCommandOutput(
      () =>
        commands.exec(
          command,
          [
            "--setting-sources",
            "user",
            "--print",
            "--output-format",
            "json",
            "--no-session-persistence",
            "--model",
            "claude-sonnet-4-6",
            "--tools",
            "default",
            "--permission-mode",
            "dontAsk",
            "--settings",
            JSON.stringify({
              permissions: {
                allow: [
                  "Skill",
                  "WaitForMcpServers",
                  "mcp__rea__analyze_javascript_application",
                  ...(mode === "call" ? ["mcp__rea__binary_session"] : []),
                ],
              },
            }),
            mode === "chat"
              ? "Say hello briefly."
              : `Use the REA skill and tools to analyze the JavaScript directory ${target}. Report the result.`,
          ],
          {
            env: {
              ...environment,
              ANTHROPIC_API_KEY: "local-fixture-key",
              ANTHROPIC_AUTH_TOKEN: "",
              ANTHROPIC_BASE_URL: fixture.baseUrl,
            },
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
    const parsed = JSON.parse(response.stdout);
    assert.equal(parsed.is_error, false);
    assert.equal(parsed.subtype, "success");
    assert.equal(parsed.result, "REA_CLIENT_COMPATIBILITY_OK");
    assert.deepEqual(parsed.permission_denials, []);
    assert(finalSeen);
    if (mode === "call")
      assert(evidenceSeen && skillLoaded && sessionStatusSeen);
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
      client: "Claude Code",
      clientVersion,
      mode,
      passed,
      artifacts: lab,
      runtimeRoot,
      host: {
        platform: process.platform,
        architecture: process.arch,
        node: process.versions.node,
      },
      modelFixture:
        "loopback Anthropic Messages/SSE; synthetic usage and native resource hints; no live API claim",
      discovery:
        "native CLAUDE_CONFIG_DIR user configuration and skills; separate Git root, user settings only, default built-in tools",
      bareMode:
        "not used; native bare print mode did not load the personal skill",
      catalogSize,
      schemasChecked,
      pendingServerWaits,
      evidenceSeen,
      sessionStatusSeen,
      skillLoaded,
      artifactDigest,
      finalSeen,
      requests: fixture?.requests,
      probes: fixture?.probes,
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
