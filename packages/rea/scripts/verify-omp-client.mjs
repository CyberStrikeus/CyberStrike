import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_CONTRACTS } from "../dist/contracts/toolContracts.js";
import { createVerifierCommands } from "./lib/verify-commands.mjs";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";
import { saveVerifierCommandOutput } from "./lib/verifier-command-output.mjs";
import {
  CLIENT_JAVASCRIPT_FIXTURE_SOURCE,
  assertClientJavaScriptFixtureEvidence,
} from "./verify/clients/javascript-fixture.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";
import { createOpenAiModelFixture } from "./verify/clients/model-fixture.mjs";

assert(
  process.platform !== "win32",
  "Native OMP verifier requires POSIX; Windows is unverified",
);
const repo = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoot = process.env.REA_VERIFY_RUNTIME_ROOT ?? repo;
const command = process.env.REA_VERIFY_OMP_COMMAND ?? "omp";
const mode = process.argv[2] ?? "call";
assert(
  ["chat", "call"].includes(mode),
  "Usage: verify-omp-client.mjs [chat|call]",
);
const verifier = createVerifierRun();
const lab = await mkdtemp(join(tmpdir(), "rea-omp-client-"));
const account = join(lab, "account");
const agent = join(lab, "selected agent");
const workspace = join(lab, "workspace");
const configPath = join(agent, "mcp.json");
const skillDirectory = join(
  account,
  ".agents",
  "skills",
  "reverse-engineer-anything",
);
const expectedDevices = TOOL_CONTRACTS.map(
  (tool) => "mcp__rea_" + tool.name,
).sort();
let clientVersion = null;
let expectedSkillBody;
let skillLoaded = false;
let contractRead = false;
let evidenceSeen = false;
let artifactDigest;
let finalSeen = false;
let catalogMounted = false;
let catalogSize = null;
let invalidProfileRejected = false;
let passed = false;
let fixture;
const commands = await createVerifierCommands();
await withVerifierCleanup(async () => {
  await withVerifierCleanup(async () => {
    await Promise.all([
      mkdir(account),
      mkdir(agent),
      mkdir(workspace),
      ...["data", "state", "cache"].map((name) =>
        mkdir(join(lab, name, "omp"), { recursive: true }),
      ),
    ]);
    await commands.exec("git", ["init", "--quiet", workspace], {
      timeout: 30_000,
      stdin: "pipe",
    });
    // OMP's global config root uses native homedir independently of the agent override.
    // A documented relative PI_CONFIG_DIR redirects it without changing HOME.
    const environment = {
      PATH: process.env.PATH,
      NODE_OPTIONS: process.env.NODE_OPTIONS,
      USERPROFILE: account,
      PI_CODING_AGENT_DIR: agent,
      PI_CONFIG_DIR: relative(homedir(), join(lab, "native-config")),
      OMP_PROFILE: "",
      XDG_DATA_HOME: join(lab, "data"),
      XDG_STATE_HOME: join(lab, "state"),
      XDG_CACHE_HOME: join(lab, "cache"),
      REA_PROCESS_RUN_ID: verifier.run_id,
    };
    const target = join(lab, "fixture α测试");
    await mkdir(target);
    await writeFile(join(target, "app.js"), CLIENT_JAVASCRIPT_FIXTURE_SOURCE);
    const analysisDevice = "xd://mcp__rea_analyze_javascript_application";
    const containsText = (value, text) => {
      if (typeof value === "string") return value.includes(text);
      return (
        value !== null &&
        typeof value === "object" &&
        Object.values(value).some((item) => containsText(item, text))
      );
    };
    const call = (index, name, args) => ({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: `call_omp_${index}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    });
    fixture = await createOpenAiModelFixture({
      directory: lab,
      prefix: "omp",
      onRequest: async ({ body, tools, requestIndex }) => {
        assert(tools.some((tool) => tool.name === "read"));
        assert(tools.some((tool) => tool.name === "write"));
        const instructions = body.messages.filter(
          (message) => message.role === "system",
        );
        for (const device of expectedDevices)
          assert(
            containsText(instructions, device),
            `OMP must advertise mounted device ${device}`,
          );
        if (mode === "chat") {
          finalSeen = true;
          return { role: "assistant", content: "REA_CLIENT_COMPATIBILITY_OK" };
        }
        const replies = body.messages.filter(
          (message) => message.role === "tool",
        );
        if (requestIndex === 1)
          return call(requestIndex, "read", {
            i: "Load REA skill",
            path: "skill://reverse-engineer-anything:raw",
          });
        assert(
          expectedSkillBody !== undefined &&
            containsText(replies, expectedSkillBody),
          "OMP must return the complete installed skill body",
        );
        skillLoaded = true;
        if (requestIndex === 2)
          return call(requestIndex, "read", {
            i: "Inspect REA native tool contract",
            path: analysisDevice,
          });
        assert(
          containsText(replies, "# mcp__rea_analyze_javascript_application"),
        );
        assert(
          containsText(replies, "input_path") &&
            containsText(replies, '"directory"'),
        );
        contractRead = true;
        if (requestIndex === 3)
          return call(requestIndex, "write", {
            path: analysisDevice,
            content: JSON.stringify({
              input_path: target,
              format: "directory",
            }),
          });
        const evidenceReply = replies.find(
          (reply) =>
            typeof reply.content === "string" &&
            reply.content.startsWith('{"evidence_id":'),
        );
        assert(
          evidenceReply,
          "OMP must deliver the full analysis result to the next model turn",
        );
        const { evidence } = await assertClientJavaScriptFixtureEvidence(
          JSON.parse(evidenceReply.content),
          target,
        );
        const bytes = JSON.stringify(evidence);
        artifactDigest = createHash("sha256").update(bytes).digest("hex");
        await writeFile(join(lab, "omp-evidence.json"), bytes);
        evidenceSeen = true;
        finalSeen = true;
        return { role: "assistant", content: "REA_CLIENT_COMPATIBILITY_OK" };
      },
    });
    const original = JSON.stringify(
      {
        mcpServers: { other: { command: "unrelated-server", enabled: false } },
        disabledServers: ["rea", "other"],
      },
      null,
      2,
    );
    await writeFile(configPath, original);
    await writeFile(
      join(agent, "config.yml"),
      JSON.stringify({
        skills: { customDirectories: [join(account, ".agents", "skills")] },
        retry: { fallbackChains: { default: [] } },
      }),
    );
    await writeFile(
      join(agent, "models.yml"),
      JSON.stringify({
        providers: {
          "rea-fixture": {
            baseUrl: fixture.baseUrl,
            apiKey: "local-fixture-key",
            api: "openai-completions",
            models: [
              {
                id: "rea-client-fixture",
                name: "REA local fixture",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 1000000,
                maxTokens: 4096,
              },
            ],
          },
        },
      }),
    );
    const rea = async (args, env = environment) =>
      commands.exec(
        process.execPath,
        [join(runtimeRoot, "scripts/rea.mjs"), ...args, "--json"],
        { env, cwd: workspace, timeout: 60_000, stdin: "pipe" },
      );
    clientVersion = (
      await commands.exec(command, ["--version"], {
        env: environment,
        timeout: 30_000,
        stdin: "pipe",
      })
    ).stdout.trim();
    const invalidEnvironment = { ...environment, OMP_PROFILE: "Bad Name" };
    const nativeRejected = await commands
      .exec(command, ["--print", "--no-session", "--no-title", "Hello"], {
        env: invalidEnvironment,
        cwd: workspace,
        timeout: 30_000,
        stdin: "pipe",
      })
      .then(
        () => undefined,
        (cause) => {
          if (typeof cause?.code !== "number" || cause.code === 0) throw cause;
          return cause;
        },
      );
    assert(
      nativeRejected?.code === 1 &&
        nativeRejected.snapshot.stderr.text.includes(
          'Invalid OMP profile "Bad Name"',
        ),
    );
    await writeFile(
      join(lab, "invalid-profile-native.stderr"),
      nativeRejected.snapshot.stderr.text,
    );
    const setupRejected = await rea(
      ["setup", "--client", "omp", "--dry-run"],
      invalidEnvironment,
    ).then(
      () => undefined,
      (cause) => {
        if (typeof cause?.code !== "number" || cause.code === 0) throw cause;
        return cause;
      },
    );
    assert(typeof setupRejected?.code === "number" && setupRejected.code !== 0);
    const rejected = JSON.parse(setupRejected.snapshot.stdout.text);
    assert.equal(rejected.status, "needs_human");
    assert.deepEqual(rejected.plannedActions, []);
    assert.deepEqual(rejected.appliedActions, []);
    assert(rejected.remediation.includes('Invalid OMP profile "Bad Name"'));
    assert.equal(await readFile(configPath, "utf8"), original);
    await writeFile(
      join(lab, "invalid-profile-setup.json"),
      setupRejected.snapshot.stdout.text,
    );
    invalidProfileRejected = true;
    for (const args of [
      ["setup", "--client", "omp", "--dry-run"],
      ["setup", "--client", "omp", "--yes"],
      ["doctor", "--client", "omp", "--skill"],
    ]) {
      const result = await rea(args);
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
          assert(
            parsed.plannedActions.some(
              (action) => action.target === configPath,
            ),
          );
          assert(
            parsed.plannedActions.some(
              (action) => action.target === skillDirectory,
            ),
          );
          assert(
            parsed.plannedActions.every(
              (action) =>
                action.target === configPath ||
                action.target === skillDirectory ||
                action.target.startsWith(skillDirectory + "/"),
            ),
            "Refuse setup writes outside the owned config/skill",
          );
        }
      }
    }
    assert.equal(await readFile(`${configPath}.rea.backup`, "utf8"), original);
    const configured = await readFile(configPath, "utf8");
    const registration = JSON.parse(configured);
    assert.equal(registration.mcpServers.other.command, "unrelated-server");
    assert.deepEqual(registration.disabledServers, ["other"]);
    const repeated = JSON.parse(
      (await rea(["setup", "--client", "omp", "--yes"])).stdout,
    );
    assert.deepEqual(repeated.appliedActions, []);
    assert.equal(await readFile(configPath, "utf8"), configured);
    assert.equal(await readFile(`${configPath}.rea.backup`, "utf8"), original);
    expectedSkillBody = await readFile(
      join(skillDirectory, "SKILL.md"),
      "utf8",
    );
    const response = await saveVerifierCommandOutput(
      () =>
        commands.exec(
          command,
          [
            "--mode",
            "json",
            "--print",
            "--no-session",
            "--no-title",
            "--no-lsp",
            "--no-pty",
            "--approval-mode",
            "yolo",
            "--model",
            "rea-fixture/rea-client-fixture",
            mode === "chat"
              ? "Say hello briefly."
              : `Use the REA skill to analyze ${target}.`,
          ],
          {
            env: environment,
            cwd: workspace,
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
            stdin: "closed-pipe",
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
    const mounted = events
      .filter(
        (event) =>
          event.type === "notice" &&
          event.message?.startsWith("xd://: mounted "),
      )
      .flatMap((event) =>
        event.message.slice("xd://: mounted ".length).split(", "),
      )
      .filter((name) => name.startsWith("mcp__rea_"));
    catalogSize = mounted.length;
    assert.deepEqual(
      mounted.sort(),
      expectedDevices,
      "Native OMP must mount the complete REA catalog",
    );
    catalogMounted = true;
    assert(
      !events.some(
        (event) => event.type === "tool_execution_end" && event.isError,
      ),
    );
    assert(
      events.some(
        (event) =>
          event.type === "message_end" &&
          event.message?.role === "assistant" &&
          event.message.stopReason === "stop" &&
          containsText(event.message.content, "REA_CLIENT_COMPATIBILITY_OK"),
      ),
      "OMP must finish with the expected native assistant message",
    );
    assert(
      events.some((event) => event.type === "agent_end" && event.isTerminal),
    );
    assert(finalSeen);
    if (mode === "call") assert(skillLoaded && contractRead && evidenceSeen);
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
      client: "OMP",
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
        "loopback OpenAI completions/SSE, caller-declared one-million-token model and synthetic usage; no live model claim",
      discovery:
        "explicit isolated default agent/global config/XDG roots and custom skill directory; named profiles, default OS-home skill discovery and Windows unverified",
      interface:
        "default native xd:// device metadata with read/write dispatch; complete JSON schemas are not forwarded as model functions",
      catalogMounted,
      catalogSize,
      invalidProfileRejected,
      skillLoaded,
      contractRead,
      evidenceSeen,
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
