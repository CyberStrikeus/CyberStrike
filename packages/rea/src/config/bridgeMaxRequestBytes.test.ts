import { expect, it } from "vitest";

import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { parseEnvironment } from "./environment.js";
import { parseConfig } from "./parseConfig.js";
import {
  BRIDGE_MAX_REQUEST_BYTES_SETTING,
  bridgeMaxRequestBytesConstraint,
  DEFAULT_BRIDGE_MAX_REQUEST,
  DEFAULT_BRIDGE_MAX_REQUEST_BYTES,
  MAXIMUM_BRIDGE_MAX_REQUEST_BYTES,
  MINIMUM_BRIDGE_MAX_REQUEST_BYTES,
  parseBridgeMaxRequestBytes,
} from "./bridgeMaxRequestBytes.js";

const configured = (maximumBytes: number) =>
  ({ maximumBytes, source: "setting" }) as const;

const symbolName = "\u0001".repeat(1024);
const session = "00000000-0000-4000-8000-000000000001";
const token = "a".repeat(64);

it("keeps the 16 MiB ceiling when the setting is unset", () => {
  expect(parseBridgeMaxRequestBytes(undefined)).toEqual({
    ok: true,
    value: DEFAULT_BRIDGE_MAX_REQUEST,
  });
  const parsed = parseConfig({});
  if (!parsed.ok) throw new Error("unset bridge ceiling was rejected");
  expect(parsed.value.bridgeMaxRequestBytes).toEqual(
    DEFAULT_BRIDGE_MAX_REQUEST,
  );
  const environment = parseEnvironment({});
  if (!environment.ok) throw new Error("doctor rejected an unset ceiling");
  expect(environment.value.REA_BRIDGE_MAX_REQUEST_BYTES).toBeUndefined();
});

it("accepts a caller-selected ceiling inside the floor and maximum", () => {
  const parsed = parseConfig({
    [BRIDGE_MAX_REQUEST_BYTES_SETTING]: "33554432",
  });
  if (!parsed.ok) throw new Error("valid bridge ceiling was rejected");
  expect(parsed.value.bridgeMaxRequestBytes).toEqual(configured(33_554_432));
  const environment = parseEnvironment({
    [BRIDGE_MAX_REQUEST_BYTES_SETTING]: "8192",
  });
  if (!environment.ok) throw new Error("doctor rejected a valid ceiling");
  expect(environment.value.REA_BRIDGE_MAX_REQUEST_BYTES).toBe(8192);
});

it("sets the maximum to the serialized string bound minus the framing LF", () => {
  const stringCeiling = 536_870_888;
  const hundredMib = 100 * 1024 * 1024;
  expect(MAXIMUM_BRIDGE_MAX_REQUEST_BYTES).toBe(stringCeiling - 1);
  expect(MAXIMUM_BRIDGE_MAX_REQUEST_BYTES).toBe(536_870_887);
  expect(hundredMib).toBeLessThan(MAXIMUM_BRIDGE_MAX_REQUEST_BYTES);
  const parsed = parseConfig({
    [BRIDGE_MAX_REQUEST_BYTES_SETTING]: String(hundredMib),
  });
  if (!parsed.ok) throw new Error("a 100 MiB encoded ceiling was rejected");
  expect(parsed.value.bridgeMaxRequestBytes).toEqual(configured(hundredMib));
  expect(MAXIMUM_BRIDGE_MAX_REQUEST_BYTES).toBeGreaterThan(
    DEFAULT_BRIDGE_MAX_REQUEST_BYTES,
  );
});

it("locks the floor to the authenticated frame of the largest bounded symbol name", () => {
  const hopper = Buffer.byteLength(
    JSON.stringify({
      id: Number.MAX_SAFE_INTEGER,
      token,
      method: "set_address_name",
      params: { address: "0xffffffffffffffff", name: symbolName },
    }),
  );
  const command = JSON.stringify({
    kind: "command",
    request_id: session,
    expected_generation: Number.MAX_SAFE_INTEGER,
    command: symbolName,
    json: false,
    session_id: session,
  });
  const framed = Buffer.byteLength(
    JSON.stringify({ request: command, proof: "f".repeat(64) }),
  );
  let estimated =
    Buffer.byteLength(JSON.stringify({ request: "", proof: "0".repeat(64) })) +
    Buffer.byteLength(command);
  for (const character of command)
    if (character === '"' || character === "\\") estimated += 1;
  const hello = Buffer.byteLength(
    JSON.stringify({ kind: "rea-auth-v2", nonce: "ab".repeat(32) }),
  );
  expect(hopper).toBe(6322);
  expect(framed).toBe(7464);
  expect(estimated).toBe(framed);
  expect(hello).toBeLessThan(MINIMUM_BRIDGE_MAX_REQUEST_BYTES);
  expect(Math.max(hopper, framed)).toBe(MINIMUM_BRIDGE_MAX_REQUEST_BYTES);
  expect(MINIMUM_BRIDGE_MAX_REQUEST_BYTES).toBeLessThan(
    DEFAULT_BRIDGE_MAX_REQUEST_BYTES,
  );
});

it.each([
  "",
  "0",
  "-1",
  "7463",
  "016777216",
  "16_777_216",
  "1e7",
  " 16777216",
  "16777216 ",
  "1.5",
  String(MAXIMUM_BRIDGE_MAX_REQUEST_BYTES + 1),
  "9".repeat(40),
])("rejects invalid %j as configuration_invalid", (value) => {
  const parsed = parseBridgeMaxRequestBytes(value);
  expect(parsed.ok).toBe(false);
  if (parsed.ok) return;
  expect(parsed.error.settings).toEqual([
    {
      setting: BRIDGE_MAX_REQUEST_BYTES_SETTING,
      constraint: bridgeMaxRequestBytesConstraint,
    },
  ]);
  expect(projectAnalysisError(parsed.error).code).toBe("configuration_invalid");
  const startup = parseConfig({ [BRIDGE_MAX_REQUEST_BYTES_SETTING]: value });
  const doctor = parseEnvironment({
    [BRIDGE_MAX_REQUEST_BYTES_SETTING]: value,
  });
  if (startup.ok) throw new Error(`Startup accepted ${JSON.stringify(value)}`);
  expect(startup.error._tag).toBe("ConfigurationError");
  expect(startup.error.settings).toContainEqual({
    setting: BRIDGE_MAX_REQUEST_BYTES_SETTING,
    constraint: bridgeMaxRequestBytesConstraint,
  });
  if (doctor.ok) throw new Error(`Doctor accepted ${JSON.stringify(value)}`);
  expect(doctor.error._tag).toBe("ConfigurationError");
  expect(doctor.error.settings).toContainEqual({
    setting: BRIDGE_MAX_REQUEST_BYTES_SETTING,
    constraint: bridgeMaxRequestBytesConstraint,
  });
});
