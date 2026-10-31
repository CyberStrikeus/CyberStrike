import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import { transportError } from "../../../src/cli/environmentCommands.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { StreamableHttpListenError } from "../../../src/server/http/streamableHttpListenError.js";
import {
  writeEnvironmentServeFiles,
  type EnvironmentServeFiles,
} from "../../fixtures/environmentServe.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";

const files = async (): Promise<EnvironmentServeFiles> => {
  const directory = await createTestTempDirectory("rea-serve-remediation-");
  return writeEnvironmentServeFiles(directory);
};

const serve = async (
  cli: TestCli,
  input: EnvironmentServeFiles,
  host: string,
  port: number,
) => {
  const result = await cli.run({
    arguments: [
      "environment-serve",
      input.manifestPath,
      "--evidence",
      input.capturePath,
      "--host",
      host,
      "--port",
      String(port),
      "--json",
    ],
    timeoutMs: 30_000,
  });
  return {
    exitCode: result.exitCode,
    output: JSON.parse(result.stdout) as Record<string, unknown>,
  };
};

cliTest(
  "reports host lookup failure with host-specific recovery and no listener startup",
  async ({ cli }) => {
    const input = await files();
    const host = `rea-${randomUUID()}.invalid`;
    const result = await serve(cli, input, host, 0);

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatchObject({
      code: "resource_constraint",
      details: {
        operation: "environment-serve",
        resource: "transport",
        reported_limits: { host, port: 0 },
        diagnostics: {
          listener_failure: {
            kind: "host_lookup",
            system_code: "ENOTFOUND",
          },
        },
      },
    });
    expect(result.output.remediation).toMatchObject({
      action: expect.stringContaining("--host or MCP_HOST"),
    });
    expect(JSON.stringify(result.output)).toContain("ENOTFOUND");
    expect(JSON.stringify(result.output)).not.toContain(
      "Choose another --port",
    );
  },
);

cliTest(
  "reports the missing host allowlist instead of port advice for a non-loopback bind",
  async ({ cli }) => {
    const result = await serve(cli, await files(), "0.0.0.0", 0);
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatchObject({
      code: "resource_constraint",
      details: {
        diagnostics: {
          listener_failure: { kind: "host_allowlist", reason: "missing" },
        },
      },
      remediation: { action: expect.stringContaining("Set MCP_ALLOWED_HOSTS") },
    });
    expect(JSON.stringify(result.output.remediation)).not.toContain(
      "Choose another --port",
    );
  },
);

cliTest(
  "retains port advice without closing the loopback listener it does not own",
  async ({ cli }) => {
    const input = await files();
    const owner = createServer();
    try {
      owner.listen({ host: "127.0.0.1", port: 0 });
      await once(owner, "listening");
      const address = owner.address();
      if (address === null || typeof address === "string")
        throw new Error("Owned loopback listener has no TCP address");

      const result = await serve(cli, input, "127.0.0.1", address.port);
      expect(result.exitCode).toBe(1);
      expect(result.output).toMatchObject({
        code: "resource_constraint",
        details: {
          reported_limits: { host: "127.0.0.1", port: address.port },
          diagnostics: {
            listener_failure: {
              kind: "port_in_use",
              system_code: "EADDRINUSE",
            },
          },
        },
        remediation: {
          action: expect.stringContaining("Choose another --port or MCP_PORT"),
        },
      });
      expect(owner.listening).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        owner.close((cause) =>
          cause === undefined ? resolve() : reject(cause),
        ),
      );
    }
  },
);

it.each([
  ["EACCES", "permission_denied", "permitted to bind"],
  ["EPERM", "permission_denied", "permitted to bind"],
  ["EADDRNOTAVAIL", "host_unavailable", "address assigned to this machine"],
  ["EIO", "unclassified", "Check the selected listener host, port"],
] as const)(
  "projects typed listener failure %s without parsing the error display text",
  (systemCode, kind, remediationText) => {
    const cause = Object.assign(
      new Error(
        systemCode === "EIO"
          ? "display mentions EADDRINUSE, but errno is EIO"
          : "controlled listener failure",
      ),
      { code: systemCode },
    );
    const listenError = new StreamableHttpListenError(cause);
    const transportFailure = transportError(
      { host: "127.0.0.1", port: 80 },
      listenError,
    );
    const projected = projectAnalysisError(transportFailure);

    expect(listenError.cause).toBe(cause);
    expect(transportFailure.cause).toBe(listenError);
    expect(projected.details).toMatchObject({
      diagnostics: {
        listener_failure: {
          kind,
          system_code: systemCode,
        },
        listener_phase: "startup",
      },
    });
    expect(projected.remediation.action).toContain(remediationText);
    expect(projected.remediation.action).not.toContain(
      "stop the process using it",
    );
  },
);

it("retains an after-bind listener failure as a serving-phase error", () => {
  const cause = Object.assign(new Error("socket failed after bind"), {
    code: "EIO",
  });
  const listenError = new StreamableHttpListenError(cause, "serving");
  const projected = projectAnalysisError(
    transportError({ host: "127.0.0.1", port: 80 }, listenError),
  );

  expect(listenError.cause).toBe(cause);
  expect(listenError.message).toContain("failed after binding");
  expect(listenError.message).not.toContain("could not bind");
  expect(projected.details).toMatchObject({
    diagnostics: {
      listener_failure: { kind: "unclassified", system_code: "EIO" },
      listener_phase: "serving",
    },
  });
});
