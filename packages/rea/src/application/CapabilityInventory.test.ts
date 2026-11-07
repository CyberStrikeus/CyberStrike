import { sqliteDatabaseCapability } from "./sqlite/SqliteDatabaseCapability.js";
import { persistentDebuggerHostSupported } from "../process/PersistentDebuggerHost.js";
import { pcapCaptureHostSupported } from "../domain/pcap/pcapAnalysis.js";
import { describe, expect, it } from "vitest";

import {
  buildCapabilityInventory,
  compactToolAvailability,
} from "./CapabilityInventory.js";
import { TOOL_CONTRACTS } from "../contracts/toolContracts.js";
import {
  expandToolAvailability,
  toolAvailabilityInventory,
  toolAvailabilitySummaryInventory,
  type ToolAvailability,
} from "../contracts/toolOutputSchemaPrimitives.js";

it("reports module syntax and native resolution availability separately", () => {
  const input = { open: false, capabilities: [] };
  const unavailable = buildCapabilityInventory(input, {
    processCaptureEnabled: false,
  }).find((tool) => tool.name === "trace_web_module_imports");
  expect(unavailable).toMatchObject({
    available: true,
    default_mode_available: false,
    modes: [
      expect.objectContaining({
        name: "sources-without-literal-imports",
        available: true,
      }),
      expect.objectContaining({
        name: "native-literal-resolution",
        available: false,
      }),
    ],
  });
  const enabled = buildCapabilityInventory(input, {
    processCaptureEnabled: false,
    webModuleResolutionEnabled: true,
  }).find((tool) => tool.name === "trace_web_module_imports");
  expect(enabled).toMatchObject({
    available: true,
    default_mode_available: true,
  });
});

const enabledPolicy: Parameters<typeof buildCapabilityInventory>[1] = {
  processCaptureEnabled: true,
  browserObservationEnabled: true,
  browserScenarioEnabled: true,
  electronObservationEnabled: true,
  v8InspectorObservationEnabled: true,
};

const status = (
  options: {
    readonly open?: boolean;
    readonly kind?: "executable" | "database" | "archive" | "artifact";
    readonly format?: string;
    readonly capabilities?: readonly {
      readonly operation: string;
      readonly available: boolean;
      readonly reason: string | null;
      readonly availability_code?: "unsupported_host";
    }[];
  } = {},
) => ({
  open: options.open ?? false,
  ...(options.kind === undefined ? {} : { kind: options.kind }),
  ...(options.format === undefined ? {} : { format: options.format }),
  capabilities:
    options.capabilities === undefined || options.capabilities.length === 0
      ? []
      : [
          {
            provider: { id: "fixture", name: "Fixture", version: "1" },
            shared_limitations: [],
            groups: options.capabilities.map((capability) => ({
              operations: [capability.operation],
              effects: [],
              limitations: [],
              available: capability.available,
              reason: capability.reason,
              availability_code: capability.available
                ? null
                : (capability.availability_code ?? null),
            })),
          },
        ],
});

const entry = (
  name: string,
  sessionStatus: ReturnType<typeof status>,
  policy = enabledPolicy,
) => {
  const found = buildCapabilityInventory(sessionStatus, policy).find(
    (candidate) => candidate.name === name,
  );
  if (found === undefined) throw new Error(`missing capability ${name}`);
  return found;
};

