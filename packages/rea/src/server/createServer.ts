import { registerToolFamilies } from "../contracts/toolFamilyIds.js";
import { AnalysisSettings } from "../application/AnalysisSettings.js";
import { parseMcpInputBudget } from "../config/mcpInputBudget.js";
import { registerAnalysisSettingsTools } from "./registerAnalysisSettingsTools.js";
import { registerDevicetreeTool } from "./registerDevicetreeTool.js";
import { pcapCaptureHostSupported } from "../domain/pcap/pcapAnalysis.js";
import { createGpuCodeObjectsService } from "../composition/gpu.js";
import { registerGpuCodeObjectsTools } from "./registerGpuCodeObjectsTools.js";
import type { PacketCaptureService } from "../application/captures/PacketCaptureService.js";
import { serverInstructions } from "./serverInstructions.js";
import {
  createPacketCaptureService,
  tsharkHostSupported,
} from "../composition/captures.js";
import { registerCaptureTools } from "./registerCaptureTools.js";
import type { SignalRecordingService } from "../application/signals/SignalRecordingService.js";
import {
  createSignalRecordingService,
  sigrokHostSupported,
} from "../composition/signals.js";
import { registerSignalTools } from "./registerSignalTools.js";
import type { WasmArtifactService } from "../application/wasm/WasmArtifactService.js";
import { wasmArtifactModule } from "../composition/wasm.js";
import { registerWasmTools } from "./registerWasmTools.js";
import type { ApkSignatureService } from "../application/apkSignature/ApkSignatureService.js";
import { apkSignatureModule } from "../composition/apkSignature.js";
import { registerApkSignatureTools } from "./registerApkSignatureTools.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import { captureProviderEnvironment } from "./providerEnvironment.js";
import {
  createElfNotesService,
  createAppleIpsService,
  createDevicetreeService,
  createKernelModuleService,
  createPeLoadConfigService,
  createPeCertificatesService,
  createPeImportsService,
  createNativeExportsService,
  createPeResourcesService,
  createRecordedCrashService,
  createByteEntropyService,
  createBinaryLayoutService,
  pwntoolsHostSupported,
} from "../composition/binaryDiagnostics.js";
import { registerElfNotesTool } from "./registerElfNotesTool.js";
import { registerAppleIpsTool } from "./registerAppleIpsTool.js";
import { registerKernelModuleTool } from "./registerKernelModuleTool.js";
import { registerPeLoadConfigTool } from "./registerPeLoadConfigTool.js";
import { registerPeCertificatesTool } from "./registerPeCertificatesTool.js";
import { registerPeImportsTool } from "./registerPeImportsTool.js";
import { registerPeResourcesTool } from "./registerPeResourcesTool.js";
import { registerNativeExportsTool } from "./registerNativeExportsTool.js";
import type { EvmInterfaceService } from "../application/evm/EvmInterfaceService.js";
import {
  evmHostSupported,
  evmInterfaceModule,
  evmLimiterAvailability,
} from "../composition/evm.js";
import { registerEvmTools } from "./registerEvmTools.js";
import type { SqliteDatabaseService } from "../application/sqlite/SqliteDatabaseService.js";
import { createSqliteDatabaseService } from "../composition/sqlite.js";
import { registerSqliteTools } from "./registerSqliteTools.js";
import { registerRecordedCrashTools } from "./registerRecordedCrashTools.js";
import { createDesktopApplicationService } from "../composition/desktop.js";
import { registerDesktopApplicationTool } from "./registerDesktopApplicationTool.js";
import { createGoBinaryService } from "../composition/go.js";
import { createModelArtifactService } from "../composition/model.js";
import { registerModelArtifactTools } from "./registerModelArtifactTools.js";
import { createIl2cppMetadataService } from "../composition/il2cpp.js";
import type { Il2cppMetadataService } from "../application/il2cpp/Il2cppMetadataService.js";
import type { GoBinaryService } from "../application/go/GoBinaryService.js";
import { createElectronFuseService } from "../composition/electronFuses.js";
import type { ElectronFuseService } from "../application/electron/ElectronFuseService.js";
import { registerGoTools } from "./registerGoTools.js";
import { registerIl2cppTools } from "./registerIl2cppTools.js";
import { createRustBinaryService } from "../composition/rust.js";
import type { RustBinaryService } from "../application/rust/RustBinaryService.js";
import { registerRustTools } from "./registerRustTools.js";
import { createPythonPycService } from "../composition/pythonPyc.js";
import type { PythonPycService } from "../application/python/PythonPycService.js";
import { registerPythonPycTool } from "./registerPythonPycTool.js";
import { createBeamService } from "../composition/erlang.js";
import type { BeamService } from "../application/erlang/BeamService.js";
import { registerErlangTools } from "./registerErlangTools.js";
import type { RecordedCrashService } from "../application/binaryDiagnostics/RecordedCrashService.js";
import { registerAnalysisViewTool } from "./registerAnalysisViewTool.js";
import { registerBinaryDiagnosticsTools } from "./registerBinaryDiagnosticsTools.js";
import { FridaInstrumentationManager } from "../frida/FridaInstrumentationManager.js";
import { registerFridaTools } from "./registerFridaTools.js";
import type { BinaryLayoutService } from "../application/binaryDiagnostics/BinaryLayoutService.js";
import { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import { catalogIdentityForToolFamilies } from "../catalogIdentity.js";
import { parseMcpToolFamilies } from "../config/mcpToolFamilies.js";
import { createToolResultDelivery } from "./toolResult.js";
import type { ToolResultDelivery } from "./ToolResultDelivery.js";
import { parseMcpResponseBudget } from "../config/mcpResponseBudget.js";
import {
  parseMcpOutputSchemaProfile,
  type McpOutputSchemaProfile,
} from "../config/mcpOutputSchemaProfile.js";
import {
  compactPresentationForMcpInputSchemaProfile,
  parseMcpInputSchemaProfile,
} from "../config/mcpInputSchemaProfile.js";
import type { CompactInputSchemaPresentation } from "../contracts/compactInputSchema.js";
import { isAbsolute } from "node:path";

import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import type { BrowserObservationPort } from "../application/BrowserObservationPort.js";
import type { BrowserScenarioCapturePort } from "../application/BrowserScenarioCapturePort.js";
import type { ElectronActiveObservationPort } from "../application/javascript/ElectronActiveObservationPort.js";
import type { ElectronObservationPort } from "../application/javascript/ElectronObservationPort.js";
import type { JavaScriptRuntimeObservationPort } from "../application/javascript/JavaScriptRuntimeObservationPort.js";
import type { FridaInstrumentationPort } from "../application/frida/FridaInstrumentationPort.js";
import type { OptionalProviderLoadFailures } from "../application/OptionalObservationProviders.js";
import { PRODUCT_IDENTITY } from "../identity.js";
import { silentLogger } from "../logger.js";
import type { Logger } from "pino";
import { registerApplicationTools } from "./registerApplicationTools.js";
import { registerArtifactTools } from "./registerArtifactTools.js";
import { registerNativeTools } from "./registerNativeTools.js";
import { registerBrowserScenarioTool } from "./registerBrowserScenarioTool.js";
import { registerBrowserTools } from "./registerBrowserTools.js";
import { registerWebScriptTool } from "./registerWebScriptTool.js";
import { registerWebModuleTool } from "./registerWebModuleTool.js";
import type { WebModuleTraceService } from "../application/WebModuleTraceService.js";
import { createWebModuleTraceService } from "../composition/webModules.js";
import { createWebSourceLocationService } from "../composition/webSourceLocations.js";
import { registerWebSourceLocationTool } from "./registerWebSourceLocationTool.js";
import type { WebSourceLocationService } from "../application/WebSourceLocationService.js";
import type { WebRuntimeService } from "../application/WebRuntimeService.js";
import { createWebRuntimeService } from "../composition/webRuntime.js";
import { registerWebRuntimeTools } from "./registerWebRuntimeTools.js";
import type { WebNetworkCaptureService } from "../application/WebNetworkCaptureService.js";
import { createWebNetworkCaptureService } from "../composition/webNetworkCaptures.js";
import { registerWebNetworkCaptureTool } from "./registerWebNetworkCaptureTool.js";
import { registerJavaScriptRecoveryTool } from "./registerJavaScriptRecoveryTool.js";
import { JavaScriptRecoveryService } from "../application/javascript/JavaScriptRecoveryService.js";
import type { JavaScriptRecoveryPort } from "../application/javascript/JavaScriptRecoveryPort.js";
import {
  createJavaScriptRecoveryProvider,
  wakaruHostSupported,
} from "../composition/javascriptRecovery.js";
import { registerElectronTools } from "./registerElectronTools.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { registerEnhancedTools } from "./registerEnhancedTools.js";
import { registerJavaScriptRuntimeObservationTools } from "./registerJavaScriptRuntimeObservationTools.js";
import { registerManagedTools } from "./registerManagedTools.js";
import { registerFirmwareTools } from "./registerFirmwareTools.js";
import { FirmwareAnalysisService } from "../application/firmware/FirmwareAnalysisService.js";
import type { FirmwareAnalysisPort } from "../application/firmware/FirmwareAnalysisPort.js";
import {
  createFirmwareAnalysisProvider,
  firmwareHostSupported,
} from "../composition/firmware.js";
import { registerAndroidTools } from "./registerAndroidTools.js";
import { registerApktoolTools } from "./registerApktoolTools.js";
import { registerPcapTools } from "./registerPcapTools.js";
import { registerFlutterTools } from "./registerFlutterTools.js";
import { registerJebTools } from "./registerJebTools.js";
import { registerAdbTools } from "./registerAdbTools.js";
import { AndroidAnalysisService } from "../application/android/AndroidAnalysisService.js";
import { JebAnalysisService } from "../application/jeb/JebAnalysisService.js";
import type { AndroidAnalysisPort } from "../application/android/AndroidAnalysisPort.js";
import type { ApktoolResourceAnalysisPort } from "../application/apktool/ApktoolResourceAnalysisPort.js";
import type { PcapAnalysisPort } from "../application/pcap/PcapAnalysisPort.js";
import { PcapAnalysisService } from "../application/pcap/PcapAnalysisService.js";
import {
  locateWiresharkTool,
  selectWiresharkTool,
} from "../pcap/PcapConfiguration.js";
import { ApktoolResourceAnalysisService } from "../application/apktool/ApktoolResourceAnalysisService.js";
import type { FlutterBuildAnalysisPort } from "../application/flutter/FlutterBuildAnalysisPort.js";
import { FlutterBuildAnalysisService } from "../application/flutter/FlutterBuildAnalysisService.js";
import { createAndroidAnalysisProvider } from "../composition/android.js";
import { createApktoolResourceAnalysisProvider } from "../composition/apktool.js";
import { createPcapAnalysisProvider } from "../composition/pcap.js";
import { createFlutterBuildAnalysisProvider } from "../composition/flutter.js";
import type { JebAnalysisPort } from "../application/jeb/JebAnalysisPort.js";
import { createJebAnalysisProvider } from "../composition/jeb.js";
import type { AdbDeviceAnalysisPort } from "../application/adb/AdbDeviceAnalysisPort.js";
import { AdbDeviceAnalysisService } from "../application/adb/AdbDeviceAnalysisService.js";
import { createAdbDeviceAnalysisProvider } from "../composition/adb.js";
import { registerManagedWorkflowTools } from "./registerManagedWorkflowTools.js";
import { registerOfficialTools } from "./registerOfficialTools.js";
import { registerGuidedPrompts } from "./registerPrompts.js";
import { registerSessionTools } from "./registerSessionTools.js";
import type { AvailabilityPolicy } from "../application/CapabilityInventory.js";
import { sessionAvailabilityPolicy } from "./sessionAvailabilityPolicy.js";
import {
  withAdmittedAnalysis,
  type ServerAnalysisSource,
} from "./analysisAdmission.js";
import { createReverseEngineeringService } from "../composition/reverseEngineering.js";
import { registerReverseEngineeringTools } from "./registerReverseEngineeringTools.js";
import { CutterBridgeClient } from "../cutter/CutterBridgeClient.js";
import { CutterBridgeService } from "../cutter/CutterBridgeService.js";
import { registerCutterTools } from "./registerCutterTools.js";
import { GdbSessionManager } from "../gdb/GdbSessionManager.js";
import { persistentDebuggerHostSupported } from "../process/PersistentDebuggerHost.js";
import { registerGdbTools } from "./registerGdbTools.js";
import { RizinDebugSessionManager } from "../rizin/RizinDebugSessionManager.js";
import { registerRizinDebugTools } from "./registerRizinDebugTools.js";

export interface CreateServerOptions {
  readonly analysisSettings?: AnalysisSettings;
  /** Preserve the connection's creation time when materializing its runtime. */
  readonly startedAt?: string;
  /** Existing SDK server whose deferred registrations are being materialized. */
  readonly mcpServer?: EvidenceMcpServer;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly delivery?: ToolResultDelivery;
  readonly packetCapture?: PacketCaptureService;
  readonly signalRecording?: SignalRecordingService;
  readonly wasmArtifact?: WasmArtifactService;
  readonly apkSignature?: ApkSignatureService;
  readonly providerEnvironment?: Readonly<NodeJS.ProcessEnv>;
  readonly evmInterface?: EvmInterfaceService;
  readonly sqliteDatabase?: SqliteDatabaseService;
  readonly logger?: Logger;
  readonly binaryLayout?: BinaryLayoutService;
  readonly goBinary?: GoBinaryService;
  readonly il2cppMetadata?: Il2cppMetadataService;
  readonly rustBinary?: RustBinaryService;
  readonly pythonPyc?: PythonPycService;
  readonly erlangBeam?: BeamService;
  readonly electronFuses?: ElectronFuseService;
  readonly recordedCrash?: RecordedCrashService;
  readonly firmwareAnalysis?: FirmwareAnalysisPort;
  readonly javascriptRecovery?: JavaScriptRecoveryPort;
  readonly webModuleTrace?: WebModuleTraceService;
  readonly webSourceLocation?: WebSourceLocationService;
  readonly webRuntime?: WebRuntimeService;
  readonly webNetworkCapture?: WebNetworkCaptureService;
  readonly androidAnalysis?: AndroidAnalysisPort;
  readonly apktoolAnalysis?: ApktoolResourceAnalysisPort;
  readonly pcapAnalysis?: PcapAnalysisPort;
  readonly flutterAnalysis?: FlutterBuildAnalysisPort;
  readonly jebAnalysis?: JebAnalysisPort;
  readonly adbDeviceAnalysis?: AdbDeviceAnalysisPort;
  readonly browserObservation?: BrowserObservationPort;
  readonly browserScenarioCapture?: BrowserScenarioCapturePort;
  readonly electronObservation?: ElectronObservationPort;
  /** Selects who closes the shared optional observation providers. */
  readonly optionalObservationProviderOwner?: "server" | "caller";
  readonly electronActiveObservation?: ElectronActiveObservationPort;
  readonly javascriptRuntimeObservation?: JavaScriptRuntimeObservationPort;
  readonly fridaInstrumentation?: FridaInstrumentationPort;
  readonly availabilityPolicy?: () => AvailabilityPolicy;
  readonly optionalProviderLoadFailures?: OptionalProviderLoadFailures;
}

/** Apply the shared TShark selection rule without starting the tool. */
const tsharkLocatable = (environment: Readonly<NodeJS.ProcessEnv>): boolean => {
  try {
    return (
      locateWiresharkTool(
        selectWiresharkTool(environment, "tshark"),
        environment,
      ) !== undefined
    );
  } catch {
    // A relative REA_TSHARK_COMMAND is configuration the tool reports at execution.
    return false;
  }
};

const installSessionToolAvailability = (
  session: BinarySessionPort | undefined,
  options: CreateServerOptions,
  environment: Readonly<NodeJS.ProcessEnv>,
  fridaInstrumentation: FridaInstrumentationPort,
) => {
  if (session === undefined) return undefined;
  const { platform, arch } = process;
  // Each provider owns its verified host; discovery and execution share it.
  const verifiedHost = {
    packetCapture: tsharkHostSupported(platform),
    pcapCapture: pcapCaptureHostSupported(platform),
    signalRecording: sigrokHostSupported(platform),
    evmInterface: evmHostSupported(platform, arch),
    pwntools: pwntoolsHostSupported(platform, arch),
    firmware: firmwareHostSupported(platform),
    javascriptRecovery: wakaruHostSupported(platform, arch),
  };
  const pwntools =
    verifiedHost.pwntools && isAbsolute(environment.REA_PWNTOOLS_PYTHON ?? "");
  // Injected services own their availability on any host. Otherwise no
  // configuration lets an integration pass its execution host check.
  const outsideVerifiedHost = (injected: unknown, supported: boolean) =>
    injected === undefined && !supported;
  const basePolicy = sessionAvailabilityPolicy(options.availabilityPolicy, {
    optionalProviderLoadFailures: options.optionalProviderLoadFailures,
    hostUnsupported: {
      persistentDebugger: !persistentDebuggerHostSupported(platform),
      pcapCapture: outsideVerifiedHost(
        options.pcapAnalysis,
        verifiedHost.pcapCapture,
      ),
      packetCapture: outsideVerifiedHost(
        options.packetCapture,
        verifiedHost.packetCapture,
      ),
      signalRecording: outsideVerifiedHost(
        options.signalRecording,
        verifiedHost.signalRecording,
      ),
      evmInterface: outsideVerifiedHost(
        options.evmInterface,
        verifiedHost.evmInterface,
      ),
      binaryLayout: outsideVerifiedHost(
        options.binaryLayout,
        verifiedHost.pwntools,
      ),
      recordedCrash: outsideVerifiedHost(
        options.recordedCrash,
        verifiedHost.pwntools,
      ),
      firmwareInspection: outsideVerifiedHost(
        options.firmwareAnalysis,
        verifiedHost.firmware,
      ),
      firmwareExtraction: outsideVerifiedHost(
        options.firmwareAnalysis,
        verifiedHost.firmware,
      ),
      javascriptRecovery: outsideVerifiedHost(
        options.javascriptRecovery,
        verifiedHost.javascriptRecovery,
      ),
    },
    optionalFeatures: {
      packetCaptureEnabled:
        options.packetCapture !== undefined ||
        (verifiedHost.packetCapture && tsharkLocatable(environment)),
      signalRecordingEnabled:
        options.signalRecording !== undefined ||
        (verifiedHost.signalRecording &&
          isAbsolute(environment.REA_SIGROK_COMMAND ?? "")),
      wasmArtifactEnabled:
        options.wasmArtifact !== undefined ||
        isAbsolute(environment.REA_WABT_BIN_DIRECTORY ?? ""),
      evmInterfaceEnabled:
        options.evmInterface !== undefined || verifiedHost.evmInterface,
      webModuleResolutionEnabled:
        options.webModuleTrace !== undefined ||
        isAbsolute(environment.REA_BROWSER_EXECUTABLE ?? ""),
      recordedCrashEnabled: options.recordedCrash !== undefined || pwntools,
      binaryLayoutEnabled: options.binaryLayout !== undefined || pwntools,
      firmwareInspectionEnabled:
        options.firmwareAnalysis !== undefined ||
        (verifiedHost.firmware &&
          isAbsolute(environment.REA_BINWALK_COMMAND ?? "")),
      firmwareExtractionEnabled:
        options.firmwareAnalysis !== undefined ||
        (verifiedHost.firmware &&
          isAbsolute(environment.REA_UNBLOB_COMMAND ?? "")),
      browserObservationEnabled: options.browserObservation !== undefined,
      javascriptRecoveryEnabled:
        options.javascriptRecovery !== undefined ||
        (verifiedHost.javascriptRecovery &&
          isAbsolute(environment.REA_WAKARU_COMMAND ?? "")),
      browserScenarioEnabled: options.browserScenarioCapture !== undefined,
      electronObservationEnabled: options.electronObservation !== undefined,
      electronAutomationEnabled:
        options.electronActiveObservation !== undefined,
      v8InspectorObservationEnabled:
        options.javascriptRuntimeObservation !== undefined,
    },
  });
  const policy = (): AvailabilityPolicy => {
    const value = basePolicy();
    const fridaFailure =
      options.optionalProviderLoadFailures?.fridaInstrumentation ??
      fridaInstrumentation.availabilityFailure?.();
    return fridaFailure === undefined
      ? value
      : {
          ...value,
          optionalProviderLoadFailures: {
            ...value.optionalProviderLoadFailures,
            fridaInstrumentation: fridaFailure,
          },
        };
  };
  return {
    policy,
    ...(options.evmInterface !== undefined || !verifiedHost.evmInterface
      ? {}
      : {
          evmLimiterAvailability: (signal: AbortSignal) =>
            evmLimiterAvailability(environment, { signal }),
        }),
  };
};

const createMcpServer = (
  session: BinarySessionPort | undefined,
  delivery: ToolResultDelivery,
  compactPresentation: CompactInputSchemaPresentation | undefined,
  outputSchemaProfile: McpOutputSchemaProfile,
  advertisedToolFamilies: ReadonlySet<string> | undefined,
  inputElementBudget: string | undefined,
): EvidenceMcpServer => {
  const configured = parseMcpInputBudget(inputElementBudget);
  if (!configured.ok) throw configured.error;
  return new EvidenceMcpServer(
    {
      name: PRODUCT_IDENTITY.mcpServerKey,
      version: PRODUCT_IDENTITY.packageVersion,
    },
    {
      capabilities: {},
      maxToolInputElements: configured.value,
      instructions: serverInstructions(
        session !== undefined,
        advertisedToolFamilies,
      ),
    },
    session === undefined
      ? undefined
      : (evidence) => session.recordEvidence(evidence),
    delivery,
    compactPresentation,
    outputSchemaProfile,
    catalogIdentityForToolFamilies(
      compactPresentation,
      outputSchemaProfile,
      advertisedToolFamilies,
    ),
    advertisedToolFamilies,
  );
};

/**
 * Construct one MCP server without acquiring subprocess resources.
 * Supplying a session adds target lifecycle tools; omitting it retains the
 * fixed-target seam used by focused tests and embedders.
 */
export const createServer = (
  source: ServerAnalysisSource,
  options: CreateServerOptions = {},
): EvidenceMcpServer => {
  const session = source.kind === "session" ? source.session : undefined;
  const analysis = source.kind === "session" ? source.session : source.analysis;
  const environment = snapshotEnvironment(options.environment ?? process.env);
  const analysisSettings =
    options.analysisSettings ?? new AnalysisSettings(environment);
  const compactInputPresentation =
    selectCompactInputSchemaPresentation(environment);
  const selectedOutputSchemaProfile = outputSchemaProfile(environment);
  const advertisedToolFamilies = selectAdvertisedToolFamilies(environment);
  const providerEnvironment = captureProviderEnvironment(
    options.providerEnvironment,
    environment,
  );
  const delivery = selectToolResultDelivery(environment, options.delivery);
  const evmInterface =
    options.evmInterface ?? evmInterfaceModule.create(environment);
  const sqliteDatabase =
    options.sqliteDatabase ?? createSqliteDatabaseService(environment);
  const binaryLayout =
    options.binaryLayout ?? createBinaryLayoutService(environment);
  const recordedCrash =
    options.recordedCrash ?? createRecordedCrashService(environment);
  const webSourceLocation =
    options.webSourceLocation ?? createWebSourceLocationService(environment);
  const webModuleTrace =
    options.webModuleTrace ?? createWebModuleTraceService(environment);
  const desktopApplication = createDesktopApplicationService();
  const goBinary = options.goBinary ?? createGoBinaryService();
  const rustBinary = options.rustBinary ?? createRustBinaryService();
  const erlangBeam = options.erlangBeam ?? createBeamService();
  const modelArtifact = createModelArtifactService();
  const gpuCodeObjects = createGpuCodeObjectsService();
  const il2cppMetadata =
    options.il2cppMetadata ?? createIl2cppMetadataService();
  const peResources = createPeResourcesService();
  const nativeExports = createNativeExportsService();
  const devicetree = createDevicetreeService();
  const elfNotes = createElfNotesService();
  const appleIps = createAppleIpsService();
  const kernelModule = createKernelModuleService();
  const peLoadConfig = createPeLoadConfigService();
  const peCertificates = createPeCertificatesService();
  const peImports = createPeImportsService();
  const electronFuses = options.electronFuses ?? createElectronFuseService();
  const pythonPyc = options.pythonPyc ?? createPythonPycService();
  const webNetworkCapture =
    options.webNetworkCapture ??
    createWebNetworkCaptureService(environment, analysisSettings.read);
  const javascriptRecovery =
    options.javascriptRecovery ?? createJavaScriptRecoveryProvider(environment);
  const artifactResources = new ArtifactResourceScope();
  const reverseEngineering =
    createReverseEngineeringService(providerEnvironment);
  const firmwareAnalysis = new FirmwareAnalysisService(
    options.firmwareAnalysis ?? createFirmwareAnalysisProvider(environment),
  );
  const selectedOptions = {
    ...options,
    environment,
    delivery,
    evmInterface,
    sqliteDatabase,
    binaryLayout,
    recordedCrash,
    webSourceLocation,
    webModuleTrace,
    javascriptRecovery,
  };
  const startedAt = options.startedAt ?? new Date().toISOString();
  const logger = options.logger ?? silentLogger;
  const server =
    options.mcpServer ??
    createMcpServer(
      session,
      delivery,
      compactInputPresentation,
      selectedOutputSchemaProfile,
      advertisedToolFamilies,
      environment.REA_MCP_MAX_INPUT_ELEMENTS,
    );
  server.analysisSettings = analysisSettings;
  if (options.mcpServer !== undefined) {
    server.attachRuntime(
      session === undefined
        ? undefined
        : (evidence) => session.recordEvidence(evidence),
      delivery,
      catalogIdentityForToolFamilies(
        compactInputPresentation,
        selectedOutputSchemaProfile,
        advertisedToolFamilies,
      ),
    );
  }
  const gdbSessions = new GdbSessionManager({
    environment: providerEnvironment,
  });
  const rizinDebugSessions = new RizinDebugSessionManager(providerEnvironment);
  const android =
    options.androidAnalysis ??
    createAndroidAnalysisProvider(
      environment,
      undefined,
      analysisSettings.read,
    );
  const pcap = options.pcapAnalysis ?? createPcapAnalysisProvider(environment);
  const flutter =
    options.flutterAnalysis ?? createFlutterBuildAnalysisProvider();
  const fridaInstrumentation =
    options.fridaInstrumentation ?? new FridaInstrumentationManager();
  const wasmArtifact = wasmArtifactModule.create(
    environment,
    options.wasmArtifact,
    analysisSettings.read,
  );
  const apkSignature = apkSignatureModule.create(
    environment,
    options.apkSignature,
  );
  const packetCapture =
    options.packetCapture ?? createPacketCaptureService(environment);
  const signalRecording =
    options.signalRecording ?? createSignalRecordingService(environment);
  const webRuntime = options.webRuntime ?? createWebRuntimeService();
  const apktool =
    options.apktoolAnalysis ??
    createApktoolResourceAnalysisProvider(environment);
  const jeb = options.jebAnalysis ?? createJebAnalysisProvider(environment);
  const adbDevice =
    options.adbDeviceAnalysis ?? createAdbDeviceAnalysisProvider(environment);
  const cutter = new CutterBridgeService(
    new CutterBridgeClient(providerEnvironment),
  );
  let providerClose: Promise<void> | undefined;
  const closeProviders = (): Promise<void> => {
    providerClose ??= Promise.allSettled([
      android.close(),
      cutter.close(),
      fridaInstrumentation.closeAll(),
      wasmArtifact.close(),
      apkSignature.close(),
      packetCapture.close(),
      signalRecording.close(),
      apktool.close(),
      jeb.close(),
      adbDevice.close(),
      flutter.close(),
      pcap.close(),
      evmInterface.close(),
      sqliteDatabase.close(),
      binaryLayout.close(),
      recordedCrash.close(),
      webSourceLocation.close(),
      webModuleTrace.close(),
      desktopApplication.close(),
      goBinary.close(),
      rustBinary.close(),
      erlangBeam.close(),
      il2cppMetadata.close(),
      modelArtifact.close(),
      gpuCodeObjects.close(),
      peResources.close(),
      nativeExports.close(),
      devicetree.close(),
      elfNotes.close(),
      appleIps.close(),
      kernelModule.close(),
      peLoadConfig.close(),
      peCertificates.close(),
      peImports.close(),
      electronFuses.close(),
      pythonPyc.close(),
      webNetworkCapture.close(),
      javascriptRecovery.close?.() ?? Promise.resolve(),
      ...(options.optionalObservationProviderOwner === "caller"
        ? []
        : [
            options.browserObservation?.close?.() ?? Promise.resolve(),
            options.browserScenarioCapture?.close?.() ?? Promise.resolve(),
            options.electronObservation?.close?.() ?? Promise.resolve(),
            options.electronActiveObservation?.close?.() ?? Promise.resolve(),
            options.javascriptRuntimeObservation?.close?.() ??
              Promise.resolve(),
          ]),
      webRuntime.provider.close?.() ?? Promise.resolve(),
      artifactResources.close(),
      reverseEngineering.close(),
      firmwareAnalysis.close(),
      gdbSessions.closeAll(),
      rizinDebugSessions.closeAll(),
    ])
      .then((results) => {
        const failures = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (failures.length > 0)
          throw new AggregateError(failures, "REA provider cleanup failed");
      })
      .catch((cause: unknown) => {
        providerClose = undefined;
        throw cause;
      });
    return providerClose;
  };
  const availability = installSessionToolAvailability(
    session,
    options,
    environment,
    fridaInstrumentation,
  );
  const toolLogger = logger.child({ layer: "server" });
  const {
    evidenceById,
    activeTarget,
    recordEvidence,
    recordEvidenceWithUnknown,
  } = createSessionRecorders(server, session);
  const analysisAdmission = withAdmittedAnalysis(source);
  const recordSessionEvidence =
    session === undefined
      ? undefined
      : (
          evidence: Parameters<
            NonNullable<typeof session>["recordEvidence"]
          >[0],
        ) => session.recordEvidence(evidence);
  const previousOnclose = server.server.onclose;
  server.server.onclose = () => {
    previousOnclose?.();
    void closeProviders().catch((cause: unknown) => {
      logger.error(
        { error: cause instanceof Error ? cause.message : String(cause) },
        "Provider cleanup failed during server shutdown",
      );
    });
  };
  const closeServer = server.close.bind(server);
  server.close = async () => {
    const results = await Promise.allSettled([closeServer(), closeProviders()]);
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "REA server cleanup failed");
  };
  const recordUnknown =
    session === undefined
      ? undefined
      : (input: Parameters<NonNullable<typeof session>["recordUnknown"]>[0]) =>
          session.recordUnknown(input);
  const analysisOptions = {
    logger: toolLogger,
    activeTarget,
    recordEvidence,
    recordUnknown,
    evidenceById,
    withAdmittedAnalysis: analysisAdmission,
  };
  const evidenceOptions = {
    logger: toolLogger,
    activeTarget,
    recordEvidence,
    withAdmittedAnalysis: analysisAdmission,
  };
  const common = {
    logger: toolLogger,
    recordEvidence,
    withAdmittedAnalysis: analysisAdmission,
  };
  registerToolFamilies({
    direct: () => registerOfficialTools(server, analysisOptions),
    enhanced: () =>
      registerEnhancedTools(server, {
        ...analysisOptions,
        analysisProfile:
          session === undefined
            ? undefined
            : (operation) =>
                session.analysisProfile() ?? session.analysisProfile(operation),
        allowsSnapshotReplay:
          session === undefined
            ? undefined
            : (operation) => session.allowsSnapshotReplay(operation),
        recordWorkflowSnapshot:
          session === undefined
            ? undefined
            : (input) => session.recordWorkflowSnapshot(input),
      }),
    native: () => {
      registerNativeTools(server, { ...evidenceOptions, evidenceById });
      registerReverseEngineeringTools(
        server,
        reverseEngineering,
        toolLogger,
        delivery,
        recordSessionEvidence,
        analysisAdmission,
        session === undefined
          ? undefined
          : () => session.invalidateSnapshotForExternalMutation(),
        session === undefined
          ? undefined
          : (path, signal, operation, rebindFailure) =>
              session.withAdmittedExternalMutation(
                path,
                signal,
                operation,
                rebindFailure,
              ),
        evidenceById,
      );
      registerCutterTools(
        server,
        cutter,
        toolLogger,
        delivery,
        recordSessionEvidence,
        session,
      );
      registerGdbTools(
        server,
        gdbSessions,
        toolLogger,
        delivery,
        recordSessionEvidence,
        session,
        evidenceById,
      );
      registerRizinDebugTools(
        server,
        rizinDebugSessions,
        toolLogger,
        delivery,
        recordSessionEvidence,
        session,
      );
      registerBinaryDiagnosticsTools(
        server,
        selectedOptions.binaryLayout ?? createBinaryLayoutService(environment),
        createByteEntropyService(artifactResources),
        toolLogger,
        recordEvidence,
        evidenceById,
        analysisAdmission,
      );
      registerPeResourcesTool(
        server,
        peResources,
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
      registerNativeExportsTool(
        server,
        nativeExports,
        toolLogger,
        recordEvidence,
        evidenceById,
        analysisAdmission,
      );
      registerDevicetreeTool(
        server,
        devicetree,
        toolLogger,
        recordEvidence,
        evidenceById,
        analysisAdmission,
      );
      registerElfNotesTool(
        server,
        elfNotes,
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
      registerAppleIpsTool(
        server,
        appleIps,
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
      registerKernelModuleTool(
        server,
        kernelModule,
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
      registerPeLoadConfigTool(
        server,
        peLoadConfig,
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
      registerPeCertificatesTool(
        server,
        peCertificates,
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
      registerPeImportsTool(
        server,
        peImports,
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
      registerRecordedCrashTools(
        server,
        selectedOptions.recordedCrash ??
          createRecordedCrashService(environment),
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
    },
    artifact: () => {
      registerArtifactTools(server, { ...evidenceOptions, evidenceById });
      registerDesktopApplicationTool(
        server,
        desktopApplication,
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      );
      registerModelArtifactTools(
        server,
        modelArtifact,
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      );
      registerGpuCodeObjectsTools(
        server,
        gpuCodeObjects,
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      );
      registerEvmTools(
        server,
        evmInterface,
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      );
      registerGoTools(
        server,
        goBinary,
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      );
      registerIl2cppTools(
        server,
        il2cppMetadata,
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      );
      registerRustTools(
        server,
        rustBinary,
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      );
      registerPythonPycTool(
        server,
        pythonPyc,
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      );
      registerErlangTools(
        server,
        erlangBeam,
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      );
      registerWasmTools(
        server,
        wasmArtifact,
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      );
      registerApkSignatureTools(
        server,
        apkSignature,
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      );
      registerSqliteTools(
        server,
        selectedOptions.sqliteDatabase ??
          createSqliteDatabaseService(environment),
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
      registerCaptureTools(
        server,
        packetCapture,
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
      registerSignalTools(
        server,
        signalRecording,
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
    },
    managed: () => {
      registerManagedTools(server, { ...evidenceOptions, evidenceById });
      if (session !== undefined)
        registerManagedWorkflowTools(server, {
          logger: toolLogger,
          recordEvidence,
          recordEvidenceWithUnknown,
          session,
          withAdmittedAnalysis: analysisAdmission,
        });
    },
    firmware: () =>
      registerFirmwareTools(
        server,
        firmwareAnalysis,
        toolLogger,
        recordEvidence,
        analysisAdmission,
      ),
    android: () =>
      registerAndroidTools(
        server,
        new AndroidAnalysisService(android, recordEvidence),
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      ),
    pcap: () =>
      registerPcapTools(
        server,
        new PcapAnalysisService(pcap),
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      ),
    flutter: () =>
      registerFlutterTools(
        server,
        new FlutterBuildAnalysisService(flutter),
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      ),
    frida: () =>
      registerFridaTools(
        server,
        fridaInstrumentation,
        toolLogger,
        delivery,
        recordSessionEvidence,
        evidenceById,
      ),
    apktool: () =>
      registerApktoolTools(
        server,
        new ApktoolResourceAnalysisService(apktool),
        toolLogger,
        recordEvidence,
        analysisAdmission,
      ),
    jeb: () =>
      registerJebTools(
        server,
        new JebAnalysisService(jeb),
        toolLogger,
        recordEvidence,
        analysisAdmission,
      ),
    adb: () =>
      registerAdbTools(
        server,
        new AdbDeviceAnalysisService(adbDevice),
        toolLogger,
        recordEvidence,
        analysisAdmission,
      ),
    browser: () => {
      registerBrowserTools(server, {
        ...common,
        evidenceById,
        browser: selectedOptions.browserObservation,
        loadFailure:
          selectedOptions.optionalProviderLoadFailures?.browserObservation,
      });
      registerBrowserScenarioTool(server, {
        ...common,
        evidenceById,
        provider: selectedOptions.browserScenarioCapture,
        loadFailure:
          selectedOptions.optionalProviderLoadFailures?.browserScenarioCapture,
      });
      registerWebRuntimeTools(
        server,
        webRuntime,
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
      registerWebNetworkCaptureTool(
        server,
        webNetworkCapture,
        toolLogger,
        recordEvidence,
        analysisAdmission,
        evidenceById,
      );
    },
    electron: () =>
      registerElectronTools(server, {
        ...common,
        artifactResources,
        environment,
        evidenceById,
        electron: selectedOptions.electronObservation,
        electronActive: selectedOptions.electronActiveObservation,
        electronFuses,
        observationLoadFailure:
          selectedOptions.optionalProviderLoadFailures?.electronObservation,
        activeLoadFailure:
          selectedOptions.optionalProviderLoadFailures
            ?.electronActiveObservation,
      }),
    "javascript-runtime": () =>
      registerJavaScriptRuntimeObservationTools(server, {
        ...common,
        runtime: selectedOptions.javascriptRuntimeObservation,
        loadFailure:
          selectedOptions.optionalProviderLoadFailures
            ?.javascriptRuntimeObservation,
      }),
    application: () => {
      registerAnalysisSettingsTools(server, analysisSettings);
      registerAnalysisViewTool(
        server,
        toolLogger,
        evidenceById,
        recordEvidence,
        analysisAdmission,
        artifactResources,
      );
      registerWebScriptTool(server, { ...common, artifactResources });
      registerWebModuleTool(
        server,
        selectedOptions.webModuleTrace ??
          createWebModuleTraceService(environment),
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
      registerWebSourceLocationTool(
        server,
        selectedOptions.webSourceLocation ??
          createWebSourceLocationService(environment),
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
      registerJavaScriptRecoveryTool(
        server,
        new JavaScriptRecoveryService(
          selectedOptions.javascriptRecovery ??
            createJavaScriptRecoveryProvider(environment),
        ),
        toolLogger,
        recordEvidence,
        analysisAdmission,
      );
      registerApplicationTools(server, {
        artifactResources,
        evidenceById,
        logger: toolLogger,
        recordEvidence,
        recordEvidenceWithUnknown,
        withAdmittedAnalysis: analysisAdmission,
      });
    },
    session: () => {
      if (session === undefined) return;
      registerSessionTools(server, session, toolLogger, {
        ...selectedOptions,
        artifactResources,
        ...(availability === undefined
          ? {}
          : { availabilityPolicy: availability.policy }),
        ...(availability?.evmLimiterAvailability === undefined
          ? {}
          : { evmLimiterAvailability: availability.evmLimiterAvailability }),
        androidAnalysisAvailability: (signal) =>
          android.inspectAvailability(signal),
        adbAnalysisAvailability: (signal) =>
          adbDevice.inspectAvailability(signal),
        apktoolAnalysisAvailability: (signal) =>
          apktool.inspectAvailability(signal),
        jebAnalysisAvailability: (signal) => jeb.inspectAvailability(signal),
        startedAt,
      });
    },
  });
  registerGuidedPrompts(server, analysis, session);
  return server;
};

const selectToolResultDelivery = (
  environment: Readonly<NodeJS.ProcessEnv>,
  selected: ToolResultDelivery | undefined,
): ToolResultDelivery => {
  if (selected !== undefined) return selected;
  const configured = parseMcpResponseBudget(
    environment.REA_MCP_MAX_RESPONSE_BYTES,
  );
  if (!configured.ok) throw configured.error;
  return createToolResultDelivery(configured.value);
};

const outputSchemaProfile = (
  environment: Readonly<NodeJS.ProcessEnv>,
): McpOutputSchemaProfile => {
  const configured = parseMcpOutputSchemaProfile(
    environment.REA_MCP_OUTPUT_SCHEMA_PROFILE,
  );
  if (!configured.ok) throw configured.error;
  return configured.value ?? "full";
};

const selectCompactInputSchemaPresentation = (
  environment: Readonly<NodeJS.ProcessEnv>,
): CompactInputSchemaPresentation | undefined => {
  const configured = parseMcpInputSchemaProfile(
    environment.REA_MCP_INPUT_SCHEMA_PROFILE,
  );
  if (!configured.ok) throw configured.error;
  return compactPresentationForMcpInputSchemaProfile(configured.value);
};

const createSessionRecorders = (
  server: EvidenceMcpServer,
  session: BinarySessionPort | undefined,
) => ({
  evidenceById:
    session === undefined
      ? undefined
      : session.evidenceForAnalysis.bind(session),
  activeTarget:
    session === undefined ? undefined : () => session.activeTarget(),
  recordEvidence:
    session === undefined
      ? undefined
      : (evidence: Parameters<typeof session.recordEvidence>[0]) =>
          session.recordEvidence(evidence),
  recordEvidenceWithUnknown:
    session === undefined
      ? undefined
      : (
          evidence: Parameters<typeof session.recordEvidenceWithUnknown>[0],
          input: Parameters<typeof session.recordEvidenceWithUnknown>[1],
        ) => session.recordEvidenceWithUnknown(evidence, input),
});

const selectAdvertisedToolFamilies = (
  environment: Readonly<NodeJS.ProcessEnv>,
): ReadonlySet<string> | undefined => {
  const configured = parseMcpToolFamilies(environment.REA_MCP_TOOL_FAMILIES);
  if (!configured.ok) throw configured.error;
  return configured.value === undefined ? undefined : new Set(configured.value);
};
