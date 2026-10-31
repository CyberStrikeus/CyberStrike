import { describe, expect, it, vi } from "vitest";

import { parseConfig } from "../config/parseConfig.js";
import {
  ELF_METADATA_ARCHITECTURES,
  type BinaryTarget,
} from "../domain/binaryTargetTypes.js";
import { silentLogger } from "../logger.js";
import { err, ok } from "../domain/result.js";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import { hopperDeclinedArchitectureReason } from "./HopperAnalysisProfile.js";
import { HopperClient } from "./HopperClient.js";
import { HopperProvider } from "./HopperProvider.js";
import { isSnapshotCacheable } from "../application/binary/AnalysisSnapshotCache.js";
import { routeAllowsSnapshotReplay } from "../application/binary/SessionProviderPolicy.js";
import type { SessionProviderRoute } from "../application/binary/SessionProviderRouter.js";

describe("Hopper provider capabilities", () => {
  it("does not replay snapshots for mutable Hopper document observations", () => {
    const config = parseConfig({});
    if (!config.ok) throw config.error;
    const provider = new HopperProvider(config.value, silentLogger, {});
    const capabilities = provider.capabilities();
    const route: SessionProviderRoute = {
      identity: provider.identity(),
      capabilities: new Map(capabilities.map((item) => [item.operation, item])),
      profile: null,
      binding: null,
      selection: undefined,
      createClient: () => {
        throw new Error("No client needed");
      },
    };
    const readable = capabilities.filter(
      (item) => item.available && !item.effects.mutatesArtifact,
    );
    expect(readable.length).toBeGreaterThan(0);
    for (const descriptor of readable) {
      expect(descriptor.cachePolicy).toBe("live");
      expect(routeAllowsSnapshotReplay(route, descriptor.operation)).toBe(
        false,
      );
      expect(
        isSnapshotCacheable(descriptor.operation, descriptor, {
          document: "selected",
          address: "0x1000",
        }),
      ).toBe(false);
    }
    expect(routeAllowsSnapshotReplay(route, "get_call_graph")).toBe(false);
  });
});

