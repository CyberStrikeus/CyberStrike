import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Cli } from "incur";
import pino from "pino";
import { expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { registerBrowserScenarioCommands } from "../../../src/cliBrowserScenarioCommands.js";
import { BROWSER_SCENARIO_START_STEP_ID } from "../../../src/domain/browserScenarioValues.js";

const serveJson = async (
  registered: ReturnType<typeof registerValidatingCli>,
  command: string,
  input: unknown,
): Promise<unknown> => {
  let stdout = "";
  await registered.cli.serve([command, JSON.stringify(input), "--json"], {
    env: {},
    stdout: (text) => {
      stdout += text;
    },
    exit: () => undefined,
  });
  expect(registered.createProvider).not.toHaveBeenCalled();
  expect(registered.readSecret).not.toHaveBeenCalled();
  return JSON.parse(stdout) as unknown;
};

/** Register only the scenario commands, with a provider that must never run. */
const registerValidatingCli = () => {
  const cli = Cli.create("rea-scenario-validation-test", { sync: false });
  const createProvider = vi.fn((): never => {
    throw new Error("validation must not construct a browser provider");
  });
  const readSecret = vi.fn((): never => {
    throw new Error("validation must not resolve secret environment values");
  });
  const environment = Object.defineProperty({}, "SESSION_TOKEN", {
    enumerable: true,
    get: readSecret,
  });
  registerBrowserScenarioCommands(cli, pino({ level: "silent" }), environment, {
    createProvider,
  });
  return { cli, createProvider, readSecret };
};

const launchScenario = {
  browser: { mode: "launch", executable_path: "browser" },
  start_url: { url: "http://127.0.0.1:3000" },
  actions: [{ step_id: "settle", action: "wait_for_timeout", duration_ms: 1 }],
} as const;

it("accepts a valid scenario without launching or attaching to a browser", async () => {
  const output = await serveJson(
    registerValidatingCli(),
    "validate-browser-scenario",
    launchScenario,
  );
  expect(output).toEqual({ valid: true, actions: 1, secrets: 0 });
});

it.each(["validate-browser-scenario", "capture-browser-scenario"])(
  "%s rejects a literal Basic username containing a colon before creating a provider",
  async (command) => {
    const output = await serveJson(registerValidatingCli(), command, {
      ...launchScenario,
      actions: [
        {
          step_id: "authenticate",
          action: "request",
          method: "GET",
          path: "/api",
          headers: [
            {
              name: "Authorization",
              value: {
                source: "basic_credentials",
                parts: [
                  { source: "literal", value: "ops:admin" },
                  { source: "literal", value: "" },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(output).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          expect.objectContaining({
            path: ["actions", 0, "headers", 0, "value", "parts", 0, "value"],
            message: expect.stringContaining(
              "Basic username cannot contain a colon",
            ),
          }),
        ],
      },
    });
  },
);

it("counts declared secrets without resolving their environment values", async () => {
  const cli = registerValidatingCli();
  const output = await serveJson(cli, "validate-browser-scenario", {
    ...launchScenario,
    actions: [
      {
        step_id: "sign-in",
        action: "fill",
        locator: { kind: "css", selector: "#token" },
        value: { source: "secret", secret_id: "session_token" },
      },
    ],
    secrets: [
      { secret_id: "session_token", environment_variable: "SESSION_TOKEN" },
      { secret_id: "api_key", environment_variable: "API_KEY" },
    ],
  });
  expect(output).toEqual({ valid: true, actions: 1, secrets: 2 });
});

it("rejects a duplicate action step identity with the offending field path", async () => {
  const output = await serveJson(
    registerValidatingCli(),
    "validate-browser-scenario",
    {
      ...launchScenario,
      actions: [
        { step_id: "settle", action: "wait_for_timeout", duration_ms: 1 },
        { step_id: "settle", action: "wait_for_timeout", duration_ms: 2 },
      ],
    },
  );
  expect(output).toMatchObject({
    error: "Browser scenario validation failed",
    code: "invalid_request",
    category: "invalid_input",
    details: {
      issues: [
        expect.objectContaining({
          path: ["actions"],
          reason: "invalid_value",
          message: "Action step IDs must be unique",
        }),
      ],
    },
  });
});

it("rejects an action that reuses the reserved initial step identity", async () => {
  const output = await serveJson(
    registerValidatingCli(),
    "validate-browser-scenario",
    {
      ...launchScenario,
      actions: [
        {
          step_id: BROWSER_SCENARIO_START_STEP_ID,
          action: "wait_for_timeout",
          duration_ms: 1,
        },
      ],
    },
  );
  expect(output).toMatchObject({
    error: "Browser scenario validation failed",
    code: "invalid_request",
    category: "invalid_input",
    details: {
      issues: [
        expect.objectContaining({
          path: ["actions", 0, "step_id"],
          reason: "invalid_value",
        }),
      ],
    },
  });
});

it("rejects an undeclared secret reference without exposing any secret value", async () => {
  const cli = registerValidatingCli();
  const output = await serveJson(cli, "validate-browser-scenario", {
    ...launchScenario,
    actions: [
      {
        step_id: "sign-in",
        action: "fill",
        locator: { kind: "css", selector: "#token" },
        value: { source: "secret", secret_id: "session_token" },
      },
    ],
  });
  const serialized = JSON.stringify(output);
  expect(output).toMatchObject({
    error: "Browser scenario validation failed",
    code: "invalid_request",
    category: "invalid_input",
    details: {
      issues: [
        expect.objectContaining({
          path: ["secrets"],
          reason: "invalid_value",
          message: expect.stringContaining("session_token"),
        }),
      ],
    },
  });
  // The declaration is reported by identity only; no environment variable name
  // or resolved value belongs in a validation reply.
  expect(serialized).not.toContain("SESSION_TOKEN");
  expect(serialized).not.toContain("environment_variable");
});

it("rejects an unknown field instead of ignoring it", async () => {
  const output = await serveJson(
    registerValidatingCli(),
    "validate-browser-scenario",
    {
      ...launchScenario,
      navigation: { timeout_ms: 5 },
    },
  );
  expect(output).toMatchObject({
    error: "Browser scenario validation failed",
    code: "invalid_request",
    category: "invalid_input",
    details: {
      issues: [
        expect.objectContaining({
          path: ["navigation"],
          reason: "unknown_argument",
        }),
      ],
    },
  });
});

it("rejects a scenario whose input file cannot be read", async () => {
  const cli = registerValidatingCli();
  let stdout = "";
  await cli.cli.serve(
    ["validate-browser-scenario", "missing-scenario.json", "--json"],
    {
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      exit: () => undefined,
    },
  );
  expect(cli.createProvider).not.toHaveBeenCalled();
  expect(cli.readSecret).not.toHaveBeenCalled();
  expect(JSON.parse(stdout) as unknown).toMatchObject({
    input_path: "missing-scenario.json",
    input_reason: "read-failed",
  });
});

it("accepts a disconnected CDP target without constructing a provider", async () => {
  expect(
    await serveJson(registerValidatingCli(), "validate-browser-scenario", {
      ...launchScenario,
      browser: {
        mode: "connect",
        cdp_endpoint: "http://127.0.0.1:1",
        target_id: "unavailable-target",
      },
    }),
  ).toEqual({ valid: true, actions: 1, secrets: 0 });
});

it.each([
  [
    { secret_id: "token", environment_variable: "FIRST" },
    { secret_id: "token", environment_variable: "SECOND" },
  ],
  [
    { secret_id: "first", environment_variable: "SAME" },
    { secret_id: "second", environment_variable: "SAME" },
  ],
])(
  "rejects duplicate secret identities or environment references (%j)",
  async (first, second) => {
    expect(
      await serveJson(registerValidatingCli(), "validate-browser-scenario", {
        ...launchScenario,
        secrets: [first, second],
      }),
    ).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          expect.objectContaining({
            path: ["secrets"],
            reason: "invalid_value",
          }),
        ],
      },
    });
  },
);

const savedSteps = [
  {
    step_id: "create",
    action: "request",
    method: "POST",
    path: "/api/items",
    json: { title: "test" },
    save: [{ name: "id", json_pointer: "/id" }],
  },
  {
    step_id: "read",
    action: "request",
    method: "GET",
    path: "/api/items/{saved:id}",
  },
];
it("accepts saved response references only after their producing step", async () => {
  const valid = { ...launchScenario, actions: savedSteps };
  expect(
    await serveJson(
      registerValidatingCli(),
      "validate-browser-scenario",
      valid,
    ),
  ).toEqual({ valid: true, actions: 2, secrets: 0 });
  expect(
    await serveJson(registerValidatingCli(), "validate-browser-scenario", {
      ...valid,
      actions: [...savedSteps].reverse(),
    }),
  ).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [
        expect.objectContaining({
          path: ["actions", 0],
          message: expect.stringContaining("no earlier step saves"),
        }),
      ],
    },
  });
});