it("reports the active resource session's dispatch policy without limiting independent tools", () => {
  const resourceStatus = {
    ...status({ open: true }),
    session_kind: "bundle_resources",
    capabilities: [
      {
        provider: { id: "bundle-resources", name: "Resources", version: "1" },
        shared_limitations: [],
        groups: [
          {
            operations: [
              "inspect_plist",
              "decode_interface_builder",
              "inspect_asset_catalog",
              "inspect_keyed_archive",
            ],
            effects: [],
            limitations: [],
            available: true,
            reason: null,
            availability_code: null,
          },
        ],
      },
    ],
  };
  const entries = buildCapabilityInventory(resourceStatus, enabledPolicy);
  for (const name of [
    "inspect_artifact",
    "extract_artifact",
    "trace_dylib_resolution",
    "get_navigation_context",
  ])
    expect(entries.find((item) => item.name === name)).toMatchObject({
      available: false,
      reason: "target_unsupported",
      remediation: expect.stringContaining("open_binary"),
    });
  for (const name of [
    "inspect_plist",
    "decode_interface_builder",
    "inspect_asset_catalog",
    "inspect_keyed_archive",
    "inspect_pe_imports",
    "inspect_desktop_application",
    "close_binary",
  ])
    expect(entries.find((item) => item.name === name)).toMatchObject({
      available: true,
    });
  expect(
    entries.find((item) => item.name === "inspect_apk_signature"),
  ).toMatchObject({
    available: true,
    reason: "available",
    remediation: null,
  });
  const sqlite = sqliteDatabaseCapability(process.versions.node);
  expect(
    entries.find((item) => item.name === "inspect_sqlite_database"),
  ).toMatchObject(
    sqlite.available
      ? { available: true }
      : {
          available: false,
          reason: "provider_unavailable",
          remediation: sqlite.reason,
        },
  );
});

describe("ADB and Apktool host availability", () => {
  it("uses only their selected owner probes", () => {
    const ready = {
      status: "available" as const,
      code: null,
      reason: null,
      diagnostics: {},
    };
    const configuredButInvalid = {
      status: "unavailable" as const,
      code: "not_configured" as const,
      reason: "REA_ADB_PATH is invalid",
      diagnostics: {},
    };
    const readyInventory = buildCapabilityInventory(status(), {
      ...enabledPolicy,
      adbAnalysisAvailability: ready,
      apktoolAnalysisAvailability: ready,
    });
    expect(
      readyInventory.find(({ name }) => name === "inspect_adb_client"),
    ).toMatchObject({ available: true, reason: "available" });
    expect(
      readyInventory.find(({ name }) => name === "inspect_apktool_client"),
    ).toMatchObject({ available: true, reason: "available" });

    const unavailableInventory = buildCapabilityInventory(status(), {
      ...enabledPolicy,
      adbAnalysisAvailability: configuredButInvalid,
      apktoolAnalysisAvailability: {
        status: "unavailable",
        code: "unsupported_version",
        reason: "Apktool 2.6.3 is older than 2.7.0",
        diagnostics: {},
      },
    });
    expect(
      unavailableInventory.find(({ name }) => name === "inspect_adb_client"),
    ).toMatchObject({ available: false, reason: "provider_missing" });
    expect(
      unavailableInventory.find(
        ({ name }) => name === "decode_android_resources",
      ),
    ).toMatchObject({ available: false, reason: "provider_unavailable" });
  });
});

