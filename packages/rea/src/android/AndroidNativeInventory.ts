import type { JadxToolPort } from "./JadxAnalysis.js";
import type { AndroidNativeDeclarations } from "../domain/android/androidNativeDeclarations.js";
import { jadxNativeDeclarationsSchema } from "./JadxProtocol.js";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";

/** Validate the native-only batch at its producing boundary, preserving raw facts. */
export const readAndroidNativeInventory = async (
  tools: JadxToolPort,
  snapshot: string,
): Promise<AndroidNativeDeclarations> => {
  const raw = await tools.json("rea_native_declarations", { path: snapshot });
  const parsed = jadxNativeDeclarationsSchema.safeParse(raw);
  if (!parsed.success)
    throw new AnalysisOutputError(
      "inspect_android_jni_bindings",
      "JADX native declaration inventory was malformed",
      { cause: parsed.error },
    );
  const inventory = parsed.data;
  const origins = new Map<number, string>();
  const inconsistent =
    inventory.coverage.examined_dex_entries > inventory.coverage.dex_entries ||
    inventory.methods.length > inventory.coverage.examined_methods ||
    (inventory.coverage.status === "complete" &&
      (inventory.coverage.examined_dex_entries !==
        inventory.coverage.dex_entries ||
        inventory.unknowns.length !== 0)) ||
    inventory.methods.some((method, index) => {
      const previous = origins.get(method.dex_entry_index);
      origins.set(method.dex_entry_index, method.dex_entry);
      return (
        method.source_index !== index ||
        (previous !== undefined && previous !== method.dex_entry)
      );
    });
  if (inconsistent)
    throw new AnalysisOutputError(
      "inspect_android_jni_bindings",
      "JADX native declaration counts or source identities were inconsistent",
    );
  return inventory;
};
