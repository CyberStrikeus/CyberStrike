import { DEFAULT_CATALOG_IDENTITY } from "../catalogIdentity.js";
import { PRODUCT_IDENTITY } from "../identity.js";
import { ok } from "../domain/result.js";
import type { DoctorHost } from "./Doctor.js";

/** Healthy recording host for focused doctor and projection tests. */
export const createDoctorHostFixture = (
  overrides: Partial<DoctorHost> = {},
): DoctorHost => ({
  platform: "darwin",
  homeDirectory: "/fixture/home",
  architecture: "x64",
  runtime: { id: "node", version: "24.22.1" },
  macosVersion: () => Promise.resolve("14.0"),
  linuxDistribution: () => Promise.resolve(undefined),
  validTarget: (path) => Promise.resolve(path.includes("Hopper")),
  executable: (path) => Promise.resolve(path.includes("Hopper")),
  inspectLinuxHopper: () =>
    Promise.resolve(
      ok({
        sha256: "0".repeat(64),
        version: "fixture",
        primaryFingerprint: "0".repeat(40),
        signingFingerprint: "1".repeat(40),
        source: "signed_package_cache" as const,
      }),
    ),
  linuxDemoRuntimeCheck: () =>
    Promise.resolve({
      name: "hopper-demo-runtime",
      ok: true,
      classification: "healthy",
    }),
  brewHopperPath: () => Promise.resolve(undefined),
  manualHopperPaths: () => Promise.resolve([]),
  installedSkillIdentity: () =>
    Promise.resolve({
      version: PRODUCT_IDENTITY.skillVersion,
      toolCount: DEFAULT_CATALOG_IDENTITY.counts.mcp_tools,
      canonical: true,
    }),
  ...overrides,
});