describe("capability failure reasons", () => {
  it("keeps an unavailable Android runtime distinct from a missing provider", () => {
    const inventory = buildCapabilityInventory(status(), {
      ...enabledPolicy,
      androidAnalysisAvailability: {
        status: "unavailable",
        code: "runtime_unavailable",
        reason: "The JADX native self-test failed.",
        diagnostics: {},
      },
    });
    expect(
      inventory.find(({ name }) => name === "inspect_android_package"),
    ).toMatchObject({ available: false, reason: "provider_unavailable" });
  });

  it("admits physical universal Mach-O targets for native Mach-O operations", () => {
    expect(
      entry(
        "inspect_native_dispatch_metadata",
        status({
          open: true,
          kind: "executable",
          format: "mach-o-universal",
          capabilities: [
            {
              operation: "inspect_native_dispatch_metadata",
              available: true,
              reason: null,
            },
          ],
        }),
      ),
    ).toMatchObject({ available: true, reason: "available" });
  });

  it.each([
    {
      label: "requires a target",
      name: "current_address",
      sessionStatus: status(),
      reason: "target_required",
      remediation: "open_binary",
    },
    {
      label: "rejects an incompatible target family",
      name: "current_address",
      sessionStatus: status({ open: true, kind: "archive" }),
      reason: "target_unsupported",
      remediation: "native executable",
    },
    {
      label: "reports a missing provider operation",
      name: "current_address",
      sessionStatus: status({ open: true, kind: "executable" }),
      reason: "provider_missing",
      remediation: "provider",
    },
    {
      label: "distinguishes an unsupported host",
      name: "current_address",
      sessionStatus: status({
        open: true,
        kind: "executable",
        capabilities: [
          {
            operation: "current_address",
            available: false,
            availability_code: "unsupported_host",
            reason: "Operation requires macOS",
          },
        ],
      }),
      reason: "unsupported_host",
      remediation: "macOS",
    },
    {
      label: "retains a provider failure",
      name: "current_address",
      sessionStatus: status({
        open: true,
        kind: "executable",
        capabilities: [
          {
            operation: "current_address",
            available: false,
            reason: "Provider session is unhealthy",
          },
        ],
      }),
      reason: "provider_unavailable",
      remediation: "unhealthy",
    },
    {
      label: "reports an available provider operation",
      name: "current_address",
      sessionStatus: status({
        open: true,
        kind: "executable",
        capabilities: [
          {
            operation: "current_address",
            available: true,
            reason: null,
          },
        ],
      }),
      reason: "available",
      remediation: null,
    },
  ])("$label", ({ name, sessionStatus, reason, remediation }) => {
    const availability = entry(name, sessionStatus);
    expect(availability).toMatchObject({
      reason,
      available: reason === "available",
    });
    if (remediation === null) expect(availability.remediation).toBeNull();
    else expect(availability.remediation).toContain(remediation);
  });
});

describe("compact tool availability", () => {
  it("round-trips complete facts, omitted modes, and per-group client requirements", () => {
    const full = buildCapabilityInventory(status(), enabledPolicy);
    const alternateRequirements = {
      required: ["roots"],
      optional: [],
      missing_required: ["roots"],
      missing_optional: [],
    } satisfies ToolAvailability["client_requirements"];
    const withOverride = full.map((entry, index) =>
      index === 1
        ? {
            ...entry,
            available: false as const,
            reason: "client_capability_missing" as const,
            remediation: "Use an MCP client with roots support.",
            client_requirements: alternateRequirements,
          }
        : entry,
    );
    const compact = compactToolAvailability(withOverride);
    const expanded = expandToolAvailability(compact).toSorted((left, right) =>
      left.name.localeCompare(right.name),
    );

    expect(expanded).toEqual(
      withOverride.toSorted((left, right) =>
        left.name.localeCompare(right.name),
      ),
    );
    expect(compact.client_requirements).toEqual(
      withOverride[0]?.client_requirements,
    );
    expect(
      compact.groups.find((group) => group.client_requirements !== undefined)
        ?.client_requirements,
    ).toEqual(alternateRequirements);
    expect(compact.groups.every((group) => group.names.length > 0)).toBe(true);
    const names = compact.groups.flatMap((group) => group.names).sort();
    expect(names).toEqual(TOOL_CONTRACTS.map(({ name }) => name).sort());
    expect(new Set(names).size).toBe(names.length);
    expect(expanded.some((entry) => !Object.hasOwn(entry, "modes"))).toBe(true);
  });

  it("preserves an empty inventory with an explicit empty client baseline", () => {
    const compact = compactToolAvailability([]);
    expect(compact).toEqual({
      client_requirements: {
        required: [],
        optional: [],
        missing_required: [],
        missing_optional: [],
      },
      groups: [],
    });
    expect(expandToolAvailability(compact)).toEqual([]);
  });

  it("rejects malformed compact facts and accepts an equivalent explicit baseline", () => {
    const compact = compactToolAvailability(
      buildCapabilityInventory(status(), enabledPolicy),
    );
    const firstGroup = compact.groups[0];
    expect(firstGroup).toBeDefined();
    if (firstGroup === undefined) throw new Error("Expected tool groups");
    const availableIndex = compact.groups.findIndex((group) => group.available);
    if (availableIndex < 0) throw new Error("Expected an available tool group");

    const malformedInventories = [
      {
        ...compact,
        groups: compact.groups.map((group, index) =>
          index === 0
            ? { ...group, effects: [...group.effects, "unknown_effect"] }
            : group,
        ),
      },
      {
        ...compact,
        groups: compact.groups.map((group, index) =>
          index === 0
            ? {
                ...group,
                annotations: [...group.annotations, "unknown_hint"],
              }
            : group,
        ),
      },
      {
        ...compact,
        groups: compact.groups.map((group, index) =>
          index === 0 ? { ...group, names: [] } : group,
        ),
      },
      {
        ...compact,
        groups: compact.groups.map((group, index) =>
          index === 0 ? { ...group, names: [""] } : group,
        ),
      },
      {
        ...compact,
        groups: compact.groups.map((group, index) =>
          index === availableIndex
            ? { ...group, reason: "provider_missing" }
            : group,
        ),
      },
      {
        ...compact,
        groups: compact.groups.map((group, index) =>
          index === availableIndex
            ? { ...group, remediation: "unexpected remediation" }
            : group,
        ),
      },
    ];
    for (const malformed of malformedInventories)
      expect(toolAvailabilityInventory.safeParse(malformed).success).toBe(
        false,
      );

    const inheritedGroup = compact.groups.find(
      (group) => group.client_requirements === undefined,
    );
    expect(inheritedGroup).toBeDefined();
    if (inheritedGroup === undefined)
      throw new Error("Expected an inherited client-requirements group");
    const explicitBaseline = {
      ...compact,
      groups: compact.groups.map((group) =>
        group === inheritedGroup
          ? { ...group, client_requirements: compact.client_requirements }
          : group,
      ),
    };
    const parsedOverride =
      toolAvailabilityInventory.safeParse(explicitBaseline);
    expect(parsedOverride.success).toBe(true);
    if (parsedOverride.success)
      expect(expandToolAvailability(parsedOverride.data)).toEqual(
        expandToolAvailability(compact),
      );
  });
});

