import { describe, expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import * as boundedCommands from "../process/ExecFileBoundedOutput.js";
import { err, ok } from "../domain/result.js";
import * as pythonRuntime from "./LinuxHopperPython.js";
import {
  linuxHopperInstallDisclosure,
  linuxPackageManagerCommands,
  systemLinuxHopperInstallHost,
} from "./LinuxHopper.js";

/** Package transactions that install Hopper before any runtime library repair. */
const debCommands = linuxPackageManagerCommands(
  "deb",
  "/tmp/verified-hopper.deb",
  false,
).length;

const missingPython = {
  interpreter: "/usr/bin/python3",
  version: [3, 14],
  library: {
    status: "unavailable",
    path: "/usr/lib/x86_64-linux-gnu/libpython3.14.so.1.0",
    reason: "No such file",
  },
} satisfies pythonRuntime.LinuxHopperPythonRuntime;
const readyPython = {
  ...missingPython,
  library: {
    status: "loadable",
    path: "/usr/lib/x86_64-linux-gnu/libpython3.14.so.1.0",
  },
} satisfies pythonRuntime.LinuxHopperPythonRuntime;
const commandSuccess = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  outputTruncated: false,
};

describe("Linux Hopper package runtime", () => {
  it.each([
    {
      name: "installs and verifies the matching future Python library",
      inspections: [ok(missingPython), ok(readyPython)],
      packageCalls: debCommands + 1,
      status: "installed",
    },
    {
      name: "skips the extra APT command for an already loadable library",
      inspections: [ok(readyPython)],
      packageCalls: debCommands,
      status: "installed",
    },
    {
      name: "does not guess a package for an unknown library location",
      inspections: [
        ok({
          ...missingPython,
          library: { status: "unknown", reason: "No INSTSONAME" },
        } satisfies pythonRuntime.LinuxHopperPythonRuntime),
      ],
      packageCalls: debCommands,
      status: "runtime_unavailable",
    },
    {
      name: "rejects APT success when the library still cannot load",
      inspections: [ok(missingPython), ok(missingPython)],
      packageCalls: debCommands + 1,
      status: "runtime_unavailable",
    },
    {
      name: "preserves an interpreter inspection failure",
      inspections: [
        err(
          new pythonRuntime.LinuxHopperPythonError(
            "query_failed",
            "Fixture interpreter unavailable",
          ),
        ),
      ],
      packageCalls: debCommands,
      status: "runtime_unavailable",
    },
  ])("$name", async ({ inspections, packageCalls, status }) => {
    const directory = await createTestTempDirectory(
      "rea-linux-python-install-",
    );
    const host = systemLinuxHopperInstallHost(
      { XDG_CACHE_HOME: directory },
      async () => undefined,
    );
    const command = vi
      .spyOn(boundedCommands, "execFileBoundedOutput")
      .mockResolvedValue(commandSuccess);
    const inspect = vi
      .spyOn(pythonRuntime, "inspectLinuxHopperPythonRuntime")
      .mockRejectedValue(new Error("Unexpected extra Python inspection"));
    for (const result of inspections) inspect.mockResolvedValueOnce(result);
    try {
      expect(
        await host.installPackage("deb", "/tmp/verified-hopper.deb"),
      ).toMatchObject({ status });
      expect(command).toHaveBeenCalledTimes(packageCalls);
      expect(inspect).toHaveBeenCalledTimes(inspections.length);
      if (packageCalls > debCommands) {
        const isRoot = process.getuid?.() === 0;
        expect(command.mock.calls[debCommands]?.slice(0, 2)).toEqual([
          isRoot ? "apt-get" : "pkexec",
          [...(isRoot ? [] : ["apt-get"]), "install", "-y", "libpython3.14"],
        ]);
      }
    } finally {
      try {
        await host.close?.();
      } finally {
        inspect.mockRestore();
        command.mockRestore();
      }
    }
  });

  it("preserves a failed runtime APT command and does not verify it as installed", async () => {
    const directory = await createTestTempDirectory(
      "rea-linux-python-failure-",
    );
    const host = systemLinuxHopperInstallHost(
      { XDG_CACHE_HOME: directory },
      async () => undefined,
    );
    const failed = {
      exitCode: 67,
      stdout: "original package output",
      stderr: "original package error",
      outputTruncated: true,
    };
    const command = vi.spyOn(boundedCommands, "execFileBoundedOutput");
    for (let index = 0; index < debCommands; index++)
      command.mockResolvedValueOnce(commandSuccess);
    command.mockResolvedValueOnce(failed);
    const inspect = vi
      .spyOn(pythonRuntime, "inspectLinuxHopperPythonRuntime")
      .mockResolvedValue(ok(missingPython));
    try {
      expect(
        await host.installPackage("deb", "/tmp/verified-hopper.deb"),
      ).toMatchObject({ status: "failed", failure: failed });
      expect(command).toHaveBeenCalledTimes(debCommands + 1);
      expect(inspect).toHaveBeenCalledTimes(1);
    } finally {
      try {
        await host.close?.();
      } finally {
        inspect.mockRestore();
        command.mockRestore();
      }
    }
  });
});

