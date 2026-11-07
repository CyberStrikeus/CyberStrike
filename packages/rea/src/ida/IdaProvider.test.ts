import { launchRegexMatchingLimitation } from "../process/RegexMatcher.js";
import { AnalysisSettings } from "../application/AnalysisSettings.js";
import { runtimeAnalysisConfig } from "../config/runtimeAnalysisSettings.js";
import { describe, expect, it, vi } from "vitest";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";

import { parseConfig } from "../config/parseConfig.js";
import {
  BINARY_ARCHITECTURES,
  type BinaryTarget,
} from "../domain/binaryTargetTypes.js";
import {
  RecordingIdaMcp,
  createIdaTarget,
} from "../../tests/fixtures/idaMcp.js";
import { IdaProvider } from "./IdaProvider.js";

it.each([
  { state: "unconfigured", selected: false, content: undefined },
  { state: "missing", selected: true, content: undefined },
  { state: "malformed", selected: true, content: "{" },
  { state: "invalid", selected: true, content: "{}" },
])(
  "preserves the owning registration setting and selection for $state IDA readiness",
  async ({ selected, content }) => {
    const root = await createTestTempDirectory("rea-ida-recovery-");
    const path = join(root, "registration.json");
    if (content !== undefined) await writeFile(path, content);
    const config = parseConfig(selected ? { REA_IDA_MCP_CONFIG: path } : {});
    if (!config.ok) throw config.error;
    const connect = vi.fn(() => {
      throw new Error("Readiness must not connect to IDA");
    });
    const provider = new IdaProvider(config.value, {}, connect);
    try {
      const snapshot = await provider.inspectReadinessSnapshot();
      expect(snapshot.availability).toMatchObject({
        status: "unavailable",
        code: selected ? "open_options_invalid" : "not_configured",
        reason: expect.stringContaining("REA_IDA_MCP_CONFIG"),
        diagnostics: {
          configured: selected,
          registration_path: selected ? path : null,
          live_connection_probed: false,
          configuration_details: {
            settings: [
              { setting: "REA_IDA_MCP_CONFIG", constraint: expect.any(String) },
            ],
          },
          configuration_remediation:
            expect.stringContaining("REA_IDA_MCP_CONFIG"),
        },
      });
      expect(connect).not.toHaveBeenCalled();
    } finally {
      const closed = await provider.closeOwnedResources();
      if (!closed.ok) throw closed.error;
    }
  },
);

it("keeps a selected valid registration distinct from a live IDA connection", async () => {
  const root = await createTestTempDirectory("rea-ida-configured-");
  const path = join(root, "registration.json");
  await writeFile(
    path,
    JSON.stringify({ mode: "attached", url: "http://127.0.0.1:13337/mcp" }),
  );
  const config = parseConfig({ REA_IDA_MCP_CONFIG: path });
  if (!config.ok) throw config.error;
  const connect = vi.fn(() => {
    throw new Error("Readiness must not connect to IDA");
  });
  const provider = new IdaProvider(config.value, {}, connect);
  try {
    expect(await provider.inspectAvailability()).toMatchObject({
      status: "available",
      diagnostics: {
        configured: true,
        registration_path: path,
        live_connection_probed: false,
      },
    });
    expect(connect).not.toHaveBeenCalled();
  } finally {
    const closed = await provider.closeOwnedResources();
    if (!closed.ok) throw closed.error;
  }
});

it.each(["missing", "file", "directory", "omitted"] as const)(
  "reports headless workspace readiness without launching IDA: %s",
  async (kind) => {
    const root = await createTestTempDirectory("rea-ida-discovery-workspace-");
    const workspace = join(root, "workspace");
    if (kind === "file") await writeFile(workspace, "caller data");
    if (kind === "directory") await mkdir(workspace);
    const registration = join(root, "registration.json");
    await writeFile(
      registration,
      JSON.stringify({
        mode: "headless",
        command: "must-not-launch",
        ...(kind === "omitted" ? {} : { workspaceRoot: workspace }),
      }),
    );
    const config = parseConfig({ REA_IDA_MCP_CONFIG: registration });
    if (!config.ok) throw config.error;
    const connect = vi.fn(() => {
      throw new Error("Readiness must not connect to IDA");
    });
    const provider = new IdaProvider(config.value, {}, connect);
    const before = (await readdir(root)).sort();
    try {
      const snapshot = await provider.inspectReadinessSnapshot();
      if (kind === "missing" || kind === "file") {
        expect(snapshot.availability).toMatchObject({
          status: "unavailable",
          code: "open_options_invalid",
          reason: expect.stringContaining(workspace),
          diagnostics: {
            workspace_root: workspace,
            live_connection_probed: false,
            configuration_remediation: expect.stringContaining("workspaceRoot"),
          },
        });
        expect(snapshot.capabilities.every(({ available }) => !available)).toBe(
          true,
        );
        expect(
          snapshot.capabilities.find(
            ({ operation }) => operation === "procedure_callers",
          )?.reason,
        ).toContain("direct call edges");
      } else expect(snapshot.availability.status).toBe("available");
      expect((await readdir(root)).sort()).toEqual(before);
      expect(connect).not.toHaveBeenCalled();
    } finally {
      const closed = await provider.closeOwnedResources();
      if (!closed.ok) throw closed.error;
    }
  },
);

