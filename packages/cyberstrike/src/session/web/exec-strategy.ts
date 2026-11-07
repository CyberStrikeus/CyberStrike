// Framework-adaptive execution strategy (P5, design §6.4). Deterministic — NO LLM. The Executor
// keeps a FIXED brick signature (click / type / navigate / submit); this picks HOW each brick
// behaves for the detected stack, so the AI never needs framework details. Single source of the
// §6.4 matrix — extend the tables here, not at call sites. Pure (imports only the TechStack type),
// so both the shared gated executor (WebAct: type mode) and the co-drive executor
// (WebActExecutor: wait-hydrated) consume it without a cycle.
import type { TechStack } from "./tech"

export namespace ExecStrategy {
  // How the extension must set an input's value:
  //  - "standard"      : plain per-keystroke value updates (classic inputs, jQuery, SSR).
  //  - "native-setter" : bypass the framework's overridden value setter via the prototype's native
  //                      setter, then dispatch input/change — the only way React/Vue/Angular
  //                      controlled inputs actually register a programmatic value (design §6.3).
  export type TypeMode = "standard" | "native-setter"

  export interface Strategy {
    typeMode: TypeMode
    waitHydrated: boolean // meta-framework: SSR HTML is inert until hydration — wait before acting
    submitPreservesTokens: boolean // WebForms/JSF: hidden __VIEWSTATE/ViewState must survive submit
    label: string // short tag for logging / the HBLog act record
  }

  // Client frameworks whose controlled inputs need the native-setter bypass.
  const REACTIVE = new Set(["React", "Vue", "Angular"])
  // Server stacks whose forms carry postback tokens that a submit must preserve.
  function preservesTokens(server: string[]): boolean {
    return server.some((s) => s.startsWith("ASP.NET") || s === "JSF")
  }

  export const STANDARD: Strategy = { typeMode: "standard", waitHydrated: false, submitPreservesTokens: false, label: "standard" }

  export function forTech(tech?: TechStack): Strategy {
    if (!tech) return STANDARD
    const reactive = tech.client.some((c) => REACTIVE.has(c))
    const waitHydrated = tech.metaFramework !== undefined
    const submitPreservesTokens = preservesTokens(tech.server)
    const label =
      [reactive ? "native-setter" : "", waitHydrated ? "wait-hydrated" : "", submitPreservesTokens ? "preserve-tokens" : ""]
        .filter(Boolean)
        .join("+") || "standard"
    return {
      typeMode: reactive ? "native-setter" : "standard",
      waitHydrated,
      submitPreservesTokens,
      label,
    }
  }
}