describe("Linux Hopper package mapping", () => {
  it.each([
    "/custom/libpython3.14.so.1.0",
    "/usr/lib/x86_64-linux-gnu/libpython3.14d.so.1.0",
    "/usr/lib/x86_64-linux-gnu/libpython3.13.so.1.0",
  ])("keeps an unproven APT mapping unknown: %s", async (path) => {
    const directory = await createTestTempDirectory("rea-python-package-map-");
    const host = systemLinuxHopperInstallHost(
      { XDG_CACHE_HOME: directory },
      async () => undefined,
    );
    const command = vi
      .spyOn(boundedCommands, "execFileBoundedOutput")
      .mockResolvedValue(commandSuccess);
    const inspect = vi
      .spyOn(pythonRuntime, "inspectLinuxHopperPythonRuntime")
      .mockResolvedValue(
        ok({
          ...missingPython,
          library: { ...missingPython.library, path },
        }),
      );
    try {
      expect(
        await host.installPackage("deb", "/tmp/verified-hopper.deb"),
      ).toMatchObject({
        status: "runtime_unavailable",
        failure: {
          reason: "configuration_unknown",
          message: expect.stringContaining(path),
        },
      });
      expect(command).toHaveBeenCalledTimes(debCommands);
      expect(inspect).toHaveBeenCalledTimes(1);
    } finally {
      try {
        await host.close?.();
      } finally {
        inspect.mockRestore();
        command.mockRestore();
      }
    }
  });
});

describe("Linux Hopper package transaction failures", () => {
  it.each(Array.from({ length: debCommands }, (_, index) => index + 1))(
    "stops after failed install transaction %i without inspecting Python",
    async (failing) => {
      const directory = await createTestTempDirectory(
        "rea-linux-install-failure-",
      );
      const host = systemLinuxHopperInstallHost(
        { XDG_CACHE_HOME: directory },
        async () => undefined,
      );
      const failed = {
        exitCode: 100,
        stdout: "",
        stderr: "transaction " + String(failing) + " failed",
        outputTruncated: false,
      };
      let calls = 0;
      const command = vi
        .spyOn(boundedCommands, "execFileBoundedOutput")
        .mockImplementation(async () =>
          ++calls === failing ? failed : commandSuccess,
        );
      const inspect = vi.spyOn(
        pythonRuntime,
        "inspectLinuxHopperPythonRuntime",
      );
      try {
        expect(
          await host.installPackage("deb", "/tmp/verified-hopper.deb"),
        ).toMatchObject({
          status: "failed",
          failure: { exitCode: 100, stderr: failed.stderr },
        });
        expect(command).toHaveBeenCalledTimes(failing);
        expect(inspect).not.toHaveBeenCalled();
      } finally {
        try {
          await host.close?.();
        } finally {
          inspect.mockRestore();
          command.mockRestore();
        }
      }
    },
  );
});

describe("Linux Hopper package cancellation and disclosure", () => {
  it.each([
    { phase: "before", commands: 0, inspections: 0 },
    { phase: "first transaction", commands: 1, inspections: 0 },
    { phase: "archive transaction", commands: debCommands, inspections: 0 },
    { phase: "query", commands: debCommands, inspections: 1 },
    { phase: "runtime transaction", commands: debCommands + 1, inspections: 1 },
    { phase: "verification", commands: debCommands + 1, inspections: 2 },
  ])(
    "honors cancellation at $phase without starting the next stage",
    async ({ phase, commands, inspections }) => {
      const directory = await createTestTempDirectory(
        "rea-python-install-cancel-",
      );
      const host = systemLinuxHopperInstallHost(
        { XDG_CACHE_HOME: directory },
        async () => undefined,
      );
      const controller = new AbortController();
      const cause = new Error("caller cancelled at " + phase);
      let commandCount = 0;
      let inspectionCount = 0;
      const command = vi
        .spyOn(boundedCommands, "execFileBoundedOutput")
        .mockImplementation(async () => {
          commandCount++;
          if (
            (phase === "first transaction" && commandCount === 1) ||
            (phase === "archive transaction" && commandCount === debCommands) ||
            (phase === "runtime transaction" &&
              commandCount === debCommands + 1)
          )
            controller.abort(cause);
          return commandSuccess;
        });
      const inspect = vi
        .spyOn(pythonRuntime, "inspectLinuxHopperPythonRuntime")
        .mockImplementation(async (_environment, signal) => {
          expect(signal).toBe(controller.signal);
          inspectionCount++;
          if (
            phase === "query" ||
            (phase === "verification" && inspectionCount === 2)
          )
            controller.abort(cause);
          return ok(inspectionCount === 1 ? missingPython : readyPython);
        });
      if (phase === "before") controller.abort(cause);
      try {
        const result = await host.installPackage(
          "deb",
          "/tmp/verified-hopper.deb",
          {
            signal: controller.signal,
          },
        );
        expect(result).toEqual({ status: "cancelled", cause });
        if (result.status === "cancelled") expect(result.cause).toBe(cause);
        expect(command).toHaveBeenCalledTimes(commands);
        expect(inspect).toHaveBeenCalledTimes(inspections);
      } finally {
        try {
          await host.close?.();
        } finally {
          inspect.mockRestore();
          command.mockRestore();
        }
      }
    },
  );

  it("discloses the conditional privileged library install without returning probe code", () => {
    const disclosure = linuxHopperInstallDisclosure("deb", false);
    expect(disclosure.commands).toHaveLength(debCommands + 1);
    expect(disclosure.commands[debCommands]).toBe(
      'pkexec apt-get install -y "<libpython matching /usr/bin/python3, if not loadable>"',
    );
    expect(linuxHopperInstallDisclosure("rpm", false).commands).toHaveLength(1);
  });
});
