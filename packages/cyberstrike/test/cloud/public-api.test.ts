import { describe, test, expect } from "bun:test"
import * as Public from "../../src/public"

// Guards the curated core public API surface. A workflow package imports ONLY
// these; this test fails if a boundary member is accidentally removed (breaking
// installed packages) — a deliberate signal to bump the core compatibility
// version rather than silently drop a member.
describe("core public API surface", () => {
  test("exposes the registry + assessment runtime a workflow package needs", () => {
    expect(typeof Public.registerProvider).toBe("function")
    expect(typeof Public.resolveProvider).toBe("function")
    expect(typeof Public.registeredDomains).toBe("function")
    expect(typeof Public.isAssessmentProvider).toBe("function")
    expect(typeof Public.orchestrateLayer2).toBe("function")
  })

  test("exposes shared methodology / finding services", () => {
    expect(typeof Public.Intel).toBe("object")
    expect(typeof Public.triageGuide).toBe("function")
    expect(typeof Public.triageActions).toBe("function")
  })

  test("the exposed runtime actually works (not just present)", () => {
    // triageActions/triageGuide are pure and safe to call — proves the re-export
    // is the live function, not a broken binding.
    expect(typeof Public.triageActions()).toBe("string")
    expect(typeof Public.triageGuide()).toBe("string")
    expect(Public.registeredDomains()).toContain("web")
  })

  test("exposes the compatibility boundary", () => {
    expect(typeof Public.CORE_API_VERSION).toBe("string")
    expect(typeof Public.requireCoreApi).toBe("function")
    expect(typeof Public.coreApiSatisfies).toBe("function")
  })

  test("the full boundary member set is present (drop = fail = version bump)", () => {
    const members = Object.keys(Public).sort()
    expect(members).toEqual(
      [
        "CORE_API_VERSION",
        "Intel",
        "coreApiSatisfies",
        "isAssessmentProvider",
        "orchestrateLayer2",
        "registerProvider",
        "registeredDomains",
        "requireCoreApi",
        "resolveProvider",
        "triageActions",
        "triageGuide",
      ].sort(),
    )
  })
})
