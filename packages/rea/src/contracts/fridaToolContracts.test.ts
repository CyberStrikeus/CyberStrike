import { describe, expect, it } from "vitest";

import { TOOL_CONTRACTS } from "./toolContracts.js";
import { FRIDA_KEEPALIVE_INTERVAL_DESCRIPTION } from "./fridaToolContracts.js";
import { isValidFridaRemoteAddress } from "../domain/fridaRemoteAddress.js";

const contract = (name: string) => {
  const found = TOOL_CONTRACTS.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`Missing contract ${name}`);
  return found.inputSchema;
};

describe("Frida tool contracts", () => {
  it("documents Frida Core keepalive intervals in seconds", () => {
    expect(FRIDA_KEEPALIVE_INTERVAL_DESCRIPTION).toBe(
      "Remote keepalive interval in seconds",
    );
  });

  it("rejects incomplete or conflicting mode and source selectors", () => {
    const start = contract("start_frida_session");
    const load = contract("load_frida_script");
    const instrument = contract("instrument_with_frida");
    const processList = contract("list_frida_processes");

    expect(start.safeParse({ mode: "attach", pid: 7 }).success).toBe(true);
    expect(start.safeParse({ mode: "spawn", program: "app" }).success).toBe(
      true,
    );
    for (const input of [
      { mode: "attach" },
      { mode: "attach", pid: 7, program: "app" },
      { mode: "spawn" },
      { mode: "spawn", program: "app", pid: 7 },
      {
        mode: "attach",
        pid: 7,
        device_id: "local",
        remote: { address: "host" },
      },
    ])
      expect(start.safeParse(input).success).toBe(false);

    expect(
      load.safeParse({
        session_id: "00000000-0000-4000-8000-000000000001",
        source_kind: "inline",
        source: "",
      }).success,
    ).toBe(true);
    expect(
      load.safeParse({
        session_id: "00000000-0000-4000-8000-000000000001",
        source_kind: "file",
        path: "script.js",
      }).success,
    ).toBe(true);
    for (const input of [
      {
        session_id: "00000000-0000-4000-8000-000000000001",
        source_kind: "inline",
      },
      {
        session_id: "00000000-0000-4000-8000-000000000001",
        source_kind: "inline",
        source: "",
        path: "script.js",
      },
      {
        session_id: "00000000-0000-4000-8000-000000000001",
        source_kind: "file",
      },
    ])
      expect(load.safeParse(input).success).toBe(false);

    expect(
      instrument.safeParse({
        mode: "attach",
        pid: 7,
        source_kind: "inline",
        source: "",
      }).success,
    ).toBe(true);
    expect(
      instrument.safeParse({
        mode: "spawn",
        program: "app",
        source_kind: "file",
        path: "script.js",
      }).success,
    ).toBe(true);
    for (const input of [
      {
        mode: "attach",
        pid: 7,
        source_kind: "file",
        path: "script.js",
        source: "",
      },
      { mode: "spawn", program: "app", source_kind: "inline" },
      {
        mode: "spawn",
        program: "app",
        pid: 7,
        source_kind: "inline",
        source: "",
      },
      {
        mode: "attach",
        source_kind: "inline",
        source: "",
        device_id: "local",
        remote: { address: "host" },
      },
    ])
      expect(instrument.safeParse(input).success).toBe(false);

    expect(processList.safeParse({ device_id: "local" }).success).toBe(true);
    expect(processList.safeParse({}).success).toBe(false);
    expect(
      processList.safeParse({ device_id: "local", remote: { address: "host" } })
        .success,
    ).toBe(false);
  });

  it("publishes the Frida device, process, and session operations", () => {
    expect(TOOL_CONTRACTS.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "list_frida_devices",
        "list_frida_processes",
        "start_frida_session",
        "load_frida_script",
        "resume_frida_session",
        "unload_frida_script",
        "frida_session_status",
        "close_frida_session",
        "instrument_with_frida",
      ]),
    );
  });

  it("declares target authority for every operation that changes instrumentation", () => {
    for (const name of [
      "start_frida_session",
      "load_frida_script",
      "resume_frida_session",
      "unload_frida_script",
      "close_frida_session",
      "instrument_with_frida",
    ] as const) {
      const contract = TOOL_CONTRACTS.find(
        (candidate) => candidate.name === name,
      );
      expect(contract?.effects.mutatesTarget).toBe(true);
      expect(contract?.effects.idempotent).toBe(false);
    }
  });

  it("accepts Frida host addresses and rejects URL-like or malformed endpoints", () => {
    expect(isValidFridaRemoteAddress("127.0.0.1:27042")).toBe(true);
    expect(isValidFridaRemoteAddress("frida-target.example")).toBe(true);
    expect(isValidFridaRemoteAddress("[::1]:27042")).toBe(true);
    expect(isValidFridaRemoteAddress("tcp://127.0.0.1:27042")).toBe(false);
    expect(isValidFridaRemoteAddress("127.0.0.1:70000")).toBe(false);
    expect(isValidFridaRemoteAddress("127.0.0.1:0")).toBe(false);
    expect(isValidFridaRemoteAddress("127.0.0.1:")).toBe(false);
    expect(isValidFridaRemoteAddress("frida-target/path")).toBe(false);
    expect(isValidFridaRemoteAddress("user@frida-target")).toBe(false);
  });
});
