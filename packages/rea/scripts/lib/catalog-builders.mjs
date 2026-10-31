import { names } from "./catalog-core.mjs";

/** Build tool-family counts and sorted tool-name lists. */
export const toolFamilyCatalog = (sources) => {
  const families = sources.toolFamilies.TOOL_FAMILY_DEFINITIONS.map(
    ({ id, surface, contracts }) => ({
      id,
      surface,
      count: contracts.length,
      tools: names(contracts),
    }),
  );
  const familyTotal = families.reduce(
    (total, family) => total + family.count,
    0,
  );
  if (
    familyTotal !== sources.toolContracts.TOOL_CONTRACTS.length ||
    familyTotal !==
      sources.catalogIdentity.FULL_CATALOG_IDENTITY.counts.mcp_tools
  )
    throw new Error("Tool family inventory does not match TOOL_CONTRACTS");
  return { total: familyTotal, families };
};

/** Build provider identities with their sorted capability names. */
export const providerCatalog = (sources) => {
  const contractsByName = new Map(
    sources.toolContracts.TOOL_CONTRACTS.map((contract) => [
      contract.name,
      contract,
    ]),
  );
  const declaredContracts = (providerId, operations) =>
    operations.map((operation) => {
      const contract = contractsByName.get(operation);
      if (contract === undefined)
        throw new TypeError(
          `Provider ${providerId} declares an unknown analyst operation: ${operation}`,
        );
      return contract;
    });
  const {
    applicationContracts,
    reconciliationContracts,
    observationContracts,
    activeContracts,
    fuseContracts,
  } = electronContractSlices(sources);
  return [
    {
      identity: sources.cutterProvider.CUTTER_PROVIDER_IDENTITY,
      contracts: sources.cutterContracts.CUTTER_TOOL_CONTRACTS,
    },
    {
      identity: sources.objdumpProvider.OBJDUMP_PROVIDER_IDENTITY,
      contracts:
        sources.reverseEngineeringContracts.REVERSE_ENGINEERING_TOOL_CONTRACTS.filter(
          ({ name }) => name === "inspect_with_objdump",
        ),
    },
    {
      identity: sources.rizinProvider.RIZIN_PROVIDER_IDENTITY,
      contracts:
        sources.reverseEngineeringContracts.REVERSE_ENGINEERING_TOOL_CONTRACTS.filter(
          ({ name }) => name === "execute_rizin_command",
        ),
    },
    {
      identity: sources.gdbProvider.GDB_PROVIDER_IDENTITY,
      contracts: sources.gdbContracts.GDB_TOOL_CONTRACTS,
    },
    {
      identity: sources.rizinDebugProvider.RIZIN_DEBUGGER_PROVIDER_IDENTITY,
      contracts: sources.rizinDebugContracts.RIZIN_DEBUG_TOOL_CONTRACTS,
    },
    {
      identity: sources.fridaProvider.FRIDA_PROVIDER_IDENTITY,
      contracts: sources.fridaContracts.FRIDA_TOOL_CONTRACTS,
    },
    {
      identity: sources.hopperProvider.HOPPER_PROVIDER_IDENTITY,
      contracts: declaredContracts(
        "hopper",
        sources.hopperProvider.HOPPER_OPERATIONS,
      ),
    },
    {
      identity: sources.ghidraProvider.GHIDRA_PROVIDER_IDENTITY,
      contracts: declaredContracts(
        "ghidra",
        sources.ghidraProvider.GHIDRA_OPERATIONS,
      ),
    },
    {
      identity: sources.idaProvider.IDA_PROVIDER_IDENTITY,
      contracts: declaredContracts("ida", sources.idaProvider.IDA_OPERATIONS),
    },
    {
      identity: sources.kunaProvider.KUNA_PROVIDER_IDENTITY,
      contracts: declaredContracts(
        "kuna",
        sources.kunaProvider.KUNA_OPERATIONS,
      ),
    },
    {
      identity: sources.nativeProvider.NATIVE_MACOS_PROVIDER_IDENTITY,
      contracts: sources.nativeContracts.NATIVE_TOOL_CONTRACTS,
    },
    {
      identity: sources.pwntoolsProvider.PWNTOOLS_PROVIDER_IDENTITY,
      contracts:
        sources.binaryDiagnosticsContracts.BINARY_DIAGNOSTICS_TOOL_CONTRACTS.filter(
          ({ name }) =>
            name === "inspect_binary_layout" ||
            name === "inspect_recorded_crash",
        ),
    },
    {
      identity: sources.artifactProviders.PE_RESOURCES_PROVIDER,
      contracts:
        sources.binaryDiagnosticsContracts.BINARY_DIAGNOSTICS_TOOL_CONTRACTS.filter(
          ({ name }) => name === "inspect_pe_resources",
        ),
    },
    {
      identity: sources.artifactProviders.PE_CERTIFICATES_PROVIDER,
      contracts:
        sources.binaryDiagnosticsContracts.BINARY_DIAGNOSTICS_TOOL_CONTRACTS.filter(
          ({ name }) => name === "inspect_pe_certificates",
        ),
    },
    {
      identity: sources.artifactProviders.PE_IMPORTS_PROVIDER,
      contracts:
        sources.binaryDiagnosticsContracts.BINARY_DIAGNOSTICS_TOOL_CONTRACTS.filter(
          ({ name }) => name === "inspect_pe_imports",
        ),
    },
    {
      identity: sources.artifactProviders.DEVICETREE_PROVIDER,
      contracts:
        sources.binaryDiagnosticsContracts.BINARY_DIAGNOSTICS_TOOL_CONTRACTS.filter(
          ({ name }) => name === "inspect_devicetree",
        ),
    },
    {
      identity: sources.artifactProviders.PE_LOAD_CONFIG_PROVIDER,
      contracts:
        sources.binaryDiagnosticsContracts.BINARY_DIAGNOSTICS_TOOL_CONTRACTS.filter(
          ({ name }) => name === "inspect_pe_load_config",
        ),
    },
    {
      identity: sources.artifactProviders.ELF_NOTES_PROVIDER,
      contracts:
        sources.binaryDiagnosticsContracts.BINARY_DIAGNOSTICS_TOOL_CONTRACTS.filter(
          ({ name }) => name === "inspect_elf_notes",
        ),
    },
    {
      identity: sources.artifactProviders.APPLE_IPS_PROVIDER,
      contracts:
        sources.binaryDiagnosticsContracts.BINARY_DIAGNOSTICS_TOOL_CONTRACTS.filter(
          ({ name }) => name === "inspect_apple_ips",
        ),
    },
    {
      identity: sources.artifactProviders.KERNEL_MODULE_PROVIDER,
      contracts:
        sources.binaryDiagnosticsContracts.BINARY_DIAGNOSTICS_TOOL_CONTRACTS.filter(
          ({ name }) => name === "inspect_kernel_module",
        ),
    },
    {
      identity: sources.artifactProviders.BYTE_ENTROPY_PROVIDER,
      contracts:
        sources.binaryDiagnosticsContracts.BINARY_DIAGNOSTICS_TOOL_CONTRACTS.filter(
          ({ name }) => name === "inspect_byte_entropy",
        ),
    },
    {
      identity: sources.artifactProviders.NATIVE_EXPORTS_PROVIDER,
      contracts:
        sources.binaryDiagnosticsContracts.BINARY_DIAGNOSTICS_TOOL_CONTRACTS.filter(
          ({ name }) => name === "inspect_native_exports",
        ),
    },
    {
      identity: sources.captureProvider.TSHARK_PROVIDER_IDENTITY,
      contracts: sources.captureContracts.CAPTURE_TOOL_CONTRACTS,
    },
    {
      identity: sources.signalProvider.SIGROK_PROVIDER_IDENTITY,
      contracts: sources.signalContracts.SIGNAL_TOOL_CONTRACTS,
    },
    {
      identity: sources.wasmProvider.WABT_PROVIDER_IDENTITY,
      contracts: sources.wasmContracts.WASM_TOOL_CONTRACTS.filter(
        ({ kind }) => kind === "artifact-provider",
      ),
    },
    {
      identity: sources.apkSignatureProvider.APK_SIGNATURE_PROVIDER_IDENTITY,
      contracts: sources.apkSignatureContracts.APK_SIGNATURE_TOOL_CONTRACTS,
    },
    {
      identity: sources.evmProvider.EVMOLE_PROVIDER_IDENTITY,
      contracts: sources.evmContracts.EVM_TOOL_CONTRACTS,
    },
    {
      identity: sources.goProvider.GO_BINARY_PROVIDER_IDENTITY,
      contracts: sources.goContracts.GO_TOOL_CONTRACTS,
    },
    {
      identity: sources.gpuProvider.GPU_CODE_OBJECTS_PROVIDER_IDENTITY,
      contracts: sources.gpuContracts.GPU_TOOL_CONTRACTS,
    },
    {
      identity: sources.il2cppProvider.IL2CPP_METADATA_PROVIDER_IDENTITY,
      contracts: sources.il2cppContracts.IL2CPP_TOOL_CONTRACTS,
    },
    {
      identity: sources.modelProvider.MODEL_ARTIFACT_PROVIDER_IDENTITY,
      contracts: sources.modelContracts.MODEL_TOOL_CONTRACTS,
    },
    {
      identity: sources.rustProvider.RUST_BINARY_PROVIDER_IDENTITY,
      contracts: sources.rustContracts.RUST_TOOL_CONTRACTS,
    },
    {
      identity: sources.pythonPycProvider.PYTHON_PYC_PROVIDER_IDENTITY,
      contracts: sources.pythonPycContracts.PYTHON_PYC_TOOL_CONTRACTS,
    },
    {
      identity: sources.erlangProvider.ERLANG_BEAM_PROVIDER_IDENTITY,
      contracts: sources.erlangContracts.ERLANG_BEAM_TOOL_CONTRACTS,
    },
    {
      identity: sources.electronFuseProvider.ELECTRON_FUSE_PROVIDER_IDENTITY,
      contracts: fuseContracts,
    },
    {
      identity: sources.sqliteDomain.SQLITE_PROVIDER_IDENTITY,
      contracts: sources.sqliteContracts.SQLITE_TOOL_CONTRACTS,
    },
    {
      identity: sources.artifactProviders.ARTIFACT_GRAPH_PROVIDER,
      contracts: [
        ...sources.artifactContracts.ARTIFACT_TOOL_CONTRACTS,
        ...sources.desktopContracts.DESKTOP_APPLICATION_TOOL_CONTRACTS,
      ],
    },
    {
      identity: sources.artifactProviders.MANAGED_STATIC_PROVIDER,
      contracts: sources.managedContracts.MANAGED_TOOL_CONTRACTS,
    },
    {
      identity: sources.artifactProviders.MANAGED_WORKFLOW_PROVIDER,
      contracts:
        sources.managedWorkflowContracts.MANAGED_WORKFLOW_TOOL_CONTRACTS,
    },
    {
      identity: sources.firmwareProvider.BINWALK_PROVIDER_IDENTITY,
      contracts: sources.firmwareContracts.FIRMWARE_TOOL_CONTRACTS.filter(
        ({ name }) => name === "inspect_firmware_regions",
      ),
    },
    {
      identity: sources.firmwareProvider.UNBLOB_PROVIDER_IDENTITY,
      contracts: sources.firmwareContracts.FIRMWARE_TOOL_CONTRACTS.filter(
        ({ name }) => name === "extract_firmware",
      ),
    },
    {
      identity: sources.androidProvider.JADX_PROVIDER_IDENTITY,
      contracts: sources.androidContracts.ANDROID_TOOL_CONTRACTS,
    },
    {
      identity: sources.pcapProvider.PCAP_PROVIDER_IDENTITY,
      contracts: sources.pcapContracts.PCAP_TOOL_CONTRACTS,
    },
    {
      identity: sources.flutterProvider.FLUTTER_PROVIDER_IDENTITY,
      contracts: sources.flutterContracts.FLUTTER_TOOL_CONTRACTS,
    },
    {
      identity: sources.apktoolProvider.APKTOOL_PROVIDER_IDENTITY,
      contracts: sources.apktoolContracts.APKTOOL_TOOL_CONTRACTS,
    },
    {
      identity: sources.jebProvider.JEB_PROVIDER_IDENTITY,
      contracts: sources.jebContracts.JEB_TOOL_CONTRACTS,
    },
    {
      identity: sources.adbProvider.ADB_PROVIDER_IDENTITY,
      contracts: sources.adbContracts.ADB_TOOL_CONTRACTS,
    },
    {
      identity: sources.webNetworkCaptureProvider.HAR_CAPTURE_PROVIDER_IDENTITY,
      contracts:
        sources.webNetworkCaptureContracts.WEB_NETWORK_CAPTURE_TOOL_CONTRACTS,
    },
    {
      identity: sources.webNetworkCaptureProvider.SAZ_CAPTURE_PROVIDER_IDENTITY,
      contracts:
        sources.webNetworkCaptureContracts.WEB_NETWORK_CAPTURE_TOOL_CONTRACTS,
    },
    {
      identity:
        sources.webNetworkCaptureProvider.MITMPROXY_CAPTURE_PROVIDER_IDENTITY,
      contracts:
        sources.webNetworkCaptureContracts.WEB_NETWORK_CAPTURE_TOOL_CONTRACTS,
    },
    {
      identity: sources.browserIdentities.CDP_BROWSER_PROVIDER_IDENTITY,
      contracts: [
        ...sources.browserContracts.BROWSER_TOOL_CONTRACTS,
        ...sources.webRuntimeContracts.WEB_RUNTIME_TOOL_CONTRACTS,
      ],
    },
    {
      identity:
        sources.browserIdentities.PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY,
      contracts:
        sources.browserScenarioContracts.BROWSER_SCENARIO_TOOL_CONTRACTS,
    },
    {
      identity: sources.browserIdentities.CDP_ELECTRON_PROVIDER_IDENTITY,
      contracts: observationContracts,
    },
    {
      identity:
        sources.browserIdentities.PLAYWRIGHT_ELECTRON_ACTIVE_PROVIDER_IDENTITY,
      contracts: activeContracts,
    },
    {
      identity: sources.v8InspectorProvider.V8_INSPECTOR_PROVIDER_IDENTITY,
      contracts:
        sources.javascriptRuntimeObservationContracts
          .JAVASCRIPT_RUNTIME_OBSERVATION_TOOL_CONTRACTS,
    },
    {
      identity: sources.artifactProviders.JAVASCRIPT_APPLICATION_PROVIDER,
      contracts: applicationContracts,
    },
    {
      identity:
        sources.artifactProviders.JAVASCRIPT_RUNTIME_RECONCILIATION_PROVIDER,
      contracts: reconciliationContracts,
    },
    {
      identity:
        sources.artifactProviders.JAVASCRIPT_APPLICATION_WORKFLOW_PROVIDER,
      contracts: sources.applicationContracts.APPLICATION_TOOL_CONTRACTS.filter(
        ({ name }) =>
          name !== "project_android_application_graph" &&
          name !== "project_apple_application_graph",
      ),
    },
    {
      identity: sources.artifactProviders.ANALYSIS_VIEW_PROVIDER,
      contracts: sources.analysisViewContracts.ANALYSIS_VIEW_TOOL_CONTRACTS,
    },
    {
      identity: sources.artifactProviders.ANDROID_APPLICATION_PROVIDER,
      contracts: sources.applicationContracts.APPLICATION_TOOL_CONTRACTS.filter(
        ({ name }) => name === "project_android_application_graph",
      ),
    },
    {
      identity: sources.artifactProviders.APPLE_APPLICATION_PROVIDER,
      contracts: sources.applicationContracts.APPLICATION_TOOL_CONTRACTS.filter(
        ({ name }) => name === "project_apple_application_graph",
      ),
    },
    {
      identity: sources.artifactProviders.WEB_SCRIPT_EXPORT_PROVIDER,
      contracts: sources.webScriptContracts.WEB_SCRIPT_TOOL_CONTRACTS,
    },
    {
      identity: sources.javascriptRecoveryProvider.WAKARU_PROVIDER_IDENTITY,
      contracts:
        sources.javascriptRecoveryContracts.JAVASCRIPT_RECOVERY_TOOL_CONTRACTS,
    },
  ]
    .map(({ identity, contracts }) => ({
      id: identity.id,
      name: identity.name,
      version: identity.version,
      capabilities: names(contracts),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

const electronContractSlices = (sources) => {
  const applicationContracts =
    sources.electronContracts.ELECTRON_TOOL_CONTRACTS.filter(
      ({ name }) => name === "analyze_javascript_application",
    );
  const reconciliationContracts =
    sources.electronContracts.ELECTRON_TOOL_CONTRACTS.filter(
      ({ name }) => name === "reconcile_javascript_runtime",
    );
  const observationContracts =
    sources.electronContracts.ELECTRON_TOOL_CONTRACTS.filter(
      ({ name }) =>
        name !== "analyze_javascript_application" &&
        name !== "reconcile_javascript_runtime" &&
        name !== "capture_electron_scenario" &&
        name !== "inspect_electron_fuses",
    );
  const activeContracts =
    sources.electronContracts.ELECTRON_TOOL_CONTRACTS.filter(
      ({ name }) => name === "capture_electron_scenario",
    );
  const fuseContracts =
    sources.electronContracts.ELECTRON_TOOL_CONTRACTS.filter(
      ({ name }) => name === "inspect_electron_fuses",
    );
  if (
    applicationContracts.length !== 1 ||
    reconciliationContracts.length !== 1 ||
    observationContracts.length !== 2 ||
    activeContracts.length !== 1 ||
    fuseContracts.length !== 1
  )
    throw new Error("Electron provider capability ownership drifted");
  return {
    applicationContracts,
    reconciliationContracts,
    observationContracts,
    activeContracts,
    fuseContracts,
  };
};
