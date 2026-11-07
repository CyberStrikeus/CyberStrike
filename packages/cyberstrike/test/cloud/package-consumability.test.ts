import { describe, test, expect } from "bun:test"
// A workflow package may import from ONLY these two surfaces:
//   - the SDK contract (@cyberstrike-io/plugin)
//   - the core public runtime (cyberstrike/public, here ../../src/public)
// This file imports nothing else on purpose — it proves the boundary is
// SUFFICIENT to build a full assessment domain (the azure shape) without
// reaching into core internals. If an assessment domain cannot be expressed
// with only these imports, the boundary is incomplete and this file won't compile.
import type { AgentSpec } from "@cyberstrike-io/plugin"
import {
  registerProvider,
  resolveProvider,
  isAssessmentProvider,
  type AssessmentProvider,
  type CloudAnalysis,
} from "../../src/public"

// Simulates @cyberstrike-io/azure's provider, restricted to the public boundary.
class MockAzurePackageProvider implements AssessmentProvider {
  key = "azure-pkg-test"

  agentSpecs(): AgentSpec[] {
    return [
      { name: "azpkg-orchestrator", role: "orchestrator", description: "d", steps: 40, color: "blue", prompt: "p", skills: [], permissions: { "*": "deny", task: "allow" } },
      { name: "azpkg-iam-analyst", role: "analyst", description: "d", steps: 30, color: "cyan", prompt: "p", skills: [], permissions: { "*": "deny", azurehook: "allow" } },
    ]
  }

  groups(): CloudAnalysis.GroupDef[] {
    return [{ key: "iam", label: "IAM", analyst: "azpkg-iam-analyst", programs: ["iam_enum"], description: "IAM checks" }]
  }
  identityGroup(): CloudAnalysis.GroupDef | null {
    return null
  }
  parallelGroups(): CloudAnalysis.GroupDef[] {
    return this.groups()
  }
  validate() {
    return { ok: true as const, totalFindings: 0 }
  }
  findingCount(): number {
    return 0
  }
  classify() {
    return []
  }
  analystPrompt(group: CloudAnalysis.GroupDef): string {
    return `analyze ${group.label}`
  }
  batchPrompt(): string {
    return "batch"
  }
  verifyPrompt(): string {
    return "verify"
  }
  followupPrompt(): string {
    return "followup"
  }
  identityContext(): string {
    return ""
  }
}

describe("workflow-package consumability (public boundary is sufficient)", () => {
  test("a package restricted to cyberstrike/public can register a full assessment domain", async () => {
    registerProvider("azure-pkg-test", () => new MockAzurePackageProvider())

    const resolved = await resolveProvider("azure-pkg-test")
    expect(resolved).toBeDefined()
    expect(resolved!.key).toBe("azure-pkg-test")

    // The assessment entry (C10) narrows via isAssessmentProvider — the package's
    // provider must pass, proving it implements the full contract from /public.
    expect(isAssessmentProvider(resolved!)).toBe(true)
    if (isAssessmentProvider(resolved!)) {
      expect(resolved.groups()[0].key).toBe("iam")
      expect(resolved.analystPrompt(resolved.groups()[0], "")).toContain("IAM")
    }

    // Its agents collect into the registry like any domain's.
    expect(resolved!.agentSpecs().some((s) => s.name === "azpkg-orchestrator")).toBe(true)

    // cleanup
    registerProvider("azure-pkg-test", () => ({ key: "azure-pkg-test", agentSpecs: () => [] }))
  })
})
