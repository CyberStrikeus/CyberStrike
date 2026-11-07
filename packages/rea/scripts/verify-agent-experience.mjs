import { importVerifierSource } from "./lib/verifier-source-loader.mjs";

import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

import { PRODUCT_IDENTITY } from "../dist/identity.js";
import { createAgentEvaluationCommands } from "./lib/agent-evaluation-commands.mjs";
import { assertAgentEvaluationReportPassed } from "./lib/agent-evaluation-report-gate.mjs";
import {
  closeVerifierResources,
  withVerifierCleanup,
} from "./lib/verifier-cleanup.mjs";
import { completeVerifierRun, createVerifierRun } from "./lib/verifier-run.mjs";

const { parseSkillManifestMetadata } = await importVerifierSource(
  new URL("../src/domain/skillManifest.ts", import.meta.url).href,
  import.meta.url,
);

const { evaluateCodexEvents } = await tsImport(
  new URL("../tests/evaluation/model-evals/CodexAgentEval.ts", import.meta.url)
    .href,
  import.meta.url,
);
const { MISSING_TARGET_SCENARIO, nativeProviderScenario } = await tsImport(
  new URL(
    "../tests/evaluation/model-evals/AgentEvaluationScenarios.ts",
    import.meta.url,
  ).href,
  import.meta.url,
);
const {
  createAgentEvaluationFixtures,
  agentFixtureClaims,
  agentFixtureAnswerInstructions,
} = await tsImport(
  new URL(
    "../tests/evaluation/model-evals/AgentEvaluationFixtures.ts",
    import.meta.url,
  ).href,
  import.meta.url,
);
const { summarizeFactualCorrectness } = await tsImport(
  new URL(
    "../tests/evaluation/model-evals/AgentEvaluationReport.ts",
    import.meta.url,
  ).href,
  import.meta.url,
);

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifierRun = createVerifierRun();
const timeoutMs = Number(process.env.REA_AGENT_EVAL_TIMEOUT_MS ?? 480_000);
const codex = process.env.REA_CODEX_CLI ?? "codex";
const optionalModel = process.env.REA_AGENT_EVAL_MODEL;

if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000)
  throw new Error("REA_AGENT_EVAL_TIMEOUT_MS must be an integer >= 10000");
// Codex refuses helper aliases when CODEX_HOME is under the OS temp directory.
// Keep the disposable account in a private cache, then remove the owned run.
const evaluationParent = resolve(
  process.env.REA_AGENT_EVAL_ROOT ??
    join(homedir(), ".cache", "rea-agent-evaluations"),
);
await mkdir(evaluationParent, { recursive: true, mode: 0o700 });
const evaluationRoot = await mkdtemp(join(evaluationParent, "run-"));
const fixtureRoot = join(evaluationRoot, "targets");
const account = join(evaluationRoot, "account");
const codexHome = join(evaluationRoot, "codex");
const authPath = join(codexHome, "auth.json");
const skillDestination = join(
  account,
  ".agents/skills/reverse-engineer-anything",
);
const evaluationEnvironment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(?:REA_|CODEX_|GHIDRA_|HOPPER_|IDA_)/u.test(name),
    ),
  ),
  HOME: account,
  USERPROFILE: account,
  CODEX_HOME: codexHome,
  XDG_CONFIG_HOME: join(account, ".config"),
  XDG_DATA_HOME: join(account, ".local/share"),
  XDG_CACHE_HOME: join(account, ".cache"),
  REA_PROCESS_RUN_ID: verifierRun.run_id,
  PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
};

const commands = createAgentEvaluationCommands({
  codex,
  evaluationRoot,
  evaluationEnvironment,
  optionalModel,
  timeoutMs,
  repositoryRoot,
});
const { runCodex, runProcess, readCommandVersion } = commands;

