import { describe, test, expect } from "bun:test"
import { WebProvider } from "../../src/cloud/provider-web"

describe("WebProvider", () => {
  test("factory creates instance with correct key", async () => {
    const provider = await WebProvider.create()
    expect(provider.key).toBe("web")
  })

  test("agentSpecs returns 13 agents", async () => {
    const provider = await WebProvider.create()
    const specs = provider.agentSpecs()
    expect(specs.length).toBe(13)
  })

  test("agent names match expected set", async () => {
    const provider = await WebProvider.create()
    const names = provider.agentSpecs().map((s) => s.name).sort()
    expect(names).toEqual([
      "proxy-agent",
      "proxy-analyzer",
      "proxy-tester-authn",
      "proxy-tester-authz",
      "proxy-tester-business-logic",
      "proxy-tester-file-attacks",
      "proxy-tester-idor",
      "proxy-tester-injection",
      "proxy-tester-llm",
      "proxy-tester-mass-assignment",
      "proxy-tester-misconfig",
      "proxy-tester-recon",
      "proxy-tester-ssrf",
    ])
  })

  test("orchestrator is visible (hidden=false)", async () => {
    const provider = await WebProvider.create()
    const orch = provider.agentSpecs().find((s) => s.name === "proxy-agent")!
    expect(orch.hidden).toBe(false)
    expect(orch.role).toBe("orchestrator")
    expect(orch.steps).toBe(40)
  })

  test("analyzer uses small model", async () => {
    const provider = await WebProvider.create()
    const analyzer = provider.agentSpecs().find((s) => s.name === "proxy-analyzer")!
    expect(analyzer.useSmallModel).toBe(true)
    expect(analyzer.role).toBe("analyzer")
    expect(analyzer.prependRequestContext).toBe(true)
  })

  test("all specialists have prependRequestContext", async () => {
    const provider = await WebProvider.create()
    const specialists = provider.agentSpecs().filter((s) => s.role === "specialist")
    expect(specialists.length).toBe(11)
    for (const s of specialists) {
      expect(s.prependRequestContext).toBe(true)
    }
  })

  test("injection agent has destructive-SQL deny rules", async () => {
    const provider = await WebProvider.create()
    const injection = provider.agentSpecs().find((s) => s.name === "proxy-tester-injection")!
    const bash = injection.permissions.bash
    expect(typeof bash).toBe("object")
    if (typeof bash === "object") {
      expect(bash["*DROP TABLE*"]).toBe("deny")
      expect(bash["*xp_cmdshell*"]).toBe("deny")
    }
  })

  test("injection agent has inject_probe permission", async () => {
    const provider = await WebProvider.create()
    const injection = provider.agentSpecs().find((s) => s.name === "proxy-tester-injection")!
    expect(injection.permissions.inject_probe).toBe("allow")
  })

  test("smart tool agents have their tool permissions", async () => {
    const provider = await WebProvider.create()
    const specs = provider.agentSpecs()

    const authn = specs.find((s) => s.name === "proxy-tester-authn")!
    expect(authn.permissions.authn_test).toBe("allow")

    const ssrf = specs.find((s) => s.name === "proxy-tester-ssrf")!
    expect(ssrf.permissions.ssrf_test).toBe("allow")

    const business = specs.find((s) => s.name === "proxy-tester-business-logic")!
    expect(business.permissions.business_test).toBe("allow")

    const misconfig = specs.find((s) => s.name === "proxy-tester-misconfig")!
    expect(misconfig.permissions.misconfig_test).toBe("allow")

    const recon = specs.find((s) => s.name === "proxy-tester-recon")!
    expect(recon.permissions.recon_test).toBe("allow")
  })

  test("llm agent has llmhook permission", async () => {
    const provider = await WebProvider.create()
    const llm = provider.agentSpecs().find((s) => s.name === "proxy-tester-llm")!
    expect(llm.permissions.llmhook).toBe("allow")
  })

  test("all vuln agents deny webfetch and external HTTP tools", async () => {
    const provider = await WebProvider.create()
    const specialists = provider.agentSpecs().filter((s) => s.role === "specialist")
    for (const s of specialists) {
      expect(s.permissions.webfetch).toBe("deny")
      expect(s.permissions["*"]).toBe("deny")
      const bash = s.permissions.bash
      expect(typeof bash).toBe("object")
      if (typeof bash === "object") {
        expect(bash["*curl *"]).toBe("deny")
        expect(bash["*wget *"]).toBe("deny")
      }
    }
  })

  test("orchestrator denies everything except delegation + reads", async () => {
    const provider = await WebProvider.create()
    const orch = provider.agentSpecs().find((s) => s.name === "proxy-agent")!
    expect(orch.permissions["*"]).toBe("deny")
    expect(orch.permissions.task).toBe("allow")
    expect(orch.permissions.web_get_session_context).toBe("allow")
    expect(orch.permissions.http_replay).toBeUndefined()
    expect(orch.permissions.bash).toBeUndefined()
  })

  test("detectors returns non-empty array", async () => {
    const provider = await WebProvider.create()
    expect(provider.detectors().length).toBeGreaterThan(0)
  })

  test("signalRouter is a valid instance", async () => {
    const provider = await WebProvider.create()
    const router = provider.signalRouter()
    expect(router).toBeDefined()
    expect(typeof router.route).toBe("function")
  })

  test("specialist prompts include vuln common prefix", async () => {
    const provider = await WebProvider.create()
    const specialists = provider.agentSpecs().filter((s) => s.role === "specialist")
    for (const s of specialists) {
      expect(s.prompt).toContain("---")
    }
  })

  test("descriptions are single-line (no newlines)", async () => {
    const provider = await WebProvider.create()
    for (const s of provider.agentSpecs()) {
      expect(s.description).not.toContain("\n")
    }
  })
})
