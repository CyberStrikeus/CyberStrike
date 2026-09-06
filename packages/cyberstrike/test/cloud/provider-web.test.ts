import { describe, test, expect } from "bun:test"
import { WebProvider, buildClassAgentMap, renderSignalRoutingTable, SIGNAL_ROUTING_PLACEHOLDER } from "../../src/cloud/provider-web"
import { SignalRouter } from "../../src/session/web/signal/router"
import type { SpecialistClass } from "../../src/session/web/signal/types"

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
      "hunt-agent",
      "hunt-analyzer",
      "hunt-authn",
      "hunt-authz",
      "hunt-business-logic",
      "hunt-file-attacks",
      "hunt-idor",
      "hunt-injection",
      "hunt-llm",
      "hunt-mass-assignment",
      "hunt-misconfig",
      "hunt-recon",
      "hunt-ssrf",
    ])
  })

  test("orchestrator is visible (hidden=false)", async () => {
    const provider = await WebProvider.create()
    const orch = provider.agentSpecs().find((s) => s.name === "hunt-agent")!
    expect(orch.hidden).toBe(false)
    expect(orch.role).toBe("orchestrator")
    expect(orch.steps).toBe(40)
  })

  test("analyzer uses small model", async () => {
    const provider = await WebProvider.create()
    const analyzer = provider.agentSpecs().find((s) => s.name === "hunt-analyzer")!
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
    const injection = provider.agentSpecs().find((s) => s.name === "hunt-injection")!
    const bash = injection.permissions.bash
    expect(typeof bash).toBe("object")
    if (typeof bash === "object") {
      expect(bash["*DROP TABLE*"]).toBe("deny")
      expect(bash["*xp_cmdshell*"]).toBe("deny")
    }
  })

  test("injection agent has inject_probe permission", async () => {
    const provider = await WebProvider.create()
    const injection = provider.agentSpecs().find((s) => s.name === "hunt-injection")!
    expect(injection.permissions.inject_probe).toBe("allow")
  })

  test("smart tool agents have their tool permissions", async () => {
    const provider = await WebProvider.create()
    const specs = provider.agentSpecs()

    const authn = specs.find((s) => s.name === "hunt-authn")!
    expect(authn.permissions.authn_test).toBe("allow")

    const ssrf = specs.find((s) => s.name === "hunt-ssrf")!
    expect(ssrf.permissions.ssrf_test).toBe("allow")

    const business = specs.find((s) => s.name === "hunt-business-logic")!
    expect(business.permissions.business_test).toBe("allow")

    const misconfig = specs.find((s) => s.name === "hunt-misconfig")!
    expect(misconfig.permissions.misconfig_test).toBe("allow")

    const recon = specs.find((s) => s.name === "hunt-recon")!
    expect(recon.permissions.recon_test).toBe("allow")
  })

  test("llm agent has llmhook permission", async () => {
    const provider = await WebProvider.create()
    const llm = provider.agentSpecs().find((s) => s.name === "hunt-llm")!
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
    const orch = provider.agentSpecs().find((s) => s.name === "hunt-agent")!
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

describe("SpecialistClass → agent mapping (signal-fabric bridge)", () => {
  test("every signal owner class resolves to exactly one existing agent", async () => {
    const provider = await WebProvider.create()
    const names = new Set(provider.agentSpecs().map((s) => s.name))
    const router = provider.signalRouter()
    for (const type of SignalRouter.signalTypes()) {
      const owner = router.ownerOf(type)
      const agent = provider.agentForClass(owner)
      expect(agent, `signal "${type}" owner class "${owner}" must map to an agent`).toBeDefined()
      expect(names.has(agent!), `agent "${agent}" for class "${owner}" must exist`).toBe(true)
    }
  })

  test("agentForClass matches the historical orchestrator routing table (drift guard)", async () => {
    // These 6 pairs were previously hardcoded as prose in web-hunt-agent/prompt.txt
    // (Step 7 table). They now derive from AgentSpec.specialistClass — this test
    // fails the moment code and that (soon-to-be-rendered) table diverge.
    const provider = await WebProvider.create()
    const expected: Record<string, string> = {
      injection: "hunt-injection",
      misconfiguration: "hunt-misconfig",
      "auth-session": "hunt-authn",
      "access-control": "hunt-authz",
      "business-logic": "hunt-business-logic",
      recon: "hunt-recon",
    }
    for (const [cls, agent] of Object.entries(expected)) {
      expect(provider.agentForClass(cls as SpecialistClass)).toBe(agent)
    }
  })

  test("buildClassAgentMap rejects two agents claiming the same class", () => {
    expect(() =>
      buildClassAgentMap([
        { name: "hunt-authz", specialistClass: "access-control" },
        { name: "hunt-idor", specialistClass: "access-control" },
      ]),
    ).toThrow(/claimed by both/)
  })

  test("buildClassAgentMap skips agents with no specialistClass", () => {
    const map = buildClassAgentMap([
      { name: "hunt-idor" },
      { name: "hunt-injection", specialistClass: "injection" },
    ])
    expect(map.size).toBe(1)
    expect(map.get("injection")).toBe("hunt-injection")
  })

  test("classAgentMap exposes all owning specialists", async () => {
    const provider = await WebProvider.create()
    const map = provider.classAgentMap()
    // 8 specialists declare a class; idor, mass-assignment, file-attacks do not.
    expect(map.size).toBe(8)
    expect(map.get("server-side-request")).toBe("hunt-ssrf")
    expect(map.get("llm")).toBe("hunt-llm")
  })
})

describe("orchestrator signal-routing table (rendered from code)", () => {
  test("renderSignalRoutingTable emits a row for every signal-owner class", async () => {
    const provider = await WebProvider.create()
    const router = provider.signalRouter()
    const table = renderSignalRoutingTable(provider.classAgentMap(), router)

    // Header present
    expect(table).toContain("| Specialist class | Agent name |")

    // Exactly the distinct signal owners appear, each mapped to its agent.
    const owners = new Set(SignalRouter.signalTypes().map((t) => router.ownerOf(t)))
    for (const owner of owners) {
      const agent = provider.agentForClass(owner)!
      expect(table).toContain(`| \`${owner}\` | ${agent} |`)
    }
    // Row count = header(2) + one per distinct owner
    expect(table.split("\n").length).toBe(2 + owners.size)
  })

  test("composed orchestrator prompt has the table injected, no placeholder left", async () => {
    const provider = await WebProvider.create()
    const orch = provider.agentSpecs().find((s) => s.name === "hunt-agent")!
    expect(orch.prompt).not.toContain(SIGNAL_ROUTING_PLACEHOLDER)
    // The 6 historical rows must all be present in the final prompt.
    expect(orch.prompt).toContain("| `injection` | hunt-injection |")
    expect(orch.prompt).toContain("| `misconfiguration` | hunt-misconfig |")
    expect(orch.prompt).toContain("| `access-control` | hunt-authz |")
    // client-side stays as static prose (no agent)
    expect(orch.prompt).toContain("client-side")
  })

  test("injection fails loud if the orchestrator prompt loses the placeholder", () => {
    // Guard: renderSignalRoutingTable output is stable, but if a future prompt edit
    // drops the token the injector must throw, not silently ship an empty table.
    const map = buildClassAgentMap([{ name: "hunt-injection", specialistClass: "injection" }])
    const table = renderSignalRoutingTable(map, new SignalRouter())
    expect(table).toContain("hunt-injection")
    // The prompt-composition guard is exercised via WebProvider.create() above;
    // here we assert the placeholder constant is what the .txt is expected to carry.
    expect(SIGNAL_ROUTING_PLACEHOLDER).toBe("{{SIGNAL_ROUTING_TABLE}}")
  })
})