describe("partial navigation availability", () => {
  it("requires a target before diagnosing navigation provider modes", () => {
    expect(entry("get_navigation_context", status())).toMatchObject({
      available: false,
      reason: "target_required",
      default_mode_available: false,
      modes: [
        { name: "current_selection", available: false },
        { name: "explicit_document", available: false },
      ],
    });
    expect(
      TOOL_CONTRACTS.find((tool) => tool.name === "get_navigation_context"),
    ).toMatchObject({
      requiresActiveTarget: true,
    });
  });
  it("allows explicit documents when the provider has no current-document getter", () => {
    const capabilities = [
      "current_document",
      "current_address",
      "resolve_containing_procedure",
    ].map((operation) => ({
      operation,
      available: true,
      reason: null,
    }));
    expect(
      entry(
        "get_navigation_context",
        status({ open: true, kind: "executable", capabilities }),
      ),
    ).toMatchObject({
      available: true,
      reason: "available",
      default_mode_available: true,
      modes: [
        { name: "current_selection", available: true },
        { name: "explicit_document", available: true },
      ],
    });
    expect(
      entry(
        "get_navigation_context",
        status({
          open: true,
          kind: "executable",
          capabilities: capabilities.slice(1),
        }),
      ),
    ).toMatchObject({
      available: true,
      reason: "available",
      default_mode_available: false,
      modes: [
        { name: "current_selection", available: false },
        { name: "explicit_document", available: true },
      ],
    });
    expect(
      entry(
        "get_navigation_context",
        status({
          open: true,
          kind: "executable",
          capabilities: capabilities.slice(1, 2),
        }),
      ),
    ).toMatchObject({
      available: false,
      reason: "provider_missing",
      remediation: expect.stringContaining("resolve_containing_procedure"),
    });
  });

  it("preserves the most specific navigation mode failure", () => {
    expect(
      entry(
        "get_navigation_context",
        status({
          open: true,
          kind: "executable",
          capabilities: [
            {
              operation: "current_address",
              available: false,
              availability_code: "unsupported_host",
              reason: "Navigation requires macOS.",
            },
            {
              operation: "resolve_containing_procedure",
              available: true,
              reason: null,
            },
          ],
        }),
      ),
    ).toMatchObject({
      available: false,
      reason: "unsupported_host",
      remediation: "Navigation requires macOS.",
    });
  });

  it("lists shared missing operations once in combined remediation", () => {
    const availability = entry(
      "get_navigation_context",
      status({ open: true, kind: "executable" }),
    );

    expect(availability).toMatchObject({
      reason: "provider_missing",
      remediation:
        "Configure a provider for one of: current_document, current_address, resolve_containing_procedure.",
      modes: [
        {
          name: "current_selection",
          missing_operations: [
            "current_document",
            "current_address",
            "resolve_containing_procedure",
          ],
        },
        {
          name: "explicit_document",
          missing_operations: [
            "current_address",
            "resolve_containing_procedure",
          ],
        },
      ],
    });
  });
});

