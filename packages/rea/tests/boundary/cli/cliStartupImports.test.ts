import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);
const MARKER = "REA_TEST_RESOLVED ";
// Dependencies and composition modules used by one command family; startup
// must not resolve them just to register the complete command catalog.
const DEFERRED_IMPORTS = [
  {
    name: "guided-workflows",
    path: "/dist/application/GuidedWorkflowAccess.js",
  },
  {
    name: "direct-analysis",
    path: "/dist/application/DirectAnalysis.js",
  },
  {
    name: "direct-analysis-status",
    path: "/dist/application/DirectAnalysisStatus.js",
  },
  {
    name: "doctor",
    path: "/dist/application/Doctor.js",
  },
  {
    name: "doctor-runtime",
    path: "/dist/doctorRuntime.js",
  },
  {
    name: "setup",
    path: "/dist/application/Setup.js",
  },
  {
    name: "setup-host",
    path: "/dist/application/SetupHost.js",
  },
  {
    name: "uninstall",
    path: "/dist/application/Uninstall.js",
  },
  {
    name: "update",
    path: "/dist/application/Update.js",
  },
  {
    name: "update-runtime",
    path: "/dist/application/UpdateRuntime.js",
  },
  {
    name: "catalog-identity",
    path: "/dist/catalogIdentity.js",
  },
  {
    name: "server-identity",
    path: "/dist/serverIdentity.js",
  },
  {
    name: "tool-contracts",
    path: "/dist/contracts/toolContracts.js",
  },
  {
    name: "playwright-core",
    path: "/node_modules/playwright-core/",
  },
  {
    name: "isomorphic-git",
    path: "/node_modules/isomorphic-git/",
  },
  {
    name: "binary-composition",
    path: "/dist/composition/binary.js",
  },
  {
    name: "javascript-application",
    path: "/dist/application/javascript/JavaScriptApplicationService.js",
  },
  {
    name: "javascript-workflows",
    path: "/dist/application/javascript/JavaScriptApplicationWorkflowService.js",
  },
  {
    name: "javascript-semantic-trace",
    path: "/dist/application/javascript/JavaScriptSemanticTraceService.js",
  },
  {
    name: "electron-observation",
    path: "/dist/application/javascript/ElectronObservationService.js",
  },
  {
    name: "electron-active-observation",
    path: "/dist/application/javascript/ElectronActiveObservationService.js",
  },
  {
    name: "javascript-runtime-reconciliation",
    path: "/dist/application/javascript/JavaScriptRuntimeReconciliationService.js",
  },
  {
    name: "android-application",
    path: "/dist/application/android/AndroidApplicationService.js",
  },
  {
    name: "apple-application",
    path: "/dist/application/apple/AppleApplicationService.js",
  },
  {
    name: "reconstruction-coverage",
    path: "/dist/application/ReconstructionCoverageService.js",
  },
  {
    name: "reconstruction-obligation-ledger",
    path: "/dist/application/ReconstructionObligationLedgerService.js",
  },
  {
    name: "environment-source",
    path: "/dist/application/environment/environmentSource.js",
  },
  {
    name: "environment-export",
    path: "/dist/application/environment/environmentExport.js",
  },
  {
    name: "environment-server",
    path: "/dist/server/environment/serveEnvironment.js",
  },
] as const;
// Report each resolved deferred package on stderr without changing resolution.
const RESOLUTION_HOOK = `data:text/javascript,${encodeURIComponent(`
import { registerHooks } from "node:module";
const imports = ${JSON.stringify(DEFERRED_IMPORTS)};
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    const name = imports.find((item) =>
      resolved.url.includes(item.path) ||
      (item.path.startsWith("/dist/") && item.path.endsWith(".js") &&
       resolved.url.includes("/dist/cli-runtime/" + item.path.slice(6, -3).split("/").join("__") + "-")),
    );
    if (name !== undefined)
      process.stderr.write(${JSON.stringify(MARKER)} + name.name + "\\n");
    return resolved;
  },
});
`)}`;

const resolvedMarkers = (stderr: string): ReadonlySet<string> =>
  new Set(
    stderr
      .split("\n")
      .filter((line) => line.startsWith(MARKER))
      .map((line) => line.slice(MARKER.length)),
  );

const resolvedPackages = async (
  arguments_: readonly string[],
): Promise<ReadonlySet<string>> => {
  const { stderr } = await execute(
    process.execPath,
    [`--import=${RESOLUTION_HOOK}`, ...arguments_],
    { cwd: process.cwd(), maxBuffer: 16 * 1_024 * 1_024 },
  );
  return resolvedMarkers(stderr);
};

