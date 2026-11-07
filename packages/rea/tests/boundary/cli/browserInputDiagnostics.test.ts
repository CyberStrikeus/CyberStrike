import { describe, expect } from "vitest";

import { workspaceCliTest as cliTest } from "../../support/cli/workspaceCliFixture.js";

const malformedEndpoint = "not a url";
const browserEndpoint = "http://127.0.0.1:9222";
const inspectorEndpoint = "http://127.0.0.1:9229";

const invalidInputs = [
  {
    command: "list-browser-targets",
    arguments: [malformedEndpoint],
    operation: "list_browser_targets",
    error: "Browser observation failed",
    issue: {
      path: ["cdp_endpoint"],
      reason: "invalid_value",
      message: "Invalid CDP endpoint URL",
    },
  },
  {
    command: "inspect-web-page",
    arguments: [browserEndpoint, ""],
    operation: "inspect_web_page",
    error: "Browser observation failed",
    issue: { path: ["target_id"], reason: "out_of_range", minimum: 1 },
  },
  {
    command: "analyze-web-bundle",
    arguments: [malformedEndpoint, "target"],
    operation: "analyze_web_bundle",
    error: "Browser observation failed",
    issue: {
      path: ["cdp_endpoint"],
      reason: "invalid_value",
      message: "Invalid CDP endpoint URL",
    },
  },
  {
    command: "observe-web-session",
    arguments: [browserEndpoint, ""],
    operation: "observe_web_session",
    error: "Browser observation failed",
    issue: { path: ["target_id"], reason: "out_of_range", minimum: 1 },
  },
  {
    command: "list-javascript-runtime-targets",
    arguments: [""],
    operation: "list_javascript_runtime_targets",
    error: "JavaScript runtime observation failed",
    issue: {
      path: ["inspector_endpoint"],
      reason: "out_of_range",
      minimum: 1,
    },
  },
  {
    command: "observe-javascript-runtime",
    arguments: [inspectorEndpoint, ""],
    operation: "observe_javascript_runtime",
    error: "JavaScript runtime observation failed",
    issue: { path: ["target_id"], reason: "out_of_range", minimum: 1 },
  },
  {
    command: "discover-webmcp-tools",
    arguments: [malformedEndpoint, "target"],
    operation: "discover_webmcp_tools",
    error: "Browser observation failed",
    issue: {
      path: ["cdp_endpoint"],
      reason: "invalid_value",
      message: "Invalid CDP endpoint URL",
    },
  },
  {
    command: "capture-web-screenshot",
    arguments: [browserEndpoint, ""],
    operation: "capture_web_screenshot",
    error: "Browser observation failed",
    issue: { path: ["target_id"], reason: "out_of_range", minimum: 1 },
  },
] as const;

describe("inspection branch diagnostics", () => {
  cliTest.for([[], ["--include-script-sources"]])(
    "reports only the selected inspection branch's endpoint error (%j)",
    async (flags, { cli, workspace }) => {
      const result = await cli.run({
        arguments: [
          "inspect-web-page",
          malformedEndpoint,
          "target",
          ...flags,
          "--json",
        ],
        cwd: workspace.root,
        environment: { ...workspace.environment, REA_LOG_LEVEL: "silent" },
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "inspect_web_page",
          issues: [
            {
              path: ["cdp_endpoint"],
              reason: "invalid_value",
              message: "Invalid CDP endpoint URL",
            },
          ],
        },
      });
    },
  );
});

describe("browser and Inspector CLI input diagnostics", () => {
  cliTest.for(invalidInputs)(
    "$command retains the named contract's correction details",
    async (input, { cli, workspace }) => {
      const result = await cli.run({
        arguments: [input.command, ...input.arguments, "--json"],
        cwd: workspace.root,
        environment: { ...workspace.environment, REA_LOG_LEVEL: "silent" },
      });

      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        error: input.error,
        code: "invalid_request",
        category: "invalid_input",
        message:
          "Analysis input is invalid. Check the arguments and try again.",
        retryable: false,
        remediation: {
          action: `Read the declared input schema or CLI usage for ${input.operation}; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.`,
        },
        recovery: {
          kind: "inspect_input_contract",
          operation: input.operation,
        },
        details: {
          operation: input.operation,
          issues: expect.arrayContaining([input.issue]),
        },
      });
      expect(result.stdout).not.toContain(malformedEndpoint);
      expect(result.stderr).not.toContain(malformedEndpoint);
    },
  );

  cliTest.for([
    ["list-browser-targets", "cdp_endpoint"],
    ["list-javascript-runtime-targets", "inspector_endpoint"],
  ] as const)(
    "%s does not echo rejected endpoint credentials",
    async ([command, field], { cli, workspace }) => {
      const endpoint =
        "http://rea-diagnostic-user:rea-diagnostic-secret@127.0.0.1:9222/";
      const result = await cli.run({
        arguments: [command, endpoint, "--json"],
        cwd: workspace.root,
        environment: { ...workspace.environment, REA_LOG_LEVEL: "debug" },
      });

      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: [field],
              reason: "invalid_value",
              message:
                "CDP endpoint must be an explicit-port HTTP URL on 127.0.0.1 or ::1",
            },
          ],
        },
      });
      const output = result.stdout + result.stderr;
      expect(output).not.toContain(endpoint);
      expect(output).not.toContain("rea-diagnostic-user");
      expect(output).not.toContain("rea-diagnostic-secret");
    },
  );

  cliTest(
    "retains authored cross-field correction guidance",
    async ({ cli, workspace }) => {
      const result = await cli.run({
        arguments: [
          "inspect-web-page",
          browserEndpoint,
          "target",
          "--include-storage-fingerprints",
          "--json",
        ],
        cwd: workspace.root,
        environment: { ...workspace.environment, REA_LOG_LEVEL: "silent" },
      });

      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "inspect_web_page",
          issues: expect.arrayContaining([
            {
              path: ["include_storage_fingerprints"],
              reason: "invalid_value",
              message: "Storage fingerprints require storage key capture",
            },
          ]),
        },
      });
    },
  );

  cliTest(
    "retains correction details for invalid capture comparison inputs",
    async ({ cli, workspace }) => {
      const result = await cli.run({
        arguments: ["compare-web-captures", "{}", "{}", "--json"],
        cwd: workspace.root,
        environment: { ...workspace.environment, REA_LOG_LEVEL: "silent" },
      });

      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "compare_web_captures",
          issues: expect.arrayContaining([
            expect.objectContaining({ reason: expect.any(String) }),
          ]),
        },
      });
    },
  );

  cliTest(
    "preserves the parser diagnostic for an omitted endpoint",
    async ({ cli, workspace }) => {
      const result = await cli.run({
        arguments: ["list-browser-targets", "--json"],
        cwd: workspace.root,
        environment: { ...workspace.environment, REA_LOG_LEVEL: "silent" },
      });

      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "VALIDATION_ERROR",
        fieldErrors: [
          {
            path: "endpoint",
            code: "invalid_type",
            missing: true,
            expected: "string",
          },
        ],
      });
    },
  );
});