it("reports host denial before target mismatch but keeps composed workflow prerequisites", () => {
  const capability = {
    operation: "inspect_macho",
    available: false,
    availability_code: "unsupported_host" as const,
    reason: "Native macOS utilities require macOS.",
  };
  for (const target of [
    {},
    { open: true, kind: "archive" as const, format: "zip" },
  ]) {
    expect(
      entry("inspect_macho", status({ ...target, capabilities: [capability] })),
    ).toMatchObject({
      reason: "unsupported_host",
      remediation: capability.reason,
    });
  }
  expect(
    entry(
      "inspect_native_dispatch_metadata",
      status({
        capabilities: [
          { ...capability, operation: "inspect_native_dispatch_metadata" },
        ],
      }),
    ).reason,
  ).toBe("target_required");
});

describe("binary_overview capability requirements", () => {
  it("admits a native overview without requiring full inventory operations", () => {
    expect(
      entry(
        "binary_overview",
        status({
          open: true,
          kind: "executable",
          capabilities: [
            {
              operation: "read_binary_inventory_summary",
              available: true,
              reason: null,
            },
          ],
        }),
      ),
    ).toMatchObject({ available: true, reason: "available" });
  });
  it("admits a provider with current_document and other mandatory capabilities", () => {
    const capabilities = [
      "current_document",
      "list_procedures",
      "list_strings",
    ].map((operation) => ({ operation, available: true, reason: null }));
    expect(
      entry(
        "binary_overview",
        status({ open: true, kind: "executable", capabilities }),
      ),
    ).toMatchObject({
      available: true,
      reason: "available",
      remediation: null,
    });
  });

  it("admits a provider with list_documents and other mandatory capabilities", () => {
    const capabilities = [
      "list_documents",
      "list_procedures",
      "list_strings",
    ].map((operation) => ({ operation, available: true, reason: null }));
    expect(
      entry(
        "binary_overview",
        status({ open: true, kind: "executable", capabilities }),
      ),
    ).toMatchObject({
      available: true,
      reason: "available",
      remediation: null,
    });
  });

  it("reports document selection remediation when neither current_document nor list_documents is declared", () => {
    const capabilities = [
      "list_segments",
      "list_procedures",
      "list_strings",
    ].map((operation) => ({ operation, available: true, reason: null }));
    expect(
      entry(
        "binary_overview",
        status({ open: true, kind: "executable", capabilities }),
      ),
    ).toMatchObject({
      available: false,
      reason: "provider_missing",
      remediation:
        "Configure a provider for one of: current_document, list_documents.",
    });
  });

  it("keeps binary overview available when a declared segment facet is unavailable", () => {
    const capabilities = [
      {
        operation: "list_segments",
        available: false,
        reason: "This upstream profile does not expose segment enumeration.",
      },
      { operation: "list_documents", available: true, reason: null },
      { operation: "list_procedures", available: true, reason: null },
      { operation: "list_strings", available: true, reason: null },
    ];
    expect(
      entry(
        "binary_overview",
        status({ open: true, kind: "executable", capabilities }),
      ),
    ).toMatchObject({ available: true, reason: "available" });
  });

  it("reports provider_unavailable when declared document selection capability is unavailable", () => {
    const capabilities = [
      { operation: "list_segments", available: true, reason: null },
      {
        operation: "current_document",
        available: false,
        reason: "Document view is closed",
      },
      { operation: "list_procedures", available: true, reason: null },
      { operation: "list_strings", available: true, reason: null },
    ];
    expect(
      entry(
        "binary_overview",
        status({ open: true, kind: "executable", capabilities }),
      ),
    ).toMatchObject({
      available: false,
      reason: "provider_unavailable",
      remediation: "Document view is closed",
    });
  });
});

