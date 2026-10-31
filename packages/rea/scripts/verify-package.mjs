import { mkdir, mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TOOL_CONTRACTS } from "../dist/contracts/toolContracts.js";
import { PRODUCT_IDENTITY } from "../dist/identity.js";
import { resolveMcpStartupBudgets } from "../dist/config/mcpStartupBudgets.js";
import * as prompts from "./verify-package-prompts.mjs";
import { verifyPackageArtifactAndElectron } from "./verify-package-artifact.mjs";
import { verifyPackageCapabilitiesAndSearch } from "./verify-package-capabilities.mjs";
import { verifyPackageDiscovery } from "./verify-package-discovery.mjs";
import { verifyPackageEnvironment } from "./verify-package-environment.mjs";
import { verifyPackageEvidence } from "./verify-package-evidence.mjs";
import { verifyPackageInstall } from "./verify-package-install.mjs";
import { verifyPackageUpdate } from "./verify-package-update.mjs";
import { verifyPackageMcp } from "./verify-package-mcp.mjs";
import { verifyPackagePack } from "./verify-package-pack.mjs";
import { verifyPackagePlatform } from "./verify-package-platform.mjs";
import { verifyPackageSetup } from "./verify-package-setup.mjs";
import { verifyRepositorySkill } from "./verify-repository-skill.mjs";
import { verifyManaged } from "./verify-package-managed.mjs";
import { verifyUnknownProvider } from "./verify-package-unknown-provider.mjs";
import { createPackageVerifierCommands } from "./lib/verify-package-commands.mjs";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";
import { completeVerifierRun, createVerifierRun } from "./lib/verifier-run.mjs";
import {
  createVerifiedPackageMetadata,
  retainVerifiedPackage,
  writeVerifiedPackageManifest,
} from "./ci/verified-package.mjs";
import {
  measureMcpStartup,
  profileMcpModuleLoading,
} from "./lib/mcp-startup-probe.mjs";

const root = process.cwd();
const retentionDirectory = process.env.REA_VERIFIED_PACKAGE_DIRECTORY;
const verifierRun = createVerifierRun();
const workspace = await mkdtemp(join(tmpdir(), "rea-package-"));
const evidenceRoot = join(workspace, "evidence");
const referenceRoot = join(workspace, "reference-source");
let tarball;
let mcpStartup;
let mcpModuleLoading;
let update;
let repositorySkill;
let report;
let retainedPackage;
let retentionMetadata;
let commands;
const releaseWorkspace = () =>
  runStage("workspace cleanup", () =>
    rm(workspace, { recursive: true, force: true }),
  );

const runStage = async (name, action) => {
  const started = performance.now();
  process.stderr.write(`[verify:package] ${name}: start\n`);
  const result = await action();
  process.stderr.write(
    `[verify:package] ${name}: complete (${Math.round(performance.now() - started)} ms)\n`,
  );
  return result;
};

