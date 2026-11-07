// Public runtime API of @cyberstrike-io/cyberstrike (core).
//
// This is the ONLY surface a workflow package (@cyberstrike-io/web,
// @cyberstrike-io/azure, ...) may import from core. It is curated and
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

// ── Compatibility boundary — a package pins the core API version it needs ──
export { CORE_API_VERSION, requireCoreApi, coreApiSatisfies } from "./cloud/core-api"

// ── Injected runtime — a plugin receives these VALUES via `input.core` (works in
// the compiled binary); it imports only the TYPE here (erased at build time). ──
export type { CoreRuntime } from "./cloud/core-runtime"

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
export { triageGuide, triageActions, VulnStatus, isActionable, isExcluded } from "./session/vulnerability-status"

// ── Session + vulnerability stores a domain's tool/provider reads & writes ──
// (a domain uses Session.root, Vulnerability.get/add/Info, VulnStatus.DRAFT)
export { Session } from "./session"
export { Vulnerability } from "./session/vulnerability"

// ── Cloud inventory — domain packages record discovered assets & exposures ──
export { CloudAsset, CloudExposure } from "./cloud/inventory"
export type { AssetKind, ExposureType } from "./cloud/inventory"

// ── Web building-block kit (values arrive via input.core.web; TYPES here) ──
// A domain plugin composes these to build its own web tools. The runtime VALUES
// travel through injection; a plugin imports only these TYPES (erased at build).
export type { WebKit, WebSignalKit } from "./cloud/web-kit"
export type { ProbeRequest, ProbeResponse, HttpSender, ReplaySenderOptions } from "./tool/webhook/transport"
export type { WebhookContext, WebhookToolDef, ToolOutput } from "./tool/webhook/define"
