// Core runtime handed to a plugin via `input.core` (dependency injection).
//
// A compiled-binary host cannot be `import`ed by an installed plugin — the plugin
// runs in-process but the host's modules aren't resolvable as a `cyberstrike`
// package. So instead of a plugin importing `cyberstrike/public` (works only in
// the dev workspace), the host PASSES its live runtime functions to the plugin
// when it loads it. Same functions, same live state (one registry, one session
// store); works in the distributed .exe on every OS because it is just in-process
// reference passing, not module resolution.
//
// The TYPES a plugin needs still come from `import type { CoreRuntime } from
// "cyberstrike/public"` — type-only imports are erased at build time, so they need
// no runtime resolution. Only the VALUES travel through injection.
import { registerProvider, resolveProvider } from "./provider-registry"
import { isAssessmentProvider } from "./provider"
import { orchestrateLayer2 } from "./orchestrate"
import { CORE_API_VERSION, requireCoreApi, coreApiSatisfies } from "./core-api"
import { Intel } from "../methodology/intel"
import { triageGuide, triageActions, VulnStatus, isActionable, isExcluded } from "../session/vulnerability-status"
import { Session } from "../session"
import { Vulnerability } from "../session/vulnerability"
import { buildWebKit, type WebKit } from "./web-kit"

export interface CoreRuntime {
  CORE_API_VERSION: string
  requireCoreApi: typeof requireCoreApi
  coreApiSatisfies: typeof coreApiSatisfies
  registerProvider: typeof registerProvider
  resolveProvider: typeof resolveProvider
  isAssessmentProvider: typeof isAssessmentProvider
  orchestrateLayer2: typeof orchestrateLayer2
  Intel: typeof Intel
  Session: typeof Session
  Vulnerability: typeof Vulnerability
  VulnStatus: typeof VulnStatus
  triageGuide: typeof triageGuide
  triageActions: typeof triageActions
  isActionable: typeof isActionable
  isExcluded: typeof isExcluded
  // Domain building-block kits — reusable primitives a plugin composes into its
  // own tools (the "Lego" surface). `web` ships the HTTP replay / signal fabric
  // blocks; new kits (e.g. `cloud`) are added in later core versions.
  web: WebKit
}

/** Build the runtime bundle the host injects into every plugin's `input.core`. */
export function buildCoreRuntime(): CoreRuntime {
  return {
    CORE_API_VERSION,
    requireCoreApi,
    coreApiSatisfies,
    registerProvider,
    resolveProvider,
    isAssessmentProvider,
    orchestrateLayer2,
    Intel,
    Session,
    Vulnerability,
    VulnStatus,
    triageGuide,
    triageActions,
    isActionable,
    isExcluded,
    web: buildWebKit(),
  }
}