cliTest.for(["launch", "connect"] as const)(
  "validates %s through the public CLI while runtime resources are unavailable",
  async (mode, { cli }) => {
    const result = await cli.run({
      arguments: [
        "validate-browser-scenario",
        JSON.stringify({
          ...launchScenario,
          browser:
            mode === "launch"
              ? { mode, executable_path: "/nonexistent/rea-validation-browser" }
              : {
                  mode,
                  cdp_endpoint: "http://127.0.0.1:1",
                  target_id: "not-attached",
                },
          secrets: [
            {
              secret_id: "session_token",
              environment_variable: "SESSION_TOKEN",
            },
          ],
        }),
        "--json",
      ],
      environment: {
        REA_LOG_LEVEL: "silent",
        SESSION_TOKEN: "validation-unread-secret",
      },
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.json).toEqual({ valid: true, actions: 1, secrets: 1 });
    expect(result.stdout).not.toContain("validation-unread-secret");
  },
);

cliTest(
  "validates stdin and caller-relative file paths with canonical diagnostics",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-scenario-validation-");
    const input = JSON.stringify(launchScenario);
    await writeFile(join(root, "valid.json"), input);
    await writeFile(
      join(root, "invalid.json"),
      JSON.stringify({
        ...launchScenario,
        actions: [...launchScenario.actions, ...launchScenario.actions],
      }),
    );
    await writeFile(join(root, "malformed.json"), '{"private-value":');
    for (const arguments_ of [
      ["validate-browser-scenario", "valid.json", "--json"],
      ["validate-browser-scenario", "-", "--json"],
    ]) {
      const result = await cli.run({
        arguments: arguments_,
        cwd: root,
        ...(arguments_[1] === "-" ? { input } : {}),
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.json).toEqual({ valid: true, actions: 1, secrets: 0 });
    }
    const rejected = await cli.run({
      arguments: ["validate-browser-scenario", "invalid.json", "--json"],
      cwd: root,
    });
    expect(rejected.exitCode).toBe(1);
    expect(rejected.json).toMatchObject({
      error: "Browser scenario validation failed",
      code: "invalid_request",
      details: {
        issues: [
          expect.objectContaining({
            path: ["actions"],
            message: "Action step IDs must be unique",
          }),
        ],
      },
    });
    const malformed = await cli.run({
      arguments: ["validate-browser-scenario", "malformed.json", "--json"],
      cwd: root,
    });
    expect(malformed.exitCode).toBe(1);
    expect(malformed.json).toMatchObject({
      code: "invalid_request",
      input_path: "malformed.json",
      input_reason: "invalid-json",
    });
    expect(malformed.stdout).not.toContain("private-value");
  },
);