await withVerifierCleanup(async () => {
  commands = await createPackageVerifierCommands({
    workspace: { path: workspace, close: releaseWorkspace },
  });
  if (retentionDirectory !== undefined && retentionDirectory !== "") {
    const sourceSha = (
      await commands.exec("git", ["rev-parse", "HEAD"], { cwd: root })
    ).stdout.trim();
    retentionMetadata = createVerifiedPackageMetadata({
      sourceSha,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      platform: process.platform,
      architecture: process.arch,
      packageVersion: PRODUCT_IDENTITY.packageVersion,
      nodeVersion: process.version,
    });
    await mkdir(retentionDirectory, { recursive: true });
    await unlink(join(retentionDirectory, "manifest.json")).catch((cause) => {
      if (
        !(cause instanceof Error && "code" in cause && cause.code === "ENOENT")
      )
        throw cause;
    });
  }
  repositorySkill = await runStage("repository skill", () =>
    verifyRepositorySkill({ commands, root, workspace }),
  );
  ({ tarball } = await runStage("package archive", () =>
    verifyPackagePack({ commands, root, workspace }),
  ));
  const environmentData = await runStage("package environment", () =>
    verifyPackageEnvironment({
      root,
      workspace,
      evidenceRoot,
      referenceRoot,
    }),
  );
  const { cli, packageRunnerCli } = await runStage("package install", () =>
    verifyPackageInstall({
      commands,
      tarball,
      prefix: environmentData.prefix,
      workspace,
      environment: environmentData.environment,
    }),
  );
  update = await runStage("package update", () =>
    verifyPackageUpdate({
      commands,
      prefix: environmentData.prefix,
      packageRoot: join(
        environmentData.prefix,
        "lib",
        "node_modules",
        PRODUCT_IDENTITY.packageName,
      ),
      tarball,
      workspace,
      environment: environmentData.environment,
    }),
  );
  mcpStartup = await runStage("MCP startup", () =>
    measureMcpStartup({
      command: cli,
      args: ["mcp"],
      environment: {
        ...environmentData.environment,
      },
      policy: resolveMcpStartupBudgets(environmentData.environment),
    }),
  );
  mcpModuleLoading = await runStage("MCP module loading", () =>
    profileMcpModuleLoading({
      command: cli,
      args: ["mcp"],
      environment: {
        ...environmentData.environment,
      },
      policy: resolveMcpStartupBudgets(environmentData.environment),
      packageName: PRODUCT_IDENTITY.packageName,
    }),
  );
  const { supportedSetupHost, hopperSetupSupported } = await runStage(
    "package discovery",
    () =>
      verifyPackageDiscovery({
        commands,
        cli,
        environment: environmentData.environment,
      }),
  );
  const { artifactArchive } = await runStage("artifact and Electron CLI", () =>
    verifyPackageArtifactAndElectron({
      commands,
      cli,
      workspace,
      environment: environmentData.environment,
    }),
  );
  await runStage("managed analysis CLI", () =>
    verifyManaged({
      commands,
      cli,
      workspace,
      environment: environmentData.environment,
    }),
  );
  await runStage("unknown provider CLI", () =>
    verifyUnknownProvider({
      commands,
      cli,
      environment: environmentData.environment,
    }),
  );
  await runStage("platform CLI", () =>
    verifyPackagePlatform({
      commands,
      cli,
      environment: environmentData.environment,
    }),
  );
  await runStage("capabilities and search CLI", () =>
    verifyPackageCapabilitiesAndSearch({
      commands,
      cli,
      environment: environmentData.environment,
    }),
  );
  await runStage("evidence CLI", () =>
    verifyPackageEvidence({
      commands,
      cli,
      evidenceRoot,
      referenceRoot,
      environment: environmentData.environment,
    }),
  );
  await runStage("setup and uninstall CLI", () =>
    verifyPackageSetup({
      commands,
      cli,
      packageRunnerCli,
      environment: environmentData.environment,
      home: environmentData.home,
      npxLog: environmentData.npxLog,
      claudeConfig: environmentData.claudeConfig,
      codexConfig: environmentData.codexConfig,
      cursorConfig: environmentData.cursorConfig,
      codexTarget: environmentData.codexTarget,
      cursorTarget: environmentData.cursorTarget,
      supportedSetupHost,
      hopperSetupSupported,
      root,
    }),
  );
  const extractedDirectory = join(workspace, "extracted-plugin");
  await mkdir(extractedDirectory);
  await commands.exec("tar", ["-xzf", tarball, "-C", extractedDirectory]);
  // Codex extracts npm plugins without installing dependencies. Run the real
  // catalog/Evidence workflow from that isolated tree so npm cannot repair it.
  await runStage("extracted plugin MCP tools and evidence", () =>
    verifyPackageMcp({
      commands,
      cli: join(extractedDirectory, "package", "scripts", "rea.mjs"),
      environment: environmentData.environment,
      evidenceRoot,
      artifactArchive,
    }),
  );
  report = {
    cli: true,
    analysisCli: true,
    artifactCli: true,
    managedCli: true,
    managedReconstructionCli: true,
    managedNativeVerificationCli: true,
    managedApplicationGraphCli: true,
    evidenceCli: true,
    incurMcpCommand: PRODUCT_IDENTITY.mcpCommand,
    lifecycleScriptsRequired: false,
    doctor: "platform-appropriate",
    setup: supportedSetupHost
      ? "planned-then-idempotent"
      : "unsupported-host-rejected",
    setupPlanReadOnly: supportedSetupHost,
    existingHopperPreserved: supportedSetupHost,
    clients: supportedSetupHost ? 4 : 0,
    backupReadback: supportedSetupHost,
    failureRecovery: supportedSetupHost,
    configSymlinkLifecycle: supportedSetupHost,
    skill: supportedSetupHost,
    skillReferences: supportedSetupHost,
    repositorySkill,
    mcpTools: TOOL_CONTRACTS.length,
    mcpPrompts: prompts.names.length,
    promptCompletion: true,
    promptCompletionLifecycle: true,
    evidenceMcp: true,
    extractedPluginMcp: true,
    targetFree: true,
    targetLifecycle: true,
    boundedRegexBridge: true,
    update,
    mcpStartup,
    mcpModuleLoading,
  };
  if (retentionMetadata !== undefined) {
    retainedPackage = await retainVerifiedPackage({
      sourceTarball: tarball,
      directory: retentionDirectory,
      metadata: retentionMetadata,
    });
  }
}, [() => (commands === undefined ? releaseWorkspace() : commands.close())]);
const verifierLineage = await runStage("verifier lineage", () =>
  completeVerifierRun(verifierRun),
);
if (retainedPackage !== undefined)
  await writeVerifiedPackageManifest(
    retainedPackage.directory,
    retainedPackage.metadata,
  );
process.stdout.write(
  `${JSON.stringify({ verifier_run: verifierLineage, ...report })}\n`,
);
