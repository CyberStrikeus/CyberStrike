import { describe, test, expect, afterEach } from "bun:test"
import {
  WebProvider,
  buildClassAgentMap,
  renderSignalRoutingTable,
  renderRoster,
  SIGNAL_ROUTING_PLACEHOLDER,
  AGENT_ROSTER_PLACEHOLDER,
} from "../src/provider-web"

describe("WebProvider", () => {
  test("instance has the correct key", () => {
    expect(new WebProvider().key).toBe("web")
  })

  test("agentSpecs returns 12 agents (default flags)", () => {
    expect(new WebProvider().agentSpecs().length).toBe(12)
  })

  test("agent names match expected set", () => {
    const names = new WebProvider().agentSpecs().map((s) => s.name).sort()
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
      "hunt-ssrf",
    ])
  })

  test("orchestrator is visible (hidden=false)", () => {
    const orch = new WebProvider().agentSpecs().find((s) => s.name === "hunt-agent")!
    expect(orch.hidden).toBe(false)
    expect(orch.role).toBe("orchestrator")
    expect(orch.steps).toBe(40)
  })

  test("analyzer uses small model", () => {
    const analyzer = new WebProvider().agentSpecs().find((s) => s.name === "hunt-analyzer")!
    expect(analyzer.useSmallModel).toBe(true)
    expect(analyzer.role).toBe("analyzer")
    expect(analyzer.prependRequestContext).toBe(true)
  })

  test("all specialists have prependRequestContext", () => {
    const specialists = new WebProvider().agentSpecs().filter((s) => s.role === "specialist")
    expect(specialists.length).toBe(10)
    for (const s of specialists) expect(s.prependRequestContext).toBe(true)
  })

  test("injection agent has destructive-SQL deny rules", () => {
    const injection = new WebProvider().agentSpecs().find((s) => s.name === "hunt-injection")!
    const bash = injection.permissions.bash
    expect(typeof bash).toBe("object")
    if (typeof bash === "object") {
      expect(bash["*DROP TABLE*"]).toBe("deny")
      expect(bash["*xp_cmdshell*"]).toBe("deny")
    }
  })

  test("injection agent has inject_probe permission", () => {
    const injection = new WebProvider().agentSpecs().find((s) => s.name === "hunt-injection")!
    expect(injection.permissions.inject_probe).toBe("allow")
  })

  test("smart tool agents have their tool permissions", () => {
    const specs = new WebProvider().agentSpecs()
    expect(specs.find((s) => s.name === "hunt-authn")!.permissions.authn_test).toBe("allow")
    expect(specs.find((s) => s.name === "hunt-ssrf")!.permissions.ssrf_test).toBe("allow")
    expect(specs.find((s) => s.name === "hunt-business-logic")!.permissions.business_test).toBe("allow")
    const misconfig = specs.find((s) => s.name === "hunt-misconfig")!
    expect(misconfig.permissions.misconfig_test).toBe("allow")
    // recon was merged into hunt-misconfig — it now holds recon_test too.
    expect(misconfig.permissions.recon_test).toBe("allow")
  })

  test("llm agent has llmhook permission", () => {
    const llm = new WebProvider().agentSpecs().find((s) => s.name === "hunt-llm")!
    expect(llm.permissions.llmhook).toBe("allow")
  })

  test("all vuln agents deny webfetch and external HTTP tools", () => {
    const specialists = new WebProvider().agentSpecs().filter((s) => s.role === "specialist")
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

  test("orchestrator denies everything except delegation + reads", () => {
    const orch = new WebProvider().agentSpecs().find((s) => s.name === "hunt-agent")!
    expect(orch.permissions["*"]).toBe("deny")
    expect(orch.permissions.task).toBe("allow")
    expect(orch.permissions.web_get_session_context).toBe("allow")
    expect(orch.permissions.http_replay).toBeUndefined()
    expect(orch.permissions.bash).toBeUndefined()
  })

  test("specialist prompts include the vuln common prefix", () => {
    const specialists = new WebProvider().agentSpecs().filter((s) => s.role === "specialist")
    for (const s of specialists) expect(s.prompt).toContain("---")
  })

  test("descriptions are single-line (no newlines)", () => {
    for (const s of new WebProvider().agentSpecs()) expect(s.description).not.toContain("\n")
  })

  test("skills are referenced by name (not baked into the prompt)", () => {
    // Skills load at runtime via the `skill` tool (azure pattern); each spec keeps its skills:[] and
    // the prompt no longer embeds skill content. Guard the roster keeps naming its WSTG packs.
    const injection = new WebProvider().agentSpecs().find((s) => s.name === "hunt-injection")!
    expect(injection.skills).toContain("wstg-injection")
    expect(injection.prompt).not.toContain("Embedded Skill References")
  })
})

