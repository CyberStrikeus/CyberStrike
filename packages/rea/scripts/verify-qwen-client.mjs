import assert from "node:assert/strict";
import { createOpenAiModelFixture } from "./verify/clients/model-fixture.mjs";
import {
  mkdir,
  writeFile,
  readFile,
  mkdtemp,
  realpath,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
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
import { TOOL_CONTRACTS } from "../dist/contracts/toolContracts.js";

const repo = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoot = process.env.REA_VERIFY_RUNTIME_ROOT ?? repo;
const lab = await mkdtemp(join(tmpdir(), "rea-qwen-client-"));
const client = "qwen";
const mode = process.argv[2] ?? "call";
assert(
  ["chat", "call"].includes(mode),
  "Usage: node scripts/verify-qwen-client.mjs [chat|call]",
);
const command = process.env.REA_VERIFY_QWEN_COMMAND ?? "qwen";
// npm exposes only qwen.cmd on Windows. Resolve a selected JavaScript entry
// before the verifier switches to its disposable workspace.
const entryPoint = /\.(c|m)?js$/iu.test(command) ? resolve(command) : undefined;
const reducedPath = process.env.REA_VERIFY_QWEN_REDUCED_PATH === "1";
assert(
  !reducedPath || (process.platform !== "win32" && entryPoint !== undefined),
  "REA_VERIFY_QWEN_REDUCED_PATH=1 requires POSIX and a JavaScript REA_VERIFY_QWEN_COMMAND entry point",
);
const launch = (args) =>
  entryPoint === undefined
    ? [command, args]
    : [process.execPath, [entryPoint, ...args]];
const verifier = createVerifierRun();
const profile = join(lab, "selected profile");
const account = join(lab, "account");
const runtime = join(profile, "runtime");
const workspace = join(lab, "workspace");
const sharedSkills = join(account, ".agents", "skills");
let clientVersion = null;
let fixture;
let passed = false;
let evidenceSeen = false;
let skillSeen = false;
let finalSeen = false;
let skillRequested = false;
let searchCallId;
let analysisCallId;
let artifactReadByAgent = false;
let artifactPath;
let selectedSkillLoaded = false;
let artifactDigest;
let catalogSize = null;
let registrationCommand = null;
let clientPath = null;
const commands = await createVerifierCommands();
await withVerifierCleanup(async () => {
  await withVerifierCleanup(async () => {
    await Promise.all([
      mkdir(profile, { recursive: true }),
      mkdir(account),
      mkdir(workspace),
    ]);
    const baseEnvironment = {
      PATH: process.env.PATH ?? "",
      HOME: account,
      USERPROFILE: account,
      QWEN_HOME: profile,
      QWEN_RUNTIME_DIR: runtime,
      REA_PROCESS_RUN_ID: verifier.run_id,
    };
    try {
      clientVersion = (
        await commands.exec(...launch(["--version"]), {
          env: baseEnvironment,
          timeout: 30_000,
          stdin: "pipe",
        })
      ).stdout.trim();
    } catch (cause) {
      const windowsHint =
        process.platform === "win32"
          ? " On Windows, select node_modules/@qwen-code/qwen-code/cli-entry.js."
          : "";
      throw new Error(
        `Qwen client preflight failed for ${command}; install Qwen Code or set REA_VERIFY_QWEN_COMMAND.${windowsHint} ${String(cause)}`,
        { cause },
      );
    }
    const original = JSON.stringify(
      {
        security: {
          auth: { selectedType: "openai" },
          folderTrust: { enabled: false },
        },
        telemetry: { enabled: false },
        model: { name: "rea-client-fixture" },
        mcpServers: { other: { command: "unrelated-server", disabled: true } },
      },
      null,
      2,
    );
    await writeFile(join(profile, "settings.json"), original);
    for (const step of [
      ["setup", "--client", "qwen_code", "--dry-run"],
      ["setup", "--client", "qwen_code", "--yes"],
      ["doctor", "--client", "qwen_code", "--skill"],
    ]) {
      const response = await commands.exec(
        process.execPath,
        [join(runtimeRoot, "scripts/rea.mjs"), ...step, "--json"],
        { env: baseEnvironment, cwd: repo, timeout: 60_000, stdin: "pipe" },
      );
      const result = JSON.parse(response.stdout);
      if (step.includes("--dry-run"))
        assert(
          result.plannedActions.every(
            (a) =>
              a.target.startsWith(profile + sep) ||
              a.target.startsWith(sharedSkills + sep),
          ),
        );
      await writeFile(
        join(
          lab,
          `${step[0]}${step.includes("--dry-run") ? "-plan" : ""}.json`,
        ),
        response.stdout,
      );
    }
    assert.equal(
      await readFile(join(profile, "settings.json.rea.backup"), "utf8"),
      original,
    );
    const configured = JSON.parse(
      await readFile(join(profile, "settings.json"), "utf8"),
    );
    registrationCommand = [
      configured.mcpServers.rea.command,
      ...configured.mcpServers.rea.args,
    ];
    assert.deepEqual(configured.model, { name: "rea-client-fixture" });
    assert.equal(configured.skills, undefined);
    assert.deepEqual(configured.mcpServers.other, {
      command: "unrelated-server",
      disabled: true,
    });
    clientPath = baseEnvironment.PATH;
    if (reducedPath) {
      assert.equal(
        configured.mcpServers.rea.env?.PATH,
        undefined,
        "Setup must not persist its ambient PATH into the registration",
      );
      clientPath = join(lab, "client-bin");
      await mkdir(clientPath);
      // Qwen's Evidence readback uses its shell tool, which launches bare bash.
      // Keep that fixture dependency available without exposing node/npm/npx.
      const bash = await commands.exec("bash", ["-c", "command -v bash"], {
        env: baseEnvironment,
        timeout: 5_000,
      });
      await symlink(
        await realpath(bash.stdout.trim()),
        join(clientPath, "bash"),
      );
      await commands.exec(
        process.execPath,
        [
          "-e",
          "const {spawnSync}=require('node:child_process');const assert=require('node:assert/strict');for(const command of ['node','npm','npx'])assert.equal(spawnSync(command,['--version'],{timeout:1000}).error?.code,'ENOENT',`${command} unexpectedly available on reduced PATH`);",
        ],
        {
          env: { ...baseEnvironment, PATH: clientPath },
          timeout: 5_000,
        },
      );
    }
    const target = join(lab, "fixture α测试");
    await mkdir(target, { recursive: true });
    await writeFile(`${target}/app.js`, CLIENT_JAVASCRIPT_FIXTURE_SOURCE);
    fixture = await createOpenAiModelFixture({
      directory: lab,
      prefix: `${client}-${mode}`,
      onRequest: async ({ body, tools, requestIndex }) => {
        skillSeen ||= JSON.stringify(body.messages ?? []).includes(
          "reverse-engineer-anything",
        );
        const messages = (body.messages ?? []).map((message) => ({
          role: message.role,
          callId: message.tool_call_id,
          text:
            typeof message.content === "string"
              ? message.content
              : (message.content ?? [])
                  .map((part) => part.text ?? "")
                  .join("\n"),
        }));
        const messageText = messages.map((message) => message.text).join("\n");
        const toolResponseText = (callId) =>
          messages.find(
            (message) => message.role === "tool" && message.callId === callId,
          )?.text ?? "";
        selectedSkillLoaded ||= messageText.includes(
          join(sharedSkills, "reverse-engineer-anything"),
        );
        const toolText = JSON.stringify(
          (body.messages ?? []).filter((m) => m.role === "tool"),
        );
        if (
          toolText.includes("REA_CLIENT_FIXTURE") &&
          /(?:\\?"REA_CLIENT_FIXTURE\\?"\s*:\s*true)/u.test(toolText)
        ) {
          artifactReadByAgent = true;
          assert(artifactPath);
          const artifact = await readFile(artifactPath);
          artifactDigest = createHash("sha256").update(artifact).digest("hex");
          const { evidence } = await assertClientJavaScriptFixtureEvidence(
            JSON.parse(artifact.toString("utf8")),
            target,
          );
          evidenceSeen = true;
          await writeFile(
            `${lab}/${client}-${mode}-evidence.json`,
            JSON.stringify(evidence),
          );
        }
        for (const message of body.messages ?? []) {
          if (message.role !== "tool") continue;
          const candidate = findClientResult(
            message.content,
            isClientJavaScriptEvidence,
          );
          if (candidate) {
            const { evidence } = await assertClientJavaScriptFixtureEvidence(
              candidate,
              target,
            );
            evidenceSeen = true;
            await writeFile(
              `${lab}/${client}-${mode}-evidence.json`,
              JSON.stringify(evidence),
            );
          }
        }
        const selected = tools.find((t) =>
          t.name.includes("analyze_javascript_application"),
        );
        const reviewedNames = [
          ...toolResponseText(searchCallId).matchAll(
            /(?:\\?"name\\?"\s*:\s*\\?")([^"\\]*analyze_javascript_application)(?:\\?")/g,
          ),
        ]
          .map((m) => m[1])
          .sort((a, b) => b.length - a.length);
        const search = tools.find((t) => t.name === "tool_search");
        const invoke = tools.find((t) => t.name === "tool_call");
        const skill = tools.find((t) => t.name === "skill");
        const shell = tools.find((t) => t.name === "run_shell_command");
        const persisted = toolResponseText(analysisCallId).match(
          /Full output saved to: ([^\r\n]+)/u,
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
        let message;
        if (mode === "chat" || evidenceSeen) {
          message = {
            role: "assistant",
            content: "REA_CLIENT_COMPATIBILITY_OK",
          };
          finalSeen = true;
        } else if (skill && !skillRequested) {
          skillRequested = true;
          message = call(skill.name, { skill: "reverse-engineer-anything" });
        } else if (persisted && shell) {
          artifactPath = persisted[1];
          assert(
            (await realpath(artifactPath)).startsWith(
              (await realpath(runtime)) + sep,
            ),
          );
          const script = `const fs=require('node:fs');const e=JSON.parse(fs.readFileSync(${JSON.stringify(artifactPath)},'utf8'));console.log(JSON.stringify({REA_CLIENT_FIXTURE:JSON.stringify(e.normalized_result).includes('REA_CLIENT_FIXTURE'),evidence_id:e.evidence_id,graph_nodes:e.normalized_result.graph.nodes.length}));`;
          // Keep paths and JSON quotes out of shell syntax on Windows and POSIX.
          const encodedScript = Buffer.from(script).toString("base64");
          const nodeCommand =
            process.platform === "win32"
              ? "node"
              : `'${process.execPath.replaceAll("'", "'\"'\"'")}'`;
          message = call(shell.name, {
            command: `${nodeCommand} -e "eval(Buffer.from('${encodedScript}','base64').toString('utf8'))"`,
            description:
              "Read the complete saved REA Evidence and verify the fixture facts.",
          });
        } else if (selected) {
          message = call(selected.name, {
            input_path: target,
            format: "directory",
          });
          analysisCallId = message.tool_calls[0].id;
        } else if (reviewedNames.length && invoke) {
          message = call(invoke.name, {
            name: reviewedNames[0],
            arguments: { input_path: target, format: "directory" },
          });
          analysisCallId = message.tool_calls[0].id;
        } else if (search && searchCallId === undefined) {
          message = call(search.name, {
            query: "analyze_javascript_application",
          });
          searchCallId = message.tool_calls[0].id;
        } else
          throw new Error(
            `REA analysis tool not exposed; tools: ${tools.map((t) => t.name).join(", ")}`,
          );
        return message;
      },
    });
    const endpoint = fixture.baseUrl;
    const prompt =
      mode === "chat"
        ? "Say hello briefly."
        : `Use REA to analyze the JavaScript directory ${target}. Report the result.`;
    const env = {
      ...baseEnvironment,
      PATH: clientPath,
      OPENAI_API_KEY: "local-fixture-key",
      OPENAI_BASE_URL: endpoint,
    };
    const args = [
      "--auth-type",
      "openai",
      "--openai-base-url",
      endpoint,
      "--model",
      "rea-client-fixture",
      "--approval-mode",
      mode === "chat" ? "default" : "yolo",
      "--allowed-mcp-server-names",
      "rea",
      "--output-format",
      "stream-json",
      "--max-session-turns",
      "8",
      "-p",
      prompt,
    ];
    const response = await saveVerifierCommandOutput(
      () =>
        commands.exec(...launch(args), {
          env,
          cwd: workspace,
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
          stdin: "pipe",
        }),
      {
        stdout: join(lab, `${mode}.stdout`),
        stderr: join(lab, `${mode}.stderr`),
      },
    );
    const initialized = response.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((v) => v.type === "system" && v.subtype === "init");
    assert(initialized);
    const observed = initialized.tools
      .filter((n) => n.startsWith("mcp__rea__"))
      .sort();
    catalogSize = observed.length;
    assert.deepEqual(
      observed,
      TOOL_CONTRACTS.map((c) => `mcp__rea__${c.name}`).sort(),
      "Qwen must discover the complete REA catalog",
    );
    assert.equal(fixture.failure, undefined);
    assert(finalSeen);
    if (mode === "call") {
      assert(evidenceSeen);
      assert(selectedSkillLoaded);
      assert(artifactReadByAgent);
    }
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
      client: "Qwen Code",
      clientVersion,
      mode,
      reducedPath,
      ...(reducedPath ? { clientPath } : {}),
      registrationCommand,
      passed,
      artifacts: lab,
      runtimeRoot,
      host: {
        platform: process.platform,
        architecture: process.arch,
        node: process.versions.node,
      },
      modelFixture:
        "loopback deterministic OpenAI-compatible endpoint; no live model-provider claim",
      skillDiscovery:
        "native HOME shared personal directory; no explicit skill setting",
      catalogSize,
      requests: fixture?.requests,
      probes: fixture?.probes,
      evidenceSeen,
      selectedSkillLoaded,
      artifactReadByAgent,
      artifactPath,
      artifactDigest,
      finalSeen,
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