describe("Hopper provider target support", () => {
  it("declines caller-selected gamecube-dol targets before the ELF powerpc gate", () => {
    const config = parseConfig({});
    if (!config.ok) throw new Error("expected valid configuration");
    const provider = new HopperProvider(config.value, silentLogger, {});
    expect(
      provider.inspectTargetSupport({
        path: "/tmp/game.dol",
        sha256: "a".repeat(64),
        kind: "executable",
        format: "gamecube-dol",
        architecture: "powerpc",
        availableArchitectures: ["powerpc"],
        byteOrder: "big",
        bits: 32,
        entryPoint: "0x80003100",
        entryPointSource: "dol-header",
        dol: {
          sections: [],
          bss: { address: 0, size: 0 },
          bssOverlaps: [],
          bssGaps: [],
          entryPoint: 0x8000_3100,
        },
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "target_format_unsupported",
      reason: expect.stringContaining("gamecube-dol"),
    });
  });
  it("declines headerless raw-binary targets with a Ghidra-directed reason", () => {
    const config = parseConfig({});
    if (!config.ok) throw new Error("expected valid configuration");
    const provider = new HopperProvider(config.value, silentLogger, {});
    expect(
      provider.inspectTargetSupport({
        path: "/tmp/ecu.bin",
        sha256: "a".repeat(64),
        kind: "executable",
        format: "raw-binary",
        architecture: "arm",
        availableArchitectures: ["arm"],
        entryPoint: "0x8000000",
        entryPointSource: "0x8000000",
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "target_format_unsupported",
      reason: expect.stringContaining("Ghidra"),
    });
  });
  it("declines DOS MZ targets with a provider-specific support reason", () => {
    const config = parseConfig({});
    if (!config.ok) throw new Error("expected valid configuration");
    const provider = new HopperProvider(config.value, silentLogger, {});
    expect(
      provider.inspectTargetSupport({
        path: "/tmp/legacy.exe",
        sha256: "a".repeat(64),
        kind: "executable",
        format: "dos-mz",
        architecture: "x86",
        availableArchitectures: ["x86"],
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "target_format_unsupported",
      reason: expect.stringContaining("Ghidra"),
    });
  });
  it("declines each family Ghidra may admit without stating a Ghidra lane status", () => {
    const families = [...ELF_METADATA_ARCHITECTURES, "hexagon"] as const;
    const reasons = families.map((family) =>
      hopperDeclinedArchitectureReason(family),
    );
    for (const [index, family] of families.entries()) {
      expect(reasons[index]).toContain(family);
      expect(reasons[index]).toContain("Ghidra");
    }
    // Apart from the family's name, every reason is the same text.
    expect(
      new Set(
        reasons.map((reason, index) =>
          reason.replaceAll(families[index] ?? "", "<family>"),
        ),
      ).size,
    ).toBe(1);
  });
  it.each([
    {
      path: "/tmp/chre_pal.so",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "elf",
      architecture: "hexagon",
      availableArchitectures: ["hexagon"],
    },
    {
      path: "/tmp/router.elf",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "elf",
      architecture: "mips",
      availableArchitectures: ["mips"],
      mips: { elfClass: 32, byteOrder: "big", type: 2, flags: 0 },
    },
  ] as const satisfies readonly BinaryTarget[])(
    "declines $architecture targets with the owned reason",
    (target) => {
      const config = parseConfig({});
      if (!config.ok) throw new Error("expected valid configuration");
      const provider = new HopperProvider(config.value, silentLogger, {});
      expect(provider.inspectTargetSupport(target)).toMatchObject({
        status: "unsupported",
        code: "architecture_unsupported",
        reason: hopperDeclinedArchitectureReason(target.architecture),
      });
    },
  );
  it("declines thin arm64_32 Mach-O targets without a verified lane", () => {
    const config = parseConfig({});
    if (!config.ok) throw new Error("expected valid configuration");
    const provider = new HopperProvider(config.value, silentLogger, {});
    expect(
      provider.inspectTargetSupport({
        path: "/tmp/watch.o",
        sha256: "a".repeat(64),
        kind: "executable",
        format: "mach-o",
        architecture: "arm64_32",
        availableArchitectures: ["arm64_32"],
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "architecture_unsupported",
      reason: expect.stringContaining("arm64_32"),
    });
  });
});

describe("Hopper relationship coverage", () => {
  it.each([
    ["procedure_callers", ["callers"]],
    ["procedure_callees", ["callees"]],
    ["analyze_function", ["callers", "callees"]],
  ] as const)(
    "retains %s observations without claiming exhaustive relationships",
    async (operation, directions) => {
      const config = parseConfig({});
      if (!config.ok) throw config.error;
      const identity = (address: string) => ({
        address,
        name: address,
        symbol: null,
        classification: null,
        body: { available: false as const, reason: "unknown" },
      });
      const source =
        operation === "analyze_function"
          ? {
              procedure: { ...identity("0x1000"), signature: null, locals: [] },
              pseudocode: "",
              assembly: [],
              comments: [],
              callers: [],
              callees: [identity("0x2000")],
              incoming_references: [],
              outgoing_references: [],
              referenced_strings: [],
              referenced_names: [],
              basic_blocks: [],
              native_api: null,
              native_value_flow: null,
              limitations: [],
            }
          : operation === "procedure_callees"
            ? ["0x2000"]
            : [];
      const originalSource = structuredClone(source);
      const callTool = vi
        .spyOn(HopperClient.prototype, "callTool")
        .mockImplementation((method) =>
          Promise.resolve(
            ok(
              method === "rea_caller_base"
                ? {
                    target: identity("0x1000"),
                    instructions: ["0x1000"],
                    instructions_complete: true,
                    callers: [],
                    callers_complete: true,
                  }
                : method === "rea_caller_scan_target"
                  ? {
                      target: identity("0x1000"),
                      instructions: ["0x1000"],
                      instructions_complete: true,
                    }
                  : method === "rea_caller_scan_page"
                    ? {
                        start: 0,
                        next: 0,
                        total: 0,
                        items: [],
                        oversized: false,
                      }
                    : source,
            ),
          ),
        );
      const client = new HopperProvider(
        config.value,
        silentLogger,
        {},
        "linux",
      ).createClient({
        path: "/tmp/fixture.hop",
        sha256: "a".repeat(64),
        kind: "database",
        format: "analysis-database",
      });
      try {
        const observed = await client.execute(operation, {
          procedure: "0x1000",
        });
        if (!observed.ok) throw observed.error;
        expect(observed.value.result).toEqual(originalSource);
        expect(source).toEqual(originalSource);
        if (operation === "procedure_callers") {
          expect(observed.value.rawResult).toMatchObject({
            native_result: {
              callers: [],
              callers_complete: true,
              instructions_complete: true,
              target: { address: "0x1000" },
            },
            forward_observations: {
              call_references: [],
              call_site_callers: [],
            },
          });
          expect(observed.value.rawResult).toMatchObject({
            native_result: expect.not.objectContaining({
              instructions: expect.any(Array),
            }),
          });
        }
        if (operation === "procedure_callees")
          expect(observed.value.rawResult).toBeNull();
        expect(observed.value.relationshipCoverage).toMatchObject({
          status: "unknown",
          limited_directions: directions,
          reason: expect.stringContaining(
            operation === "procedure_callees"
              ? "resolved tail calls"
              : "reconciliation examined",
          ),
        });
      } finally {
        await client.close();
        callTool.mockRestore();
      }
    },
  );
});

describe("Hopper caller reconciliation failures", () => {
  it("keeps the native caller reply when a later scan page fails", async () => {
    const config = parseConfig({});
    if (!config.ok) throw config.error;
    const identity = (address: string) => ({
      address,
      name: address,
      symbol: null,
      classification: null,
      body: { available: false as const, reason: "unknown" },
    });
    const native = {
      target: identity("0x1000"),
      instructions: ["0x1000"],
      instructions_complete: true,
      callers: ["0x1111"],
      callers_complete: true,
    };
    let pages = 0;
    const callTool = vi
      .spyOn(HopperClient.prototype, "callTool")
      .mockImplementation((method) => {
        if (method === "rea_caller_base") return Promise.resolve(ok(native));
        if (method !== "rea_caller_scan_page") return Promise.resolve(ok(null));
        pages += 1;
        if (pages === 1)
          return Promise.resolve(
            ok({
              start: 0,
              next: 1,
              total: 2,
              oversized: false,
              items: [
                {
                  caller: identity("0x3000"),
                  callees: ["0x1000"],
                  references: [],
                },
              ],
            }),
          );
        return Promise.resolve(
          err(
            new AnalysisOutputError(
              "rea_caller_scan_page",
              "bridge page failed",
            ),
          ),
        );
      });
    const client = new HopperProvider(
      config.value,
      silentLogger,
      {},
      "linux",
    ).createClient({
      path: "/tmp/fixture.hop",
      sha256: "a".repeat(64),
      kind: "database",
      format: "analysis-database",
    });
    try {
      const observed = await client.execute("procedure_callers", {
        procedure: "0x1000",
      });
      if (observed.ok) throw new Error("expected procedure_callers to fail");
      expect(observed.error.partialObservation).toMatchObject({
        kind: "hopper-caller-reconciliation",
        native_result: native,
        coverage: { status: "unknown", limited_directions: ["callers"] },
        scan: {
          examined_procedures: 1,
          procedure_total: 2,
          stop: { code: "page_failure" },
        },
        forward_destinations: {
          identities: [expect.objectContaining({ address: "0x3000" })],
          destinations: [
            expect.objectContaining({
              address: "0x1000",
              caller_addresses: ["0x3000"],
            }),
          ],
        },
      });
    } finally {
      await client.close();
      callTool.mockRestore();
    }
  });
});