describe("trace_feature requirements", () => {
  const capabilities = (operations: readonly string[]) =>
    operations.map((operation) => ({
      operation,
      available: true,
      reason: null,
    }));

  it("needs the search operations the workflow actually calls", () => {
    expect(
      entry(
        "trace_feature",
        status({
          open: true,
          kind: "executable",
          capabilities: capabilities([
            "search_strings",
            "search_procedures",
            "xrefs",
            "resolve_containing_procedure",
          ]),
        }),
      ),
    ).toMatchObject({ available: true, reason: "available" });
  });

  it.each(["search_strings", "search_procedures"])(
    "is unavailable without %s",
    (missing) => {
      const operations = [
        "search_strings",
        "search_procedures",
        "xrefs",
        "resolve_containing_procedure",
      ].filter((operation) => operation !== missing);

      expect(
        entry(
          "trace_feature",
          status({
            open: true,
            kind: "executable",
            capabilities: capabilities(operations),
          }),
        ),
      ).toMatchObject({ available: false, reason: "provider_missing" });
    },
  );

  it("is unavailable when only the list operations exist", () => {
    expect(
      entry(
        "trace_feature",
        status({
          open: true,
          kind: "executable",
          capabilities: capabilities([
            "list_strings",
            "list_procedures",
            "xrefs",
            "resolve_containing_procedure",
          ]),
        }),
      ),
    ).toMatchObject({ available: false, reason: "provider_missing" });
  });
});

const HOST_RESTRICTED_TOOLS = [
  ["inspect_packet_capture", "packetCapture", "packetCaptureEnabled"],
  ["inspect_packet_fields", "packetCapture", "packetCaptureEnabled"],
  ["decode_signal_recording", "signalRecording", "signalRecordingEnabled"],
  ["inspect_signal_decoders", "signalRecording", "signalRecordingEnabled"],
  ["inspect_evm_interface", "evmInterface", "evmInterfaceEnabled"],
  ["inspect_binary_layout", "binaryLayout", "binaryLayoutEnabled"],
  ["inspect_recorded_crash", "recordedCrash", "recordedCrashEnabled"],
  [
    "inspect_firmware_regions",
    "firmwareInspection",
    "firmwareInspectionEnabled",
  ],
  ["extract_firmware", "firmwareExtraction", "firmwareExtractionEnabled"],
  [
    "recover_javascript_sources",
    "javascriptRecovery",
    "javascriptRecoveryEnabled",
  ],
] as const;

describe("host-restricted integrations", () => {
  it.each(HOST_RESTRICTED_TOOLS)(
    "reports %s on an unsupported host before its configuration",
    (name, feature, enabledField) => {
      const availability = (enabled: boolean, hostUnsupported: boolean) =>
        buildCapabilityInventory(
          { open: false, capabilities: [] },
          {
            processCaptureEnabled: true,
            ...({ [enabledField]: enabled } as Record<
              typeof enabledField,
              boolean
            >),
            hostUnsupported: { [feature]: hostUnsupported },
          },
        ).find((tool) => tool.name === name);
      expect(availability(true, true)).toMatchObject({
        available: false,
        reason: "unsupported_host",
      });
      expect(availability(false, false)).toMatchObject({
        available: false,
        reason: "provider_missing",
      });
      expect(availability(true, false)).toMatchObject({
        available: true,
        reason: "available",
      });
    },
  );
});

