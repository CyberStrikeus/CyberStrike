import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
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
  "Native Grok verifier requires POSIX; Windows is unverified",
);
const repo = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoot = process.env.REA_VERIFY_RUNTIME_ROOT ?? repo;
const command = process.env.REA_VERIFY_GROK_COMMAND ?? "grok";
const mode = process.argv[2] ?? "call";
assert(
  ["chat", "call"].includes(mode),
  "Usage: verify-grok-client.mjs [chat|call]",
);
const verifier = createVerifierRun();
const lab = await mkdtemp(join(tmpdir(), "rea-grok-client-"));
const account = join(lab, "account");
const profile = join(lab, "selected profile");
const workspace = join(lab, "workspace");
const configPath = join(profile, "config.toml");
const skillDirectory = join(
  account,
  ".agents",
  "skills",
  "reverse-engineer-anything",
);
const expectedNames = TOOL_CONTRACTS.map((tool) => "rea__" + tool.name).sort();
let clientVersion = null;
let expectedSkill;
let turn = 0;
let skillRequested = false;
let skillLoaded = false;
let diagnosticsRequested = false;
let diagnosticsVerified = false;
let lastTool;
let catalogChecked = false;
let catalogSize = null;
let schemasChecked = 0;
let analysisRequested = false;
let evidenceSeen = false;
let spillQueryRequested = false;
let projectionSeen = false;
let artifactDigest;
let artifactBytes;
let retainedArtifact;
let expectedProjection;
let finalSeen = false;
let passed = false;
let fixture;
const commands = await createVerifierCommands();
await withVerifierCleanup(async () => {
  await withVerifierCleanup(async () => {
    await Promise.all([mkdir(account), mkdir(profile), mkdir(workspace)]);
    await commands.exec("git", ["init", "--quiet", workspace], {
      timeout: 30_000,
      stdin: "pipe",
    });
    // Native compatibility discovery is independent of GROK_HOME. Disable those
    // sources and ignore the real shared skill root instead of changing HOME.
    const environment = {
      PATH: process.env.PATH,
      NODE_OPTIONS: process.env.NODE_OPTIONS,
      USERPROFILE: account,
      GROK_HOME: profile,
      GROK_DISABLE_AUTOUPDATER: "1",
      ...Object.fromEntries(
        ["CLAUDE", "CURSOR"].flatMap((vendor) =>
          ["SKILLS", "RULES", "AGENTS", "MCPS", "HOOKS", "SESSIONS"].map(
            (cell) => [`GROK_${vendor}_${cell}_ENABLED`, "false"],
          ),
        ),
      ),
      XDG_DATA_HOME: join(lab, "data"),
      XDG_CONFIG_HOME: join(lab, "config"),
      XDG_CACHE_HOME: join(lab, "cache"),
      REA_PROCESS_RUN_ID: verifier.run_id,
    };
    const target = join(lab, "fixture α测试");
    await mkdir(target);
    await writeFile(
      join(target, "app.js"),
      CLIENT_JAVASCRIPT_FIXTURE_SOURCE +
        // A real analysis result large enough to exercise native MCP offloading.
        Array.from(
          { length: 60 },
          (_, index) =>
            `export function extra${index}() { return { index: ${index}, tag: "GROK_LARGE_FIXTURE" }; }`,
        ).join("\n"),
    );
    assert(
      expectedNames.length <= 255,
      "Native search_tool limit is uint8; this full-catalog query cannot cover more than 255 tools",
    );
    const schemaValidator = new Ajv2020({
      strict: false,
      validateFormats: false,
    });
    const shellQuote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
    const containsText = (value, text) => {
      if (typeof value === "string") return value.includes(text);
      return (
        value !== null &&
        typeof value === "object" &&
        Object.values(value).some((item) => containsText(item, text))
      );
    };
    const call = (name, args) => {
      lastTool = name;
      return {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `call_grok_${turn}`,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      };
    };
    const verifyEvidence = async (bytes) => {
      const { evidence, shapes } = await assertClientJavaScriptFixtureEvidence(
        JSON.parse(bytes.toString("utf8")),
        target,
      );
      artifactDigest = createHash("sha256").update(bytes).digest("hex");
      artifactBytes = bytes.length;
      evidenceSeen = true;
      return {
        evidence_id: evidence.evidence_id,
        subject: evidence.subject,
        operation: evidence.operation,
        artifact_sha256: artifactDigest,
        byte_length: artifactBytes,
        shapes,
      };
    };
    const diagnosticFile = join(lab, "native-doctor.json");
    const diagnosticCode =
      "const fs=require('node:fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify({rea_client_diagnostic:{healthy:d.healthy,registrations:d.identity.registrations.filter(r=>r.client==='grok_build'),skill:d.identity.skill.state}}));";
    // Query the saved result through a native agent command. Only the facts needed
    // for this analyst question enter context; the complete named-schema Evidence
    // and its digest remain available in the native artifact.
    const recoveryCode =
      "const fs=require('node:fs'),crypto=require('node:crypto');const bytes=fs.readFileSync(process.argv[1]),e=JSON.parse(bytes);const shapes=e.normalized_result.graph.nodes.flatMap(n=>n.observations).map(o=>o.properties).filter(p=>p.semantic_role==='export-return-shapes'&&p.exported_name==='result');console.log(JSON.stringify({rea_recovered:{evidence_id:e.evidence_id,subject:e.subject,operation:e.operation,artifact_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),byte_length:bytes.length,shapes}}));";
    fixture = await createOpenAiModelFixture({
      directory: lab,
      prefix: "grok",
      onRequest: async ({ body, tools }) => {
        // Native title/summary requests cannot execute the analyst workflow.
        if (!tools.some((tool) => tool.name === "search_tool"))
          return {
            role: "assistant",
            content: "REA fixture auxiliary response",
          };
        turn++;
        assert(
          containsText(body.messages, skillDirectory),
          "Grok must discover the isolated installed skill",
        );
        assert(
          !containsText(body.messages, join(homedir(), ".agents", "skills")),
          "Do not inherit real personal skills",
        );
        if (mode === "chat") {
          finalSeen = true;
          return { role: "assistant", content: "REA_CLIENT_COMPATIBILITY_OK" };
        }
        const replies = body.messages.filter(
          (message) => message.role === "tool",
        );
        if (!skillRequested) {
          skillRequested = true;
          return call("read_file", {
            target_file: join(skillDirectory, "SKILL.md"),
          });
        }
        assert(
          expectedSkill !== undefined && containsText(replies, expectedSkill),
          "Native read_file must return the full skill with its documented line-number rendering",
        );
        skillLoaded = true;
        const last = replies.at(-1)?.content;
        assert.equal(typeof last, "string");
        if (!catalogChecked) {
          const discovery =
            lastTool === "search_tool" ? JSON.parse(last) : undefined;
          if (discovery?.status === "partial" && !diagnosticsRequested) {
            diagnosticsRequested = true;
            const diagnostic = [
              process.execPath,
              join(runtimeRoot, "scripts/rea.mjs"),
              "doctor",
              "--client",
              "grok_build",
              "--skill",
              "--json",
            ]
              .map(shellQuote)
              .join(" ");
            const projection = [
              process.execPath,
              "-e",
              diagnosticCode,
              diagnosticFile,
            ]
              .map(shellQuote)
              .join(" ");
            return call("run_terminal_command", {
              command: `${diagnostic} > ${shellQuote(diagnosticFile)} && ${projection}`,
              description:
                "Diagnose REA registration while native MCP discovery is pending",
            });
          }
          if (lastTool === "run_terminal_command") {
            const line = last
              .split("\n")
              .find((item) => item.startsWith('{"rea_client_diagnostic":'));
            assert(
              line,
              "Native REA diagnostics failed or did not return the selected status",
            );
            const diagnostic = JSON.parse(line).rea_client_diagnostic;
            assert.equal(diagnostic.healthy, true);
            assert.equal(diagnostic.skill, "aligned");
            assert(
              diagnostic.registrations.some(
                (registration) =>
                  registration.state === "aligned" &&
                  registration.config_path === configPath,
              ),
            );
            diagnosticsVerified = true;
          }
          if (discovery?.status !== "ready")
            return call("search_tool", { query: "rea", limit: 255 });
          const inventory = discovery.results
            .filter((result) => result.server === "rea")
            .flatMap((result) => result.tools);
          catalogSize = inventory.length;
          assert.deepEqual(
            inventory.map((tool) => tool.tool_name).sort(),
            expectedNames,
            "Native search_tool must discover the complete REA catalog",
          );
          for (const tool of inventory) {
            assert(
              tool.input_schema,
              `${tool.tool_name}: missing input schema`,
            );
            assert(
              schemaValidator.validateSchema(tool.input_schema),
              `${tool.tool_name}: invalid advertised schema: ${JSON.stringify(schemaValidator.errors)}`,
            );
            schemasChecked++;
          }
          await writeFile(join(lab, "native-discovery.json"), last);
          catalogChecked = true;
          analysisRequested = true;
          return call("use_tool", {
            tool_name: "rea__analyze_javascript_application",
            tool_input: { input_path: target, format: "directory" },
          });
        }
        if (!spillQueryRequested) {
          const marker = "Full output written to: ";
          const start = last.indexOf(marker);
          if (start < 0) {
            await verifyEvidence(Buffer.from(last, "utf8"));
            finalSeen = true;
            return {
              role: "assistant",
              content: "REA_CLIENT_COMPATIBILITY_OK",
            };
          }
          // The native hint explicitly calls for a query rather than read_file on
          // the saved JSON's very long line. Preserve the original hint in requests.
          const file = last
            .slice(start + marker.length)
            .split(". The full output ")[0];
          assert(isAbsolute(file));
          const childPath = relative(join(profile, "sessions"), file);
          assert(
            childPath !== "" &&
              !childPath.startsWith("..") &&
              !isAbsolute(childPath) &&
              file.endsWith(".json"),
            "Unexpected native MCP spill path",
          );
          retainedArtifact = file;
          expectedProjection = await verifyEvidence(await readFile(file));
          spillQueryRequested = true;
          return call("run_terminal_command", {
            command: [process.execPath, "-e", recoveryCode, file]
              .map(shellQuote)
              .join(" "),
            description:
              "Query full saved REA Evidence while preserving artifact identity",
          });
        }
        const line = last
          .split("\n")
          .find((item) => item.startsWith('{"rea_recovered":'));
        assert(
          line,
          "The next model request must contain native artifact query output",
        );
        const projection = JSON.parse(line).rea_recovered;
        assert.deepEqual(
          projection,
          expectedProjection,
          "Native query must recover the observed facts and complete artifact digest",
        );
        projectionSeen = true;
        finalSeen = true;
        return { role: "assistant", content: "REA_CLIENT_COMPATIBILITY_OK" };
      },
    });
    const q = JSON.stringify;
    const original = `# Keep unrelated settings and server state.
disabled_mcp_servers = ["rea", "other"]
[cli]
auto_update = false
[features]
telemetry = "off"
[skills]
paths = [${q(join(account, ".agents", "skills"))}]
ignore = [${q(join(homedir(), ".agents", "skills"))}]
[model.rea-client-fixture]
model = "rea-client-fixture"
base_url = ${q(fixture.baseUrl)}
api_key = "local-fixture-key"
api_backend = "chat_completions"
context_window = 1000000
max_completion_tokens = 4096
[mcp_servers.other]
command = "unrelated-server"
enabled = false
`;
    await writeFile(configPath, original);
    const rea = async (args) =>
      commands.exec(
        process.execPath,
        [join(runtimeRoot, "scripts/rea.mjs"), ...args, "--json"],
        { env: environment, cwd: workspace, timeout: 60_000, stdin: "pipe" },
      );
    clientVersion = (
      await commands.exec(command, ["--version"], {
        env: environment,
        timeout: 30_000,
        stdin: "pipe",
      })
    ).stdout.trim();
    for (const args of [
      ["setup", "--client", "grok_build", "--dry-run"],
      ["setup", "--client", "grok_build", "--yes"],
      ["doctor", "--client", "grok_build", "--skill"],
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
            "Refuse writes outside the owned profile/skill",
          );
        }
      }
    }
    assert.equal(await readFile(`${configPath}.rea.backup`, "utf8"), original);
    const configured = await readFile(configPath, "utf8");
    assert(
      configured.includes("unrelated-server") &&
        configured.includes("# Keep unrelated settings"),
    );
    const repeated = JSON.parse(
      (await rea(["setup", "--client", "grok_build", "--yes"])).stdout,
    );
    assert.deepEqual(repeated.appliedActions, []);
    assert.equal(await readFile(configPath, "utf8"), configured);
    assert.equal(await readFile(`${configPath}.rea.backup`, "utf8"), original);
    const skill = await readFile(join(skillDirectory, "SKILL.md"), "utf8");
    expectedSkill = skill
      .trimEnd()
      .split("\n")
      .map((line, index) =>
        index === 0 || (index + 1) % 10 === 0 ? `${index + 1}→${line}` : line,
      )
      .join("\n");
    const response = await saveVerifierCommandOutput(
      () =>
        commands.exec(
          command,
          [
            "-p",
            mode === "chat"
              ? "Say hello briefly."
              : `Use the REA skill to analyze ${target}.`,
            "-m",
            "rea-client-fixture",
            "--output-format",
            "streaming-messages-json",
            "--always-approve",
            "--no-subagents",
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
    const init = events.find(
      (event) => event.type === "system" && event.subtype === "init",
    );
    assert(init?.mcp_servers?.some((server) => server.name === "rea"));
    assert(
      init.mcp_servers.every((server) =>
        ["rea", "other"].includes(server.name),
      ),
      "Do not inherit foreign MCP configuration",
    );
    assert(
      events.some(
        (event) =>
          event.type === "result" &&
          event.subtype === "success" &&
          event.is_error === false &&
          event.result === "REA_CLIENT_COMPATIBILITY_OK",
      ),
    );
    assert(finalSeen);
    if (mode === "call")
      assert(
        skillLoaded &&
          catalogChecked &&
          analysisRequested &&
          evidenceSeen &&
          (!spillQueryRequested || projectionSeen) &&
          (!diagnosticsRequested || diagnosticsVerified),
      );
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
      client: "Grok Build",
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
        "loopback OpenAI completions/SSE, declared one-million-token custom model and synthetic usage; no live model claim",
      discovery:
        "native GROK_HOME, isolated additional skill directory, disabled foreign compatibility sources; default OS-home skill discovery and Windows unverified",
      interface:
        "default native search_tool/use_tool with a complete explicit inventory query; asynchronous partial discovery may trigger native REA diagnosis; large MCP outputs are queried via native terminal",
      catalogChecked,
      catalogSize,
      schemasChecked,
      skillLoaded,
      diagnosticsRequested,
      diagnosticsVerified,
      analysisRequested,
      evidenceSeen,
      spillQueryRequested,
      projectionSeen,
      retainedArtifact,
      artifactBytes,
      artifactDigest,
      finalSeen,
      evidenceScope:
        "complete saved Evidence validated with its named schema; the model receives the selected export facts, subject and full artifact digest, not every offloaded graph fact",
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
