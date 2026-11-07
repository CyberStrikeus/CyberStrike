import type { ProviderIdentity } from "../application/AnalysisProvider.js";

/** Identity available without loading the V8InspectorProvider implementation. */
export const V8_INSPECTOR_PROVIDER_IDENTITY: ProviderIdentity = Object.freeze({
  id: "rea-v8-inspector",
  name: "REA passive Node/Electron V8 Inspector provider",
  version: "1",
});