await withVerifierCleanup(
  async () => {
    const codexVersion = await readCommandVersion(codex);
    await Promise.all([
      mkdir(fixtureRoot, { recursive: true }),
      mkdir(account),
      mkdir(codexHome, { mode: 0o700 }),
    ]);
    // Reuse authentication only. User config, plugins, rules, history and skills
    // must not make a fresh installed-skill trial pass accidentally.
    try {
      await copyFile(
        join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json"),
        authPath,
      );
      await chmod(authPath, 0o600);
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause;
      // Environment/API-key authentication can work without a local auth file.
    }
    await writeFile(
      join(codexHome, "config.toml"),
      'approval_policy = "never"\nsandbox_mode = "read-only"\nweb_search = "disabled"\n[features]\nmulti_agent = false\nshell_snapshot = false\n[history]\npersistence = "none"\n',
      { mode: 0o600 },
    );
    for (const approval of ["--dry-run", "--yes"]) {
      await runProcess(
        process.execPath,
        [
          join(repositoryRoot, "scripts/rea.mjs"),
          "setup",
          "--client",
          "codex",
          approval,
          "--json",
        ],
        evaluationRoot,
        120_000,
        evaluationEnvironment,
      );
    }
    const installedSkill = await readFile(
      join(skillDestination, "SKILL.md"),
      "utf8",
    );
    const skillMetadata = parseSkillManifestMetadata(installedSkill);
    if (
      !skillMetadata.ok ||
      skillMetadata.value.version !== PRODUCT_IDENTITY.skillVersion
    )
      throw new Error("Setup did not install the current packaged REA skill");
    const requestedScenarioIds = new Set(
      (process.env.REA_AGENT_EVAL_SCENARIOS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    );
    const targets = await createTargets(
      fixtureRoot,
      requestedScenarioIds.size === 0 || requestedScenarioIds.has("managed"),
    );
    const allScenarios = [
      nativeProviderScenario(targets.native),
      {
        id: "asar",
        expectedFirstTool: "analyze_javascript_application",
        requiresEvidence: true,
        requiredAnswerTermGroups: [
          ["profileapi"],
          ["profile:read"],
          ["preload", "contextbridge"],
        ],
        prompt: `Explain how the desktop application at ${targets.javascript} exposes APIs to its renderer. Base the answer on the shipped application artifact, and state what remains unknown.`,
      },
      {
        id: "asar-zh",
        fixtureScenarioId: "asar",
        expectedFirstTool: "analyze_javascript_application",
        requiresEvidence: true,
        requiredAnswerTermGroups: [["profileapi"], ["profile:read"]],
        prompt: `請靜態分析已交付的 Electron 程式 ${targets.javascript}，說明 renderer 如何透過 preload 讀取 profile，以及 main handler 的關係。不要執行目標或安裝分析引擎；引用完整的產出 Evidence，保留 runtime 未知事項。`,
      },
      {
        id: "notes-export",
        expectedFirstTool: "analyze_javascript_application",
        requiresEvidence: true,
        requiredAnswerTermGroups: [],
        requiredToolSubsequence: [
          "analyze_javascript_application",
          "trace_application_feature",
          "trace_javascript_semantics",
        ],
        prompt: `Use REA on the shipped Electron application at ${targets.notesElectron} to investigate its notes export API, preload exposure and main handler. Do not read target files directly or launch Electron. Use the returned application Evidence to trace the exact notes:export IPC channel in both directions, then query semantic relations for the property invoke with forward influence, excluding ambiguous dynamic edges and without an expected sink. Report the selected static facts, source locations and coverage limits using the closed claim contract.`,
      },
      {
        id: "javascript-module-view",
        expectedFirstTool: "analyze_javascript_application",
        requiresEvidence: true,
        requiredToolSubsequence: [
          "analyze_javascript_application",
          "inspect_analysis_view",
          "inspect_analysis_view",
        ],
        requiredAnswerTermGroups: [
          ["main.js"],
          ["node", "identity"],
          ["observations", "recorded"],
        ],
        prompt: `Inspect the recorded module identity, exports and observations for main.js in the shipped JavaScript tree ${targets.largeJavascript}. Use REA without directly reading target files or executing the target. Keep results focused on that module, cite Evidence, and state the limits of what its module view establishes.`,
      },
      MISSING_TARGET_SCENARIO,
      {
        id: "javascript-export-shape",
        expectedFirstTool: "analyze_javascript_application",
        requiresEvidence: true,
        requiredToolSubsequence: [
          "analyze_javascript_application",
          "analyze_javascript_application",
          "compare_javascript_export_shapes",
        ],
        requiredAnswerTermGroups: [
          ["/depth", "depth"],
          [
            "literal value `1`",
            "literal `1`",
            "depth: 1",
            '"depth": 1',
            "depth = 1",
          ],
          ["static", "inferred"],
          ["runtime", "behavioral probes"],
        ],
        prompt: `Without directly reading target files, compare the default export in parser.mjs between ${targets.javascriptShapeLeft} and ${targets.javascriptShapeRight}. Use REA to analyze each shipped artifact and then compare its exact static export return shapes. State the exact heading-shape change, cite produced Evidence, and distinguish static inference from runtime semantics.`,
      },
      {
        id: "managed",
        expectedFirstTool: "inspect_managed_artifact",
        requiresEvidence: true,
        requiredAnswerTermGroups: [["profile"], ["main", "entry point"]],
        requiredToolSubsequence: [
          "inspect_managed_artifact",
          "inspect_managed_members",
        ],
        prompt: `Explain the public managed types and entry point in ${targets.managed}. Use shipped-artifact evidence and distinguish unavailable behavior from observed metadata.`,
      },
      {
        id: "browser",
        expectedFirstTool: "list_browser_targets",
        requiresEvidence: false,
        requiredAnswerTermGroups: [
          ["unavailable", "could not", "connection", "endpoint"],
        ],
        prompt:
          "A user-owned page is already open at http://127.0.0.1:3000 through the approved local debugging endpoint http://127.0.0.1:9222. Inspect what is available without navigating or executing page code, and report any authority or availability limits.",
      },
      {
        id: "navigation-context",
        expectedFirstTool: "get_navigation_context",
        requiresEvidence: false,
        requiredAnswerTermGroups: [["unavailable", "could not", "session"]],
        prompt:
          "Report the selected document, current address, and containing procedure from the current native-analysis session in one coherent request. If no native session is available, report that limitation plainly.",
      },
      {
        id: "address-context",
        expectedFirstTool: "inspect_address_context",
        requiresEvidence: false,
        requiredAnswerTermGroups: [["unavailable", "could not", "session"]],
        prompt:
          "Inspect explicit address 0x401000 in the current native-analysis session. Report its analyzed name, containing procedure, regular comment, inline comment, and matching bookmarks. If no native session is available, report that limitation plainly.",
      },
    ];
    const scenarios =
      requestedScenarioIds.size === 0
        ? allScenarios
        : allScenarios.filter(({ id }) => requestedScenarioIds.has(id));
    if (
      requestedScenarioIds.size > 0 &&
      scenarios.length !== requestedScenarioIds.size
    )
      throw new Error(
        `Unknown or duplicate REA_AGENT_EVAL_SCENARIOS value: ${[...requestedScenarioIds].join(",")}`,
      );
    const results = [];
    for (const scenario of scenarios) {
      process.stderr.write(`Running Codex agent evaluation: ${scenario.id}\n`);
      const fixtureId = scenario.fixtureScenarioId ?? scenario.id;
      const fixtureClaims = agentFixtureClaims(fixtureId, targets);
      const answerInstructions = agentFixtureAnswerInstructions(fixtureId);
      const execution = await runCodex(
        answerInstructions.length === 0
          ? scenario.prompt
          : `${scenario.prompt}\n\nThis closed factual rubric needs complete producer Evidence in the transcript. Request complete detail on each initial inspection or analysis when supported; summary or view records alone are not accepted by this rubric.\n\n${answerInstructions}`,
        scenario.approvedTools ?? [],
      );
      const transcriptDirectory = process.env.REA_AGENT_EVAL_TRANSCRIPT_DIR;
      if (transcriptDirectory !== undefined) {
        const transcriptPath = resolve(
          transcriptDirectory,
          `${scenario.id}.jsonl`,
        );
        await mkdir(dirname(transcriptPath), { recursive: true });
        await writeFile(
          transcriptPath,
          `${execution.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        );
      }
      const metrics = evaluateCodexEvents(
        execution.events,
        scenario.expectedFirstTool,
        {
          requireEvidence: scenario.requiresEvidence,
          requiredAnswerTermGroups: scenario.requiredAnswerTermGroups,
          requiredToolSubsequence: scenario.requiredToolSubsequence,
          forbidInputValidationFailures: true,
          ...(fixtureClaims === undefined ? {} : { fixtureClaims }),
        },
      );
      // Fixtures are deliberately visible beside prior investigation artifacts.
      // Their existence does not identify the unnamed app in this request.
      const targetClarificationPassed =
        scenario.expectedFirstTool === null
          ? scenario.validTargetClarification(metrics.finalMessage)
          : undefined;
      const scenarioOutcome = scenario.assess?.(metrics);
      const result = {
        id: scenario.id,
        expectedFirstTool: scenario.expectedFirstTool,
        requiresEvidence: scenario.requiresEvidence,
        requiredAnswerTermGroups: scenario.requiredAnswerTermGroups,
        requiredToolSubsequence: scenario.requiredToolSubsequence ?? [],
        configuredClaimIds: fixtureClaims?.map(({ id }) => id) ?? [],
        exitCode: execution.exitCode,
        stderr: execution.stderr,
        ...metrics,
        ...(scenarioOutcome === undefined
          ? {}
          : {
              scenarioOutcome,
              scenarioOutcomePassed: scenarioOutcome !== "failed",
            }),
        ...(targetClarificationPassed === undefined
          ? {}
          : { targetClarificationPassed }),
      };
      results.push(result);
      process.stderr.write(
        `${scenario.id}: first=${metrics.firstTool ?? "none"}, calls=${String(metrics.reaCalls.length)}, repeats=${String(metrics.repeatedCallCount)}, validation_failures=${String(metrics.inputValidationFailureCount)}, input_tokens=${String(metrics.inputTokens)}\n`,
      );
    }

    const factualCorrectness = summarizeFactualCorrectness(results);
    const summary = {
      schemaVersion: 4,
      evaluationScope: "routing_workflow_and_configured_fixture_claims",
      factualCorrectness,
      verifier_run: await completeVerifierRun(verifierRun),
      codex,
      codexVersion,
      model: optionalModel ?? null,
      installation: {
        method: "rea_setup_codex",
        isolatedHome: true,
        isolatedCodexHome: true,
        skillVersion: PRODUCT_IDENTITY.skillVersion,
        authentication: "caller_auth_only_removed_after_run",
      },
      scenarios: results,
      totals: {
        scenarios: results.length,
        naturalUse: results.filter(({ naturalUse }) => naturalUse).length,
        correctFirstTool: results.filter(
          ({ correctFirstTool }) => correctFirstTool,
        ).length,
        repeatedCallCount: results.reduce(
          (total, { repeatedCallCount }) => total + repeatedCallCount,
          0,
        ),
        inputValidationFailureCount: results.reduce(
          (total, { inputValidationFailureCount }) =>
            total + inputValidationFailureCount,
          0,
        ),
        requiredToolSubsequence: results.filter(
          ({ requiredToolSubsequenceMet }) => requiredToolSubsequenceMet,
        ).length,
        inputTokens: results.reduce(
          (total, { inputTokens }) => total + inputTokens,
          0,
        ),
        cachedInputTokens: results.reduce(
          (total, { cachedInputTokens }) => total + cachedInputTokens,
          0,
        ),
        answerHeuristicsMet: results.filter(({ answerHeuristicsMet }) =>
          Boolean(answerHeuristicsMet),
        ).length,
        epistemicCuePresent: results.filter(({ epistemicCuePresent }) =>
          Boolean(epistemicCuePresent),
        ).length,
        factualScenariosPassed: factualCorrectness.counts.passed,
        factualScenariosFailed: factualCorrectness.counts.failed,
        factualScenariosNotAssessed: factualCorrectness.counts.notAssessed,
      },
    };
    const encoded = `${JSON.stringify(summary, null, 2)}\n`;
    process.stdout.write(encoded);
    const reportPath = process.env.REA_AGENT_EVAL_REPORT_PATH;
    if (reportPath !== undefined) {
      await mkdir(dirname(resolve(reportPath)), { recursive: true });
      await writeFile(resolve(reportPath), encoded);
    }

    assertAgentEvaluationReportPassed(results);
  },
  // Even a deliberately retained fixture directory must never retain auth.
  [
    async () => {
      // A failed process cleanup retains both its exact owner and its files.
      await commands.close();
      await closeVerifierResources([
        () => rm(authPath, { force: true }),
        ...(process.env.REA_AGENT_EVAL_KEEP_FIXTURES === "true"
          ? []
          : [() => rm(evaluationRoot, { recursive: true, force: true })]),
      ]);
    },
  ],
);

async function createTargets(root, includeManaged) {
  const fixtures = await createAgentEvaluationFixtures(root, repositoryRoot);
  const largeJavascript = join(root, "large-app");
  await mkdir(join(largeJavascript, "lib"), { recursive: true });
  await Promise.all([
    writeFile(
      join(largeJavascript, "package.json"),
      '{"name":"large-app","main":"main.js"}\n',
    ),
    writeFile(
      join(largeJavascript, "main.js"),
      'const { ipcMain } = require("electron");\nipcMain.handle("profile:read", (_event, id) => ({ id }));\n',
    ),
    ...Array.from({ length: 180 }, (_, index) =>
      writeFile(
        join(largeJavascript, "lib", `formatter-${String(index)}.js`),
        `export const format = (value) => String(value).trim();\n`,
      ),
    ),
  ]);

  const managedOutput = join(root, "managed-output");
  if (includeManaged) {
    const managedProject = join(root, "managed-project");
    await mkdir(managedProject, { recursive: true });
    await Promise.all([
      writeFile(
        join(managedProject, "AgentEval.csproj"),
        '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup></Project>\n',
      ),
      writeFile(
        join(managedProject, "Program.cs"),
        'namespace AgentEval; public sealed record Profile(string Id); public static class Program { public static void Main() => Console.WriteLine(new Profile("fixture")); }\n',
      ),
    ]);
    await runProcess(
      "dotnet",
      [
        "build",
        join(managedProject, "AgentEval.csproj"),
        "--configuration",
        "Release",
        "--output",
        managedOutput,
        "--nologo",
      ],
      root,
      120_000,
    );
  }
  return {
    native: "/bin/true",
    ...fixtures,
    largeJavascript,
    managed: join(managedOutput, "AgentEval.dll"),
    ...(includeManaged
      ? {
          managedSha256: createHash("sha256")
            .update(await readFile(join(managedOutput, "AgentEval.dll")))
            .digest("hex"),
        }
      : {}),
  };
}
