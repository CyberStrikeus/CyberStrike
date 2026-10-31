import { PeLoadConfigService } from "../application/binaryDiagnostics/PeLoadConfigService.js";
import { PeLoadConfigProvider } from "../native/pe/PeLoadConfigProvider.js";
import { ByteEntropyService } from "../application/binaryDiagnostics/ByteEntropyService.js";
import { RecordedCrashService } from "../application/binaryDiagnostics/RecordedCrashService.js";
import { PwntoolsRecordedCrashProvider } from "../native/pwntools/PwntoolsRecordedCrashProvider.js";
import { BinaryLayoutService } from "../application/binaryDiagnostics/BinaryLayoutService.js";
import { PwntoolsLayoutProvider } from "../native/pwntools/PwntoolsLayoutProvider.js";
import { pwntoolsHostSupported } from "../native/pwntools/PwntoolsDecoder.js";
import { PeResourcesService } from "../application/binaryDiagnostics/PeResourcesService.js";
import { PeResourcesProvider } from "../native/pe/PeResourcesProvider.js";
import { PeCertificatesService } from "../application/binaryDiagnostics/PeCertificatesService.js";
import { PeCertificatesProvider } from "../native/pe/PeCertificatesProvider.js";
import { PeImportsService } from "../application/binaryDiagnostics/PeImportsService.js";
import { PeImportsProvider } from "../native/pe/PeImportsProvider.js";
import { ElfNotesService } from "../application/binaryDiagnostics/ElfNotesService.js";
import { ElfNotesProvider } from "../native/elf/ElfNotesProvider.js";
import { AppleIpsService } from "../application/binaryDiagnostics/AppleIpsService.js";
import { AppleIpsProvider } from "../native/apple/AppleIpsProvider.js";
import { KernelModuleService } from "../application/binaryDiagnostics/KernelModuleService.js";
import { KernelModuleProvider } from "../native/elf/KernelModuleProvider.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { NativeExportsService } from "../application/binaryDiagnostics/NativeExportsService.js";
import { NativeExportsProvider } from "../native/exports/NativeExportsProvider.js";

import { DevicetreeService } from "../application/binaryDiagnostics/DevicetreeService.js";
import { DevicetreeProvider } from "../firmware/devicetree/DevicetreeProvider.js";
export const createDevicetreeService = (): DevicetreeService =>
  new DevicetreeService(new DevicetreeProvider());

export { pwntoolsHostSupported };

/** Portable PE inspection with no engine, installation or target acquisition. */
export const createPeResourcesService = (): PeResourcesService =>
  new PeResourcesService(new PeResourcesProvider());

/** Portable Authenticode table inspection with no engine or catalog verification. */
export const createPeCertificatesService = (): PeCertificatesService =>
  new PeCertificatesService(new PeCertificatesProvider());

/** Portable PE import-table inspection with no engine or catalog verification. */
export const createPeImportsService = (): PeImportsService =>
  new PeImportsService(new PeImportsProvider());

/** Portable PE/ELF export tables with no engine, toolchain or target acquisition. */
export const createNativeExportsService = (): NativeExportsService =>
  new NativeExportsService(new NativeExportsProvider());
/** Portable ELF note-table inspection with no engine or package catalog. */
export const createElfNotesService = (): ElfNotesService =>
  new ElfNotesService(new ElfNotesProvider());

/** Portable Apple .ips inspection with no engine, Xcode or target acquisition. */
export const createAppleIpsService = (): AppleIpsService =>
  new AppleIpsService(new AppleIpsProvider());
/** Portable Linux kernel-module metadata inspection with no engine or host `modinfo`. */
export const createKernelModuleService = (): KernelModuleService =>
  new KernelModuleService(new KernelModuleProvider());

/** Compose the offline adapter without import-time I/O or dependency acquisition. */
export const createBinaryLayoutService = (
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): BinaryLayoutService =>
  new BinaryLayoutService(new PwntoolsLayoutProvider(environment));

/** Compose recorded-core inspection without acquiring a debugger or toolchain. */
export const createRecordedCrashService = (
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): RecordedCrashService =>
  new RecordedCrashService(new PwntoolsRecordedCrashProvider(environment));

/** Provider-free local byte analysis. */
export const createByteEntropyService = (
  resources?: ArtifactResourceScope,
): ByteEntropyService => new ByteEntropyService(undefined, resources);

export const createPeLoadConfigService = (): PeLoadConfigService =>
  new PeLoadConfigService(new PeLoadConfigProvider());
