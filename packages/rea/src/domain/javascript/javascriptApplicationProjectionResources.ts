import type { JavaScriptStaticAnalysis } from "./javascriptStaticAnalysisTypes.js";

/** Forecast static-fact expansion into observations, nodes and relationships. */
export const estimateJavaScriptStaticApplicationProjection = (
  facts: JavaScriptStaticAnalysis,
  checkpointBytes: number,
  sourcePath: string,
): number => {
  // A finding can produce a node, a separate observation and several edges.
  // Allow for identifiers, locations, authority, coverage and schema copies,
  // independently of the producer's compact checkpoint representation.
  const findings =
    (facts.electron.app_path_changes?.length ?? 0) +
    facts.references.length +
    facts.endpoints.length +
    facts.storage.length +
    facts.role_paths.length +
    facts.source_map_urls.length +
    facts.electron.browser_windows.length +
    facts.electron.context_bridge_apis.length +
    facts.electron.ipc.length +
    facts.electron.sender_validations.length +
    facts.electron.utility_processes.length +
    facts.electron.native_addon_bindings.length +
    facts.electron.protocols.length;
  let records = findings * 8;
  let repeatedBytes = 0;
  for (const registration of facts.bundler_registrations) {
    records +=
      3 +
      registration.modules.length * 3 +
      registration.entry_module_keys.length * 3 +
      registration.async_chunk_keys.length * 3;
    // Every module observation and containment edge repeats its chunk keys.
    repeatedBytes +=
      Buffer.byteLength(JSON.stringify(registration.chunk_keys)) *
      registration.modules.length *
      2;
  }
  for (const binding of facts.electron.native_addon_bindings)
    records += binding.members.length * 3;
  for (const path of facts.electron.call_paths ?? []) {
    // One contextual node and edge per step, with repeated guards and identity.
    records += path.steps.length * 4 + 8;
    repeatedBytes +=
      Buffer.byteLength(JSON.stringify(path.conditions)) *
      path.steps.length *
      2;
  }
  // The per-record allowance already covers retention: projected Vite-style
  // chunks serialize to about 0.46 KB per record, under a quarter of it.
  // Expanding the allowance again charged about 25x the serialized
  // relationships, so a few files used up the parent budget that every later
  // source shares. Checkpoint and repeated bytes keep their expansion.
  const metadataBytes = 2048 + Buffer.byteLength(sourcePath) * 4;
  return (checkpointBytes * 4 + repeatedBytes) * 8 + records * metadataBytes;
};
