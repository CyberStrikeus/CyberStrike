import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "reports every unresolved Electron path through CLI and MCP without launching",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-invalid-paths-");
    const application = join(root, "main.js");
    await writeFile(application, "module.exports = {};\n");
    const missing = {
      executable_path: join(root, "missing-electron"),
      application_path: join(root, "missing-application"),
      application_root: join(root, "missing-root"),
    };
    const requestPath = join(root, "input.json");
    await writeFile(requestPath, JSON.stringify(missing));
    const response = await cli.run({
      arguments: ["capture-electron-scenario", requestPath, "--format", "json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(response.exitCode).toBe(1);
    const expectedIssues = Object.entries(missing).map(([field, path]) => ({
      path: [field],
      reason: "invalid_value",
      message: expect.stringContaining(path),
    }));
    expect(response.json).toMatchObject({
      code: "invalid_request",
      details: { issues: expectedIssues },
    });
    expect(response.stdout).toContain("ENOENT");

    const { call } = await connectLocalToolsMcp();
    for (const [field, path] of Object.entries(missing)) {
      const result = await call("capture_electron_scenario", {
        executable_path: process.execPath,
        application_path: application,
        application_root: root,
        [field]: path,
      });
      expect(result.isError).toBe(true);
      const content = result.content.find((item) => item.type === "text");
      if (content?.type !== "text") throw new Error("Missing error response");
      expect(JSON.parse(content.text)).toMatchObject({
        error: {
          code: "invalid_request",
          details: {
            issues: [
              {
                path: [field],
                reason: "invalid_value",
                message: expect.stringContaining(path),
              },
            ],
          },
        },
      });
      expect(content.text).toContain("ENOENT");
    }
    const session = await call("binary_session", {});
    expect(session.isError, JSON.stringify(session)).not.toBe(true);
  },
);

const isWindows = process.platform === "win32";

const errorBody = (result: {
  readonly content: readonly { readonly type: string }[];
}) => {
  const content = result.content.find((item) => item.type === "text");
  if (content?.type !== "text" || !("text" in content))
    throw new Error("Missing error response");
  return JSON.parse(String(content.text));
};

const createElectronApplication = async (root: string) => {
  const application = join(root, "app");
  await mkdir(application);
  await writeFile(
    join(application, "package.json"),
    JSON.stringify({ name: "fixture", main: "main.js" }),
  );
  await writeFile(join(application, "main.js"), "");
  return application;
};

cliTest.skipIf(isWindows)(
  "rejects a non-executable Electron executable_path before launch through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-not-executable-");
    const application = await createElectronApplication(root);
    const executable = join(root, "not-an-executable.txt");
    await writeFile(executable, "plain text");
    await chmod(executable, 0o644);
    const request = {
      executable_path: executable,
      application_path: application,
      actions: [],
    };
    const requestPath = join(root, "input.json");
    await writeFile(requestPath, JSON.stringify(request));

    const response = await cli.run({
      arguments: ["capture-electron-scenario", requestPath, "--format", "json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(response.exitCode).toBe(1);
    expect(response.json).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [{ path: ["executable_path"], reason: "invalid_value" }],
      },
    });

    const { call } = await connectLocalToolsMcp();
    const result = await call("capture_electron_scenario", request);
    expect(result.isError).toBe(true);
    expect(errorBody(result)).toMatchObject({
      error: {
        code: "invalid_request",
        details: {
          issues: [{ path: ["executable_path"], reason: "invalid_value" }],
        },
      },
    });
    const session = await call("binary_session", {});
    expect(session.isError, JSON.stringify(session)).not.toBe(true);
  },
);

cliTest.skipIf(isWindows)(
  "returns a typed failure when an executable exits before Electron starts and keeps the MCP server and its Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-early-exit-");
    const application = await createElectronApplication(root);
    const executable = join(root, "exits-immediately");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o755);
    const request = {
      executable_path: executable,
      application_path: application,
      actions: [],
    };
    const requestPath = join(root, "input.json");
    await writeFile(requestPath, JSON.stringify(request));

    const response = await cli.run({
      arguments: ["capture-electron-scenario", requestPath, "--format", "json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(response.exitCode).toBe(1);
    expect(response.json).toMatchObject({
      code: "execution_failure",
      details: { operation: "capture_electron_scenario" },
    });
    expect(response.stdout).toContain("Process failed to launch");

    const { call } = await connectLocalToolsMcp();
    const analysis = await call("analyze_javascript_application", {
      input_path: application,
    });
    expect(analysis.isError, JSON.stringify(analysis)).not.toBe(true);
    const retained = async () => {
      const bundle = await call("get_evidence_bundle", {});
      expect(bundle.isError, JSON.stringify(bundle)).not.toBe(true);
      const structured = bundle.structuredContent as {
        result: { records: { evidence_id: string }[] };
      };
      return structured.result.records.map((record) => record.evidence_id);
    };
    const before = await retained();
    expect(before).toHaveLength(1);

    const result = await call("capture_electron_scenario", request);
    expect(result.isError).toBe(true);
    expect(errorBody(result)).toMatchObject({
      error: {
        code: "execution_failure",
        details: { operation: "capture_electron_scenario" },
      },
    });
    const session = await call("binary_session", {});
    expect(session.isError, JSON.stringify(session)).not.toBe(true);
    expect(await retained()).toEqual(before);
  },
  180_000,
);

cliTest(
  "rejects a file URL path field without resolving an invented local path",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-file-url-");
    const application = join(root, "main.js");
    await writeFile(application, "module.exports = {};\n");
    const response = await cli.run({
      arguments: [
        "capture-electron-scenario",
        JSON.stringify({
          executable_path: "file:///opt/electron",
          application_path: application,
        }),
        "--format",
        "json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(response.exitCode).toBe(1);
    expect(response.json).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["executable_path"],
            reason: "invalid_format",
            message: expect.stringContaining("absolute local filesystem path"),
          },
        ],
      },
    });
    expect(response.stdout).not.toContain("ENOENT");
    expect(response.stdout).not.toContain("file:/opt/electron");
  },
);
