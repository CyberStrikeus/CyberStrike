import { describe, expect, test } from "bun:test"
import { ExecStrategy } from "../../../src/session/web/exec-strategy"
import type { TechStack } from "../../../src/session/web/tech"

const tech = (over: Partial<TechStack>): TechStack => ({ client: [], server: [], rendering: "unknown", signals: [], ...over })

describe("ExecStrategy.forTech — the §6.4 matrix", () => {
  test("no tech → standard everything", () => {
    expect(ExecStrategy.forTech(undefined)).toEqual(ExecStrategy.STANDARD)
  })

  test("React/Vue/Angular controlled inputs → native-setter type", () => {
    for (const fw of ["React", "Vue", "Angular"]) {
      expect(ExecStrategy.forTech(tech({ client: [fw], rendering: "spa" })).typeMode).toBe("native-setter")
    }
  })

  test("jQuery / classic client → standard type (no native-setter)", () => {
    expect(ExecStrategy.forTech(tech({ client: ["jQuery"] })).typeMode).toBe("standard")
  })

  test("meta-framework → waitHydrated", () => {
    const s = ExecStrategy.forTech(tech({ client: ["React"], metaFramework: "Next.js", rendering: "spa" }))
    expect(s.waitHydrated).toBe(true)
    expect(s.typeMode).toBe("native-setter")
  })

  test("plain SPA (no meta-framework) does NOT waitHydrated", () => {
    expect(ExecStrategy.forTech(tech({ client: ["Vue"], rendering: "spa" })).waitHydrated).toBe(false)
  })

  test("ASP.NET WebForms / JSF → submit preserves tokens", () => {
    expect(ExecStrategy.forTech(tech({ server: ["ASP.NET WebForms"], rendering: "ssr" })).submitPreservesTokens).toBe(true)
    expect(ExecStrategy.forTech(tech({ server: ["JSF"], rendering: "ssr" })).submitPreservesTokens).toBe(true)
  })

  test("classic SSR (PHP/Java) → no token preservation, no hydration, standard type", () => {
    const s = ExecStrategy.forTech(tech({ server: ["PHP"], rendering: "ssr" }))
    expect(s).toMatchObject({ typeMode: "standard", waitHydrated: false, submitPreservesTokens: false })
  })

  test("label composes the active adaptations", () => {
    expect(ExecStrategy.forTech(tech({ client: ["React"], metaFramework: "Next.js" })).label).toBe("native-setter+wait-hydrated")
    expect(ExecStrategy.forTech(tech({ server: ["ASP.NET"] })).label).toBe("preserve-tokens")
    expect(ExecStrategy.forTech(undefined).label).toBe("standard")
  })
})
