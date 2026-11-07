import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Cli } from "incur";
import pino from "pino";
import { expect, it } from "vitest";

import type { BrowserScenarioCapturePort } from "../../../src/application/BrowserScenarioCapturePort.js";
import type { ElectronActiveObservationPort } from "../../../src/application/javascript/ElectronActiveObservationPort.js";
import { registerBrowserScenarioCommands } from "../../../src/cliBrowserScenarioCommands.js";
import { registerAnalysisViewCommands } from "../../../src/cli/analysisViewCommands.js";
import { registerElectronCommands } from "../../../src/cli/electronCommands.js";
import { AnalysisCapabilityUnavailableError } from "../../../src/domain/analysisErrorCore.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { err } from "../../../src/domain/result.js";
import {
  analysisViewJavaScriptEvidence,
  analysisViewLayoutEvidence,
} from "../../fixtures/analysisView.js";

const providerIdentity = {
  id: "test.path-boundary",
  name: "Path boundary test provider",
  version: null,
} as const;

const serveJson = async (
  cli: ReturnType<typeof Cli.create>,
  command: string,
  input: unknown,
): Promise<unknown> => {
  let stdout = "";
  await cli.serve([command, JSON.stringify(input), "--json"], {
    env: {},
    stdout: (text) => {
      stdout += text;
    },
    exit: () => undefined,
  });
  return JSON.parse(stdout) as unknown;
};

it.skipIf(process.platform === "win32")(
  "keeps caller-selected JSON paths through the public CLI and provider boundaries",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-cli-json-path-"));
    const originalCwd = process.cwd();
    const originalExitCode = process.exitCode;
    try {
      await mkdir(join(root, "real/inner"), { recursive: true });
      await mkdir(join(root, "real/app"), { recursive: true });
      await mkdir(join(root, "real/root"), { recursive: true });
      await mkdir(join(root, "app"), { recursive: true });
      await mkdir(join(root, "root"), { recursive: true });
      await writeFile(join(root, "real/tool"), "selected executable");
      await writeFile(join(root, "tool"), "lexical sibling");
      await chmod(join(root, "real/tool"), 0o700);
      await chmod(join(root, "tool"), 0o700);
      await symlink(join(root, "real/inner"), join(root, "link"));
      process.chdir(root);

      const electronInputs: string[][] = [];
      const electronProvider: ElectronActiveObservationPort = {
        identity: () => providerIdentity,
        capture: async (input) => {
          electronInputs.push([
            input.executable_path,
            input.application_path,
            input.application_root,
          ]);
          return err(
            new AnalysisCapabilityUnavailableError(
              providerIdentity.id,
              "capture_electron_scenario",
              "intentional inert test provider",
            ),
          );
        },
        close: async () => undefined,
      };
      const electronCli = Cli.create("rea-path-electron-test", {
        sync: false,
      });
      registerElectronCommands(
        electronCli,
        pino({ level: "silent" }),
        {},
        {
          createActiveProvider: () => electronProvider,
        },
      );
      for (const path of ["link/../", `${root}/link/../`]) {
        const output = await serveJson(
          electronCli,
          "capture-electron-scenario",
          {
            executable_path: `${path}tool`,
            application_path: `${path}app`,
            application_root: `${path}root`,
            actions: [],
          },
        );
        expect(output).toMatchObject({ code: "capability_unavailable" });
      }
      const expectedElectronPaths = [
        await realpath(join(root, "real/tool")),
        await realpath(join(root, "real/app")),
        await realpath(join(root, "real/root")),
      ];
      expect(electronInputs).toEqual([
        expectedElectronPaths,
        expectedElectronPaths,
      ]);

      const browserInputs: string[] = [];
      const browserProvider: BrowserScenarioCapturePort = {
        identity: () => providerIdentity,
        captureScenario: async (scenario) => {
          if (scenario.browser.mode === "launch")
            browserInputs.push(scenario.browser.executable_path);
          return err(
            new AnalysisCapabilityUnavailableError(
              providerIdentity.id,
              "capture_browser_scenario",
              "intentional inert test provider",
            ),
          );
        },
        close: async () => undefined,
      };
      const browserCli = Cli.create("rea-path-browser-test", {
        sync: false,
      });
      registerBrowserScenarioCommands(
        browserCli,
        pino({ level: "silent" }),
        {},
        { createProvider: () => browserProvider },
      );
      for (const executablePath of [
        "link/../browser",
        `${root}/link/../browser`,
      ]) {
        const output = await serveJson(browserCli, "capture-browser-scenario", {
          browser: { mode: "launch", executable_path: executablePath },
          start_url: { url: "https://example.test" },
          actions: [
            {
              step_id: "settle",
              action: "wait_for_timeout",
              duration_ms: 1,
            },
          ],
        });
        expect(output).toMatchObject({ code: "capability_unavailable" });
      }
      expect(browserInputs).toEqual([
        `${root}/link/../browser`,
        `${root}/link/../browser`,
      ]);
    } finally {
      process.chdir(originalCwd);
      process.exitCode = originalExitCode;
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "reads the caller-selected Evidence file through the registered CLI",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-cli-evidence-path-"));
    const originalCwd = process.cwd();
    const originalExitCode = process.exitCode;
    try {
      await mkdir(join(root, "real/inner"), { recursive: true });
      await symlink(join(root, "real/inner"), join(root, "link"));
      process.chdir(root);
      const selectedEvidence = analysisViewLayoutEvidence();
      const siblingEvidence = analysisViewJavaScriptEvidence();
      await mkdir(join(root, "real"), { recursive: true });
      await writeFile(
        join(root, "real/evidence.json"),
        JSON.stringify(selectedEvidence),
      );
      await writeFile(
        join(root, "evidence.json"),
        JSON.stringify(siblingEvidence),
      );
      expect(
        parseEvidence(
          JSON.parse(await readFile(`${root}/link/../evidence.json`, "utf8")),
        ).evidence_id,
      ).toBe(selectedEvidence.evidence_id);
      const analysisViewCli = Cli.create("rea-path-evidence-test", {
        sync: false,
      });
      registerAnalysisViewCommands(analysisViewCli, pino({ level: "silent" }));
      for (const path of [
        "link/../evidence.json",
        `${root}/link/../evidence.json`,
      ]) {
        const output = parseEvidence(
          await serveJson(analysisViewCli, "inspect-analysis-view", {
            source: { kind: "evidence-file", path },
            view: { kind: "summary" },
          }),
        );
        expect(output.parameters.parent_evidence_id, path).toBe(
          selectedEvidence.evidence_id,
        );
        expect(output.evidence_links, path).toEqual([
          selectedEvidence.evidence_id,
        ]);
      }
    } finally {
      process.chdir(originalCwd);
      process.exitCode = originalExitCode;
      await rm(root, { recursive: true, force: true });
    }
  },
);
