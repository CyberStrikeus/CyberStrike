import { describe, expect, it } from "vitest";

import { HopperProvider } from "./hopper/HopperProvider.js";
import { silentLogger } from "./logger.js";
import { parseConfig } from "./config/parseConfig.js";

const config = (env: Record<string, string | undefined> = {}) => {
  const parsed = parseConfig(env);
  if (!parsed.ok) throw new Error("expected valid configuration");
  return parsed.value;
};

describe("host platform is injected, not read from the ambient process", () => {
  it("reports Hopper as unsupported for a platform it cannot run on", () => {
    const provider = new HopperProvider(config(), silentLogger, {}, "win32");
    const availability = provider.inspectAvailability();
    expect(availability).toMatchObject({
      status: "unavailable",
      code: "unsupported_host",
    });
    expect(JSON.stringify(availability)).toContain("win32");
  });

  it.each(["darwin", "linux"] as const)(
    "does not gate Hopper as unsupported on %s",
    (platform) => {
      const provider = new HopperProvider(
        config({ hopper_launcher_path: "/nonexistent/hopper-launcher" }),
        silentLogger,
        {},
        platform,
      );
      expect(provider.inspectAvailability().code).not.toBe("unsupported_host");
    },
  );
});
