import { expect, it } from "vitest";

import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../../../src/process/ProviderProcess.js";

const hostEnvironment = {
  PATH: "host-search-path",
  REA_CASE_TEST: "host-case",
  REA_EMPTY_TEST: "host-empty",
  REA_UNSET_TEST: "host-unset",
  REA_EXACT_UNSET_TEST: "host-exact-unset",
  REA_PROCESS_RUN_ID: "host-run-id",
};

const observeEnvironment = async (
  platform: NodeJS.Platform,
  path: string | undefined,
): Promise<Record<string, string>> => {
  const launched = await spawnOwnedProviderProcess({
    command: process.execPath,
    arguments: [
      "-e",
      `process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() === "PATH" || key.toUpperCase().startsWith("REA_")))));`,
    ],
    hostEnvironment,
    env: {
      Path: path,
      rea_case_test: "caller-case",
      rea_empty_test: "",
      rea_unset_test: undefined,
      REA_EXACT_UNSET_TEST: undefined,
      REA_PROCESS_RUN_ID: "caller-uppercase-run-id",
      rea_process_run_id: "caller-lowercase-run-id",
    },
    platform,
    runId: "owned-run-id",
  });
  const supervisor = new ProviderProcessSupervisor({
    ...launched,
    ownsProcessLifetime: true,
  });
  try {
    expect(await supervisor.waitForOutputClose(2_000)).toBe(true);
    const snapshot = supervisor.snapshot();
    expect(snapshot.exitCode, snapshot.stderr.text).toBe(0);
    return JSON.parse(snapshot.stdout.text) as Record<string, string>;
  } finally {
    const stopped = await supervisor.stop();
    expect(stopped.status).not.toBe("incomplete");
  }
};

it.each([undefined, ""])(
  "preserves Windows caller PATH %s and ownership token precedence at real process creation",
  async (path) => {
    // On Windows this exercises the native Job Object launcher. On POSIX the
    // configured-platform seam exposes the exact producer environment to a real child.
    const observed = await observeEnvironment("win32", path);
    const entries = Object.entries(observed);
    const canonical = Object.fromEntries(
      entries.map(([name, value]) => [name.toUpperCase(), value]),
    );
    expect(canonical).toEqual({
      ...(path === undefined ? {} : { PATH: "" }),
      REA_CASE_TEST: "caller-case",
      REA_EMPTY_TEST: "",
      REA_PROCESS_RUN_ID: "owned-run-id",
    });
    expect(entries).toHaveLength(Object.keys(canonical).length);
  },
);

it.skipIf(process.platform === "win32")(
  "keeps case-distinct POSIX variables and exact-key removal through real process creation",
  async () => {
    expect(await observeEnvironment(process.platform, undefined)).toEqual({
      PATH: "host-search-path",
      REA_CASE_TEST: "host-case",
      REA_EMPTY_TEST: "host-empty",
      REA_UNSET_TEST: "host-unset",
      REA_PROCESS_RUN_ID: "owned-run-id",
      rea_case_test: "caller-case",
      rea_empty_test: "",
      rea_process_run_id: "caller-lowercase-run-id",
    });
  },
);
