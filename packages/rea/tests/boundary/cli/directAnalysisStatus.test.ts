import { createCatalogIdentity } from "../../../src/catalogIdentity.js";
import { contractsForToolFamilies } from "../../../src/contracts/toolFamilies.js";
import { promptsForToolFamilies } from "../../../src/contracts/promptToolFamilyScope.js";
import { Cli } from "incur";
import { expect, it, vi } from "vitest";
import { runSessionStatus } from "../../../src/application/DirectAnalysisStatus.js";
import { registerUtilityCommands } from "../../../src/cli/utilityCommands.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { isCliOperationFailure } from "../../../src/cliLogging.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { err, ok } from "../../../src/domain/result.js";
import { silentLogger } from "../../../src/logger.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { observed } from "../../fixtures/analysisExecution.js";

const createStatusSession = () =>
  createTestBinarySession(() => ({
    close: async () => ok(null),
    execute: async () => observed(null),
  }));

it.each(["capabilities", "providers"])(
  "reports failed %s finalization with the completed status",
  async (command) => {
    const session = createStatusSession();
    const cleanup = new ProviderCleanupError(
      "fixture",
      ["retained profile reader"],
      { reason: "profile reader close failed" },
      { remediationAction: "Retry the retained profile reader cleanup." },
    );
    const close = vi
      .spyOn(session, "close")
      .mockResolvedValueOnce(err(cleanup));
    const cli = Cli.create({ name: "rea" });
    registerUtilityCommands(
      cli,
      silentLogger,
      {},
      {
        runSessionStatus: () =>
          runSessionStatus({
            readConfiguration: () => parseConfig({}),
            createBinarySession: () => session,
          }),
        runProviderAnalysis: async () => ({ ok: false, error: null }),
      },
    );
    let stdout = "";
    try {
      await cli.serve([command, "--json"], {
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        exit: () => {},
      });
      const output: unknown = JSON.parse(stdout);
      expect(output).toMatchObject({
        code: "cleanup_incomplete",
        remediation: { action: "Retry the retained profile reader cleanup." },
        details: {
          resources: ["retained profile reader"],
          partial_observation: {
            capabilities: expect.any(Array),
            server_identity: expect.any(Object),
          },
        },
      });
      expect(isCliOperationFailure(output)).toBe(true);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      close.mockRestore();
      await session.close();
    }
  },
);

it.each([false, true])(
  "keeps status failure when final cleanup also fails: %s",
  async (cleanupFails) => {
    const session = createStatusSession();
    const failure = new Error("status observation failed");
    const cleanup = new ProviderCleanupError("fixture", ["reader"], {});
    const status = vi.spyOn(session, "status").mockRejectedValueOnce(failure);
    const close = vi
      .spyOn(session, "close")
      .mockResolvedValueOnce(cleanupFails ? err(cleanup) : ok(null));
    try {
      const result = runSessionStatus({
        readConfiguration: () => parseConfig({}),
        createBinarySession: () => session,
      });
      if (cleanupFails)
        await expect(result).rejects.toMatchObject({
          cause: failure,
          errors: [failure, cleanup],
        });
      else await expect(result).rejects.toBe(failure);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      status.mockRestore();
      close.mockRestore();
      await session.close();
    }
  },
);

it.each(["capabilities", "providers"])(
  "reports the configured family scope through %s",
  async (command) => {
    const session = createStatusSession();
    const families = new Set(["session"]);
    const expected = createCatalogIdentity({
      contracts: contractsForToolFamilies(families),
      promptContracts: promptsForToolFamilies(families),
      outputSchemaProfile: "compact",
    });
    const cli = Cli.create({ name: "rea" });
    registerUtilityCommands(
      cli,
      silentLogger,
      {},
      {
        runSessionStatus: () =>
          runSessionStatus({
            readConfiguration: () =>
              parseConfig({
                REA_MCP_TOOL_FAMILIES: " session,session ",
                REA_MCP_INPUT_SCHEMA_PROFILE: "full",
                REA_MCP_OUTPUT_SCHEMA_PROFILE: "compact",
              }),
            createBinarySession: () => session,
          }),
        runProviderAnalysis: async () => ({ ok: false, error: null }),
      },
    );
    let stdout = "";
    await cli.serve([command, "--json"], {
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      exit: () => {},
    });
    expect(JSON.parse(stdout)).toMatchObject({
      server_identity: { catalog: expected },
    });
  },
);