describe("IDA provider target support", () => {
  it("declines caller-selected gamecube-dol targets", () => {
    const config = parseConfig({});
    if (!config.ok) throw new Error("expected valid configuration");
    const provider = new IdaProvider(config.value, {});
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
      reason: expect.stringContaining("DOL"),
    });
  });
  it("declines headerless raw-binary targets", () => {
    const config = parseConfig({});
    if (!config.ok) throw new Error("expected valid configuration");
    const provider = new IdaProvider(config.value, {});
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
  it("declines Hexagon targets with a Ghidra-directed reason", () => {
    const config = parseConfig({});
    if (!config.ok) throw new Error("expected valid configuration");
    const provider = new IdaProvider(config.value, {});
    const support = provider.inspectTargetSupport({
      path: "/tmp/chre_pal.so",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "elf",
      architecture: "hexagon",
      availableArchitectures: ["hexagon"],
    });
    expect(support).toMatchObject({
      status: "unsupported",
      code: "architecture_unsupported",
    });
    expect(support.reason).toContain("hexagon");
    expect(support.reason).toContain("Ghidra");
  });
  it("admits only the families IDA admits today, so new families stay refused", () => {
    const config = parseConfig({});
    if (!config.ok) throw new Error("expected valid configuration");
    const provider = new IdaProvider(config.value, {});
    const admitted: readonly string[] = ["x86", "x86_64", "arm", "arm64"];
    for (const architecture of BINARY_ARCHITECTURES) {
      // Admission reads only kind, format and family, so one ELF shape
      // covers every recognized family, including any added later.
      const support = provider.inspectTargetSupport({
        path: "/tmp/fixture.elf",
        sha256: "a".repeat(64),
        kind: "executable",
        format: "elf",
        architecture,
        availableArchitectures: [architecture],
      } as BinaryTarget);
      expect(support, architecture).toMatchObject(
        admitted.includes(architecture)
          ? { status: "supported" }
          : {
              status: "unsupported",
              code: "architecture_unsupported",
              reason: expect.stringContaining(architecture),
            },
      );
    }
  });
  it("declines thin arm64_32 Mach-O targets without a verified lane", () => {
    const config = parseConfig({});
    if (!config.ok) throw new Error("expected valid configuration");
    const provider = new IdaProvider(config.value, {});
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

it.each(["http", "stdio"] as const)(
  "excludes declared %s credentials from profile identity while binding fresh clients to their selected values",
  async (transport) => {
    const { root, target } = await createIdaTarget();
    const path = join(root, "credential-registration.json");
    const config = parseConfig({ REA_IDA_MCP_CONFIG: path });
    if (!config.ok) throw config.error;
    const selected: string[] = [];
    const provider = new IdaProvider(config.value, {}, (registration) => {
      selected.push(
        "headers" in registration
          ? registration.headers.Authorization!
          : registration.env.PRIVATE_VALUE!,
      );
      return new RecordingIdaMcp(target, "attached");
    });
    const profiles: string[] = [];
    try {
      for (const token of ["first credential", "second credential"]) {
        await writeFile(
          path,
          JSON.stringify(
            transport === "http"
              ? {
                  url: "http://127.0.0.1:8745/mcp",
                  headers: { Authorization: token, "X-Input": "retained" },
                }
              : {
                  command: "fixture",
                  env: { PRIVATE_VALUE: token, IDADIR: "/fixture/ida" },
                  sensitive: { env: ["PRIVATE_VALUE"] },
                },
          ),
        );
        const resolved = await provider.resolveAnalysisProfile(target);
        if (!resolved.ok) throw resolved.error;
        if (
          resolved.value.profile === null ||
          resolved.value.createClient === undefined
        )
          throw new Error("Expected a bound profile");
        profiles.push(resolved.value.profile.digest);
        const client = resolved.value.createClient(
          target,
          resolved.value.profile,
        );
        await client.close();
      }
      expect(profiles[0]).toBe(profiles[1]);
      expect(selected).toEqual(["first credential", "second credential"]);
      await writeFile(
        path,
        JSON.stringify(
          transport === "http"
            ? {
                url: "http://127.0.0.1:8745/mcp",
                headers: {
                  Authorization: "second credential",
                  "X-Input": "changed input",
                },
              }
            : {
                command: "fixture",
                env: {
                  PRIVATE_VALUE: "second credential",
                  IDADIR: "/changed/ida",
                },
                sensitive: { env: ["PRIVATE_VALUE"] },
              },
        ),
      );
      const changed = await provider.resolveAnalysisProfile(target);
      if (!changed.ok) throw changed.error;
      expect(changed.value.profile?.digest).toEqual(expect.any(String));
      expect(changed.value.profile?.digest).not.toBe(profiles[0]);
    } finally {
      await provider.closeOwnedResources();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("applies runtime regex budgets through a bound IDA client and recovers in the same session", async () => {
  const { root, target } = await createIdaTarget();
  const path = join(root, "registration.json");
  let client:
    | import("../application/AnalysisProvider.js").AnalysisClient
    | undefined;
  let provider: IdaProvider | undefined;
  try {
    await writeFile(
      path,
      JSON.stringify({ mode: "attached", url: "http://127.0.0.1:13337/mcp" }),
    );
    const parsed = parseConfig({ REA_IDA_MCP_CONFIG: path });
    if (!parsed.ok) throw parsed.error;
    const settings = new AnalysisSettings({});
    const producer = new RecordingIdaMcp(target, "attached");
    const value = "a".repeat(40) + "!";
    producer.overrideCall = (name) =>
      name === "list_strings"
        ? {
            data: [{ address: "0x3000", length: value.length, string: value }],
            next_offset: null,
          }
        : undefined;
    provider = new IdaProvider(
      runtimeAnalysisConfig(parsed.value, settings.read),
      {},
      () => producer,
    );
    const resolved = await provider.resolveAnalysisProfile(target);
    if (!resolved.ok) throw resolved.error;
    if (!resolved.value.createClient || !resolved.value.profile)
      throw new Error("Expected bound IDA client");
    client = resolved.value.createClient(target, resolved.value.profile);
    expect(
      settings.update({
        changes: [
          { setting: "regex.matching_deadline_ms", action: "set", value: 100 },
          {
            setting: "regex.worker_heap_request_mib",
            action: "set",
            value: 256,
          },
        ],
      }).ok,
    ).toBe(true);
    const failed = await settings.run(() =>
      client!.execute("search_strings", { pattern: "^(a+)+$", mode: "regex" }),
    );
    expect(failed).toMatchObject({
      ok: false,
      error: {
        limit: {
          setting: "regex.matching_deadline_ms",
          effective_value: 100,
          source: "runtime",
        },
      },
    });
    const capabilities = provider
      .capabilities()
      .find(({ operation }) => operation === "search_strings");
    expect(capabilities?.limitations).toContain(
      launchRegexMatchingLimitation(
        { deadlineMs: 100, source: "runtime" },
        { heapMiB: 256, source: "runtime" },
      ),
    );
    settings.update({
      changes: [
        { setting: "regex.matching_deadline_ms", action: "set", value: 10000 },
      ],
    });
    const recovered = await settings.run(() =>
      client!.execute("search_strings", { pattern: "!$", mode: "regex" }),
    );
    expect(recovered.ok && recovered.value.result).toEqual([
      expect.objectContaining({ address: "0x3000", value }),
    ]);
    if (recovered.ok) {
      expect(recovered.value.limitations).toContain(
        launchRegexMatchingLimitation(
          { deadlineMs: 10000, source: "runtime" },
          { heapMiB: 256, source: "runtime" },
        ),
      );
    }
  } finally {
    await client?.close();
    await provider?.closeOwnedResources();
    await rm(root, { recursive: true, force: true });
  }
});
