import type { GhidraExtensionAdapter } from "../GhidraExtensions.js";
import { validateNativeAotReport } from "./NativeAotReport.js";

/** NativeAOT-specific prerequisites and report interpretation behind the extension boundary. */
export const nativeAotAdapter: GhidraExtensionAdapter = {
  id: "nativeaot",
  entryClass: "rea.extensions.nativeaot.NativeAotExtension",
  configuredPath: (config) => config.ghidraNativeAotJar,
  unsupportedReason: (target, platform) =>
    platform !== "linux"
      ? {
          constraint: "host",
          reason:
            "NativeAOT recovery is verified on Linux only; omit REA_GHIDRA_NATIVEAOT_JAR for ordinary native analysis.",
        }
      : !["elf", "pe"].includes(target.format) ||
          target.architecture !== "x86_64" ||
          target.managed === true
        ? {
            constraint: "target",
            reason:
              "NativeAOT recovery requires an x86-64 ELF or native PE target on Linux; PE/CLI and ReadyToRun assemblies use inspect_managed_artifact; omit REA_GHIDRA_NATIVEAOT_JAR for ordinary native analysis.",
          }
        : null,
  validate: validateNativeAotReport,
  limitations: [
    "Optional NativeAOT recovery is verified for .NET 8.0.22 RTR 9.1 Linux x64 ELF and Windows x64 PE targets on a Linux host. Other runtime layouts, target architectures and hosts are unsupported.",
    "Type names and relationships use recovery heuristics; original C# source and custom field layouts are not recovered. Rehydrated analysis-memory bytes are derived, without original file offsets or runtime observations.",
    "Method prototypes are Ghidra inferences, not original signatures. Pre-recovery conventions are retained; new functions use the loaded compiler default. Verify parameter roles against instructions and call sites.",
    "The configured extension retains its actual JAR digest. Its reported source revision is not an attestation of caller-supplied build bytes.",
  ],
};