const evaluate = (source: string): readonly string[] => [
  "--input-type=module",
  "--eval",
  source,
];

describe("CLI startup imports", () => {
  it("detects each deferred package when its command code loads", async () => {
    await expect(
      resolvedPackages(
        evaluate(
          'await import("./dist/application/environment/environmentSource.js");',
        ),
      ),
    ).resolves.toContain("environment-source");
    await expect(
      resolvedPackages(
        evaluate(
          'await import("./dist/application/environment/environmentExport.js");',
        ),
      ),
    ).resolves.toContain("environment-export");
    const missingBrowser = join(
      await createTestTempDirectory("rea-startup-browser-"),
      "missing-browser",
    );
    const scenario = {
      browser: { mode: "launch", executable_path: missingBrowser },
      environment: { viewport: { width: 1, height: 1 } },
    };
    await expect(
      resolvedPackages(
        evaluate(
          `const { openPlaywrightScenarioBrowser } = await import("./dist/browser/PlaywrightScenarioBrowser.js"); await openPlaywrightScenarioBrowser(${JSON.stringify(scenario)}, {}).catch(() => undefined);`,
        ),
      ),
    ).resolves.toContain("playwright-core");
    const source = await createTestTempDirectory("rea-startup-imports-");
    await mkdir(join(source, ".git"));
    await expect(
      resolvedPackages(
        evaluate(
          `const { readReferenceSourceVcs } = await import("./dist/application/ReferenceSourceVcsAdapter.js"); const { ArtifactResourceScope } = await import("./dist/artifacts/ArtifactResourceScope.js"); const resources = new ArtifactResourceScope(); try { await readReferenceSourceVcs(${JSON.stringify(source)}, resources); } finally { await resources.close(); }`,
        ),
      ),
    ).resolves.toContain("isomorphic-git");
  });

  it("does not load command-specific code to register the command catalog", async () => {
    await expect(
      resolvedPackages(["scripts/rea.mjs", "--help"]),
    ).resolves.toEqual(new Set());
    await expect(
      resolvedPackages(evaluate('await import("./dist/cli.js");')),
    ).resolves.toEqual(new Set());
  });

  it("renders guidance without loading the tool catalog or provider composition", async () => {
    await expect(
      resolvedPackages([
        "scripts/rea.mjs",
        "guided-workflows",
        "--action",
        "render",
        "--workflow-id",
        "investigate_feature",
        "--arguments-json",
        JSON.stringify({ feature: "offline search" }),
        "--json",
      ]),
    ).resolves.toEqual(new Set(["guided-workflows"]));
  });

  it("does not load native provider composition for JavaScript application analysis", async () => {
    const source = await createTestTempDirectory("rea-cli-js-startup-");
    await mkdir(join(source, "src"));
    await writeFile(
      join(source, "package.json"),
      JSON.stringify({
        name: "startup-fixture",
        version: "1.0.0",
        main: "src/index.js",
      }),
    );
    await writeFile(
      join(source, "src/index.js"),
      "export const answer = 42;\n",
    );

    await expect(
      resolvedPackages([
        "scripts/rea.mjs",
        "analyze-javascript-application",
        source,
        "--json",
      ]),
    ).resolves.toEqual(new Set(["javascript-application"]));
  });

  it("loads native provider composition when a provider operation is called", async () => {
    const resolved = await resolvedPackages(
      evaluate(
        'const { createDirectAnalysis } = await import("./dist/composition/directAnalysis.js"); await createDirectAnalysis({}).runSessionStatus();',
      ),
    );
    expect(resolved).toContain("binary-composition");
    expect(resolved).not.toContain("direct-analysis");
    expect(resolved).toContain("direct-analysis-status");
    expect(resolved).toContain("server-identity");
    expect(resolved).toContain("catalog-identity");
    expect(resolved).toContain("tool-contracts");
  });
});

describe("MCP startup imports", () => {
  it("initializes and lists tools over stdio with HTTP-only environment settings present", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [`--import=${RESOLUTION_HOOK}`, "scripts/rea.mjs", "mcp"],
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? "",
        MCP_HOST: " ",
        MCP_PORT: "not-a-port",
      },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const client = new Client({ name: "rea-startup-imports", version: "1" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain(
        "capture_browser_scenario",
      );
    } finally {
      await client.close();
    }
    const resolved = resolvedMarkers(stderr);
    expect(stderr).not.toContain("MCP transport listening");
    expect(resolved).not.toContain("playwright-core");
    expect(resolved).not.toContain("isomorphic-git");
  });
});
