import { expect, it } from "vitest";

import { bridgeBootstrapSource } from "./BridgeLauncher.js";

const session = {
  directory: "/tmp/rea-bootstrap",
  socketPath: "/tmp/rea-bootstrap/bridge.sock",
  token: "token",
  runId: "run",
};
const options = {
  environment: {},
  launcherPath: "/hopper",
  targetPath: "/target",
  targetKind: "executable" as const,
  loaderArgs: [],
  bridgeScriptPath: "/bridge.py",
};

it("leaves an unset ceiling out of the Hopper bootstrap", () => {
  const source = bridgeBootstrapSource(session, options, true, "/target");
  expect(source).not.toContain("REA_BRIDGE_MAX_REQUEST_BYTES");
  expect(source).toContain("exec(compile");
});

it("injects a caller-selected ceiling before the bridge is executed", () => {
  const source = bridgeBootstrapSource(
    session,
    {
      ...options,
      bridgeMaxRequestBytes: { maximumBytes: 8192, source: "setting" },
    },
    true,
    "/target",
  );
  const injected = source.indexOf("REA_BRIDGE_MAX_REQUEST_BYTES = 8192");
  expect(injected).toBeGreaterThanOrEqual(0);
  expect(injected).toBeLessThan(source.indexOf("exec(compile"));
});