it.each(["darwin", "linux", "win32"])(
  "distinguishes pcap capture host support from its target-free client probe on %s",
  (platform) => {
    const tools = buildCapabilityInventory(
      { open: false, capabilities: [] },
      {
        processCaptureEnabled: true,
        hostUnsupported: { pcapCapture: !pcapCaptureHostSupported(platform) },
      },
    );
    expect(
      tools.find(({ name }) => name === "inspect_pcap_client"),
    ).toMatchObject({ available: true, reason: "available" });
    expect(
      tools.find(({ name }) => name === "inspect_pcap_capture"),
    ).toMatchObject(
      platform === "darwin"
        ? {
            available: false,
            reason: "unsupported_host",
            remediation: expect.stringContaining("native memory bound"),
          }
        : { available: true, reason: "available" },
    );
  },
);

it("keeps independent native sessions discoverable without an unrelated binary target", () => {
  const entries = buildCapabilityInventory(status(), enabledPolicy);
  for (const name of [
    "list_cutter_sessions",
    "cutter_command",
    "start_gdb_session",
    "gdb_console",
    "gdb_session_status",
    "close_gdb_session",
    "start_rizin_debug_session",
    "rizin_debug_command",
    "rizin_debug_session_status",
    "close_rizin_debug_session",
    "inspect_with_objdump",
    "execute_rizin_command",
  ]) {
    expect(
      entries.find((entry) => entry.name === name),
      name,
    ).toMatchObject({ available: true });
  }
  expect(entries.find((entry) => entry.name === "inspect_macho")).toMatchObject(
    { available: false, reason: "target_required" },
  );
});

it.each(["darwin", "linux", "win32"] as const)(
  "reports the persistent debugger start host restriction on %s",
  (platform) => {
    const entries = buildCapabilityInventory(status(), {
      ...enabledPolicy,
      hostUnsupported: {
        persistentDebugger: !persistentDebuggerHostSupported(platform),
      },
    });
    for (const name of ["start_gdb_session", "start_rizin_debug_session"])
      expect(entries.find((entry) => entry.name === name)).toMatchObject(
        platform === "linux"
          ? { available: true, reason: "available" }
          : {
              available: false,
              reason: "unsupported_host",
              remediation: expect.stringContaining("Linux"),
            },
      );
    for (const name of ["gdb_session_status", "close_rizin_debug_session"])
      expect(entries.find((entry) => entry.name === name)).toMatchObject({
        available: true,
      });
  },
);

describe("summary tool availability", () => {
  it("summarizes every tool's current availability without static catalog flags", () => {
    const full = buildCapabilityInventory(status(), enabledPolicy);
    const withOverride = full.map((entry, index) =>
      index === 1
        ? {
            ...entry,
            available: false as const,
            reason: "client_capability_missing" as const,
            remediation: "Use an MCP client with roots support.",
            client_requirements: {
              required: ["roots" as const],
              optional: [],
              missing_required: ["roots" as const],
              missing_optional: [],
            },
          }
        : entry,
    );
    const complete = compactToolAvailability(withOverride);
    const summary = compactToolAvailability(withOverride, "summary");

    expect(toolAvailabilitySummaryInventory.parse(summary)).toEqual(summary);
    expect(toolAvailabilityInventory.safeParse(summary).success).toBe(false);
    expect(summary.groups.length).toBeLessThan(complete.groups.length);
    expect(JSON.stringify(summary).length).toBeLessThan(
      JSON.stringify(complete).length / 2,
    );
    for (const group of summary.groups)
      for (const field of ["surface", "effects", "annotations"])
        expect(Object.hasOwn(group, field)).toBe(false);
    const byName = (left: { name: string }, right: { name: string }) =>
      left.name.localeCompare(right.name);
    expect(expandToolAvailability(summary).toSorted(byName)).toEqual(
      withOverride
        .map(({ surface: _s, effects: _e, annotations: _a, ...entry }) => entry)
        .toSorted(byName),
    );
  });
});
