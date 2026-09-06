// Public runtime API of @cyberstrike-io/cyberstrike (core).
//
// This is the ONLY surface a workflow package (@cyberstrike-io/web,
// @cyberstrike-io-ent/azure, ...) may import from core. It is curated and
// versioned: it is the core side of the package-compatibility boundary
// (docs/domain-plugin-architecture.md). Internal modules stay internal — a
// package that reaches past this surface is not portable across core versions.
//
// A workflow package therefore has two peer dependencies:
//   - @cyberstrike-io/plugin      (the contract: types + hook shapes)
//   - @cyberstrike-io/cyberstrike (this runtime, imported as ".../public")
//
// Importing this module does not pull the whole app: it re-exports specific
// runtime services, not the server or CLI.

// ── Contract (re-exported from the SDK so a package has one import for both) ──
export type {
  AgentSpec,
  DomainProvider,
  DomainProviderFactory,
  PermissionAction,
  PermissionRule,
} from "@cyberstrike-io/plugin"

// ── Domain registry — how a package's provider is registered / resolved ──
export { registerProvider, resolveProvider, registeredDomains } from "./cloud/provider-registry"
export { isAssessmentProvider } from "./cloud/provider"
export type { AssessmentProvider } from "./cloud/provider"

// ── Cloud assessment orchestration (batch scan + verify workflow) ──
export { orchestrateLayer2 } from "./cloud/orchestrate"
export type { CloudAnalysis } from "./cloud/types"

// ── Shared methodology / finding services a domain's agents use ──
export { Intel } from "./methodology/intel"
export { triageGuide, triageActions } from "./session/vulnerability-status"