describe("SpecialistClass → agent mapping", () => {
  test("specialistClasses matches the historical orchestrator routing table (drift guard)", () => {
    // These pairs were once hardcoded as prose in web-hunt-agent/prompt.txt (Step 7 table). They now
    // derive from AgentSpec.specialistClass — this fails the moment code and that table diverge.
    const map = new WebProvider().specialistClasses()
    const expected: Record<string, string> = {
      "input-validation": "hunt-injection",
      "config-deployment": "hunt-misconfig",
      authentication: "hunt-authn",
      authorization: "hunt-authz",
      "business-logic": "hunt-business-logic",
    }
    for (const [cls, agent] of Object.entries(expected)) expect(map[cls]).toBe(agent)
  })

  test("buildClassAgentMap rejects two agents claiming the same class", () => {
    expect(() =>
      buildClassAgentMap([
        { name: "hunt-authz", specialistClass: "authorization" },
        { name: "hunt-idor", specialistClass: "authorization" },
      ]),
    ).toThrow(/claimed by both/)
  })

  test("buildClassAgentMap skips agents with no specialistClass", () => {
    const map = buildClassAgentMap([
      { name: "hunt-idor" },
      { name: "hunt-injection", specialistClass: "input-validation" },
    ])
    expect(map.size).toBe(1)
    expect(map.get("input-validation")).toBe("hunt-injection")
  })

  test("specialistClasses exposes exactly the owning specialists", () => {
    // 6 specialists declare a WSTG class by default (WEB_INPUT_VALIDATION off): hunt-injection
    // (input-validation), hunt-authz (authorization), hunt-authn (authentication), hunt-misconfig
    // (config-deployment), hunt-business-logic (business-logic), hunt-llm (llm). idor, mass-assignment,
    // file-attacks, ssrf are dispatch-by-name (no owned class).
    const map = new WebProvider().specialistClasses()
    expect(Object.keys(map).length).toBe(6)
    expect(map["input-validation"]).toBe("hunt-injection")
    expect(map["llm"]).toBe("hunt-llm")
  })
})

describe("orchestrator signal-routing table (rendered from code)", () => {
  test("renderSignalRoutingTable emits a header + one row per owned class", () => {
    const provider = new WebProvider()
    const map = new Map(Object.entries(provider.specialistClasses()))
    const table = renderSignalRoutingTable(map)
    expect(table).toContain("| Specialist class | Agent name |")
    for (const [owner, agent] of map) expect(table).toContain(`| \`${owner}\` | ${agent} |`)
    // Row count = header(2) + one per owned class.
    expect(table.split("\n").length).toBe(2 + map.size)
  })

  test("composed orchestrator prompt has the table injected, no placeholder left", () => {
    const orch = new WebProvider().agentSpecs().find((s) => s.name === "hunt-agent")!
    expect(orch.prompt).not.toContain(SIGNAL_ROUTING_PLACEHOLDER)
    expect(orch.prompt).toContain("| `input-validation` | hunt-injection |")
    expect(orch.prompt).toContain("| `config-deployment` | hunt-misconfig |")
    expect(orch.prompt).toContain("| `authentication` | hunt-authn |")
    // client-side has no built specialist — it stays as static prose in the prompt, not a table row.
    expect(orch.prompt).toContain("client-side")
  })

  test("the placeholder constant matches the token the .txt carries", () => {
    const map = buildClassAgentMap([{ name: "hunt-injection", specialistClass: "input-validation" }])
    expect(renderSignalRoutingTable(map)).toContain("hunt-injection")
    expect(SIGNAL_ROUTING_PLACEHOLDER).toBe("{{SIGNAL_ROUTING_TABLE}}")
  })
})

describe("orchestrator agent roster (rendered from code)", () => {
  test("renderRoster lists analyzer + every specialist from their own description", () => {
    const specs = new WebProvider().agentSpecs()
    const roster = renderRoster(specs)
    expect(roster).toContain("### Architecture Analysis")
    expect(roster).toContain("### Vulnerability Testing Agents")
    for (const s of specs) {
      if (s.role === "analyzer" || s.role === "specialist") {
        expect(roster).toContain(`- **${s.name}**: ${s.description}`)
      }
    }
    expect(roster).not.toContain("- **hunt-agent**:")
  })

  test("composed orchestrator prompt has the roster injected, no placeholder left", () => {
    const orch = new WebProvider().agentSpecs().find((s) => s.name === "hunt-agent")!
    expect(orch.prompt).not.toContain(AGENT_ROSTER_PLACEHOLDER)
    expect(orch.prompt).toContain("### Architecture Analysis")
    expect(orch.prompt).toContain("- **hunt-idor**:")
    expect(orch.prompt).toContain("- **hunt-misconfig**:")
  })

  test("roster entry text equals each agent's spec.description (single source)", () => {
    const orch = new WebProvider().agentSpecs().find((s) => s.name === "hunt-agent")!
    for (const s of new WebProvider().agentSpecs()) {
      if (s.role !== "specialist") continue
      expect(orch.prompt).toContain(`- **${s.name}**: ${s.description}`)
    }
  })
})

describe("WebProvider — CYBERSTRIKE_WEB_FOCUS (debug focus mode)", () => {
  const KEY = "CYBERSTRIKE_WEB_FOCUS"
  const saved = process.env[KEY]
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY]
    else process.env[KEY] = saved
  })

  test("focus reduces the roster to orchestrator + analyzer + named specialists", () => {
    process.env[KEY] = "idor,authz"
    const names = new WebProvider().agentSpecs().map((s) => s.name).sort()
    expect(names).toEqual(["hunt-agent", "hunt-analyzer", "hunt-authz", "hunt-idor"])
  })

  test("the hunt- prefix is optional and other specialists are dropped", () => {
    process.env[KEY] = "hunt-idor"
    const names = new WebProvider().agentSpecs().map((s) => s.name)
    expect(names).toContain("hunt-idor")
    expect(names).toContain("hunt-agent") // orchestrator always kept
    expect(names).toContain("hunt-analyzer") // analyzer always kept (context extraction)
    expect(names).not.toContain("hunt-injection")
    expect(names).not.toContain("hunt-misconfig")
  })

  test("unset restores the full 12-agent roster (no focus)", () => {
    delete process.env[KEY]
    expect(new WebProvider().agentSpecs().length).toBe(12)
  })
})
