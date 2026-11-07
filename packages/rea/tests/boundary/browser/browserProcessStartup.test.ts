import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  processTest as it,
  waitForExit,
} from "../../support/process/processFixture.js";

import {
  BROWSER_DEVTOOLS_STARTUP_TIMEOUT_MS,
  BrowserStartupError,
  waitForBrowserDevtoolsPort,
} from "../../../scripts/lib/browser-process-startup.mjs";
import { assertOrdinaryWindowsVerifierCaller } from "../../../scripts/lib/windows-ordinary-user-verifier.mjs";

describe("browser process startup", () => {
  it("requires a positively observed ordinary Windows verifier caller", () => {
    expect(() =>
      assertOrdinaryWindowsVerifierCaller({
        administrator: false,
        elevated: false,
        integrityLevel: 8192,
      }),
    ).not.toThrow();

    for (const token of [
      { administrator: true, elevated: false },
      { administrator: false, elevated: true },
      { administrator: false },
      { administrator: false, elevated: null },
      null,
    ]) {
      expect(() => assertOrdinaryWindowsVerifierCaller(token)).toThrow(
        /ordinary, non-elevated user token/u,
      );
    }
  });

  it("returns a delayed valid DevToolsActivePort", async ({ processes }) => {
    const root = await temporaryRoot();
    const portPath = join(root, "DevToolsActivePort");
    const child = processes.spawn(process.execPath, [
      "-e",
      `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(portPath)}, "43117\\n/browser"), 20); setTimeout(() => {}, 1000)`,
    ]);
    try {
      await expect(
        waitForBrowserDevtoolsPort({
          child,
          executable: process.execPath,
          activePortPath: portPath,
          stderr: () => "",
          timeoutMs: 1_000,
          pollIntervalMs: 5,
        }),
      ).resolves.toBe(43_117);
    } finally {
      child.kill("SIGKILL");
      expect(await waitForExit(child, 5_000)).toBe(true);
    }
  });

  it("classifies signal termination instead of timing out", async ({
    processes,
  }) => {
    const root = await temporaryRoot();
    const child = processes.spawn(process.execPath, [
      "-e",
      "process.kill(process.pid, 'SIGTERM')",
    ]);

    const failure = await waitForBrowserDevtoolsPort({
      child,
      executable: process.execPath,
      activePortPath: join(root, "DevToolsActivePort"),
      stderr: () => "signal fixture",
      timeoutMs: 1_000,
      pollIntervalMs: 5,
    }).catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(BrowserStartupError);
    expect(failure).toMatchObject({
      failure: "signalled",
      exitCode: null,
      signalCode: "SIGTERM",
      stderr: "signal fixture",
    });
  });

  it("reports bounded timeout diagnostics", async ({ processes }) => {
    const root = await temporaryRoot();
    const child = processes.spawn(process.execPath, [
      "-e",
      "setTimeout(() => {}, 1000)",
    ]);
    try {
      const failure = await waitForBrowserDevtoolsPort({
        child,
        executable: process.execPath,
        activePortPath: join(root, "DevToolsActivePort"),
        stderr: () => "",
        timeoutMs: 20,
        pollIntervalMs: 5,
      }).catch((cause: unknown) => cause);

      expect(failure).toBeInstanceOf(BrowserStartupError);
      expect(failure).toMatchObject({
        failure: "timeout",
        exitCode: null,
        signalCode: null,
        startupTimeoutMs: 20,
      });
      expect(String(failure)).toContain("stderr=<empty>");
      expect(String(failure)).toContain("timeoutMs=20");
    } finally {
      child.kill("SIGKILL");
      expect(await waitForExit(child, 5_000)).toBe(true);
    }
  });

  it("names the owner's deadline when a caller omits one", async ({
    processes,
  }) => {
    const root = await temporaryRoot();
    const child = processes.spawn(process.execPath, [
      "-e",
      "setTimeout(() => process.exit(3), 10)",
    ]);

    const failure = await waitForBrowserDevtoolsPort({
      child,
      executable: process.execPath,
      activePortPath: join(root, "DevToolsActivePort"),
      stderr: () => "owner default fixture",
      pollIntervalMs: 5,
    }).catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(BrowserStartupError);
    expect(failure).toMatchObject({
      failure: "exited",
      startupTimeoutMs: BROWSER_DEVTOOLS_STARTUP_TIMEOUT_MS,
    });
    expect(String(failure)).toContain(
      `timeoutMs=${String(BROWSER_DEVTOOLS_STARTUP_TIMEOUT_MS)}`,
    );
  });

  it("keeps one owner for the DevToolsActivePort deadline", async () => {
    expect(BROWSER_DEVTOOLS_STARTUP_TIMEOUT_MS).toBe(60_000);
    const source = await readFile(
      new URL(
        "../../../scripts/lib/browser-runtime-fixture-lifecycle.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain(
      "const deadline = performance.now() + BROWSER_DEVTOOLS_STARTUP_TIMEOUT_MS",
    );
    expect(source).toContain(
      "timeoutMs: Math.max(1, deadline - performance.now())",
    );
  });
});

const temporaryRoot = async (): Promise<string> => {
  return createTestTempDirectory("rea-browser-startup-");
};
