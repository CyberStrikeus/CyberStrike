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

  test("agentSpecs returns 14 agents", () => {
    expect(new WebProvider().agentSpecs().length).toBe(14)
  })

  test("agent names match expected set", () => {
    const names = new WebProvider().agentSpecs().map((s) => s.name).sort()
    expect(names).toEqual([
      "escalation-hunter",
      "wstg-agent",
      "wstg-authentication",
      "wstg-authorization",
      "wstg-business-logic",
      "wstg-client-side",
      "wstg-config-deploy",
      "wstg-cryptography",
      "wstg-error-handling",
      "wstg-identity-mgmt",
      "wstg-info-gathering",
      "wstg-input-validation",
      "wstg-llm",
      "wstg-session-mgmt",
    ])
  })

  test("orchestrator is visible (hidden=false)", () => {
    const orch = new WebProvider().agentSpecs().find((s) => s.name === "wstg-agent")!
    expect(orch.hidden).toBe(false)
    expect(orch.role).toBe("orchestrator")
    expect(orch.steps).toBe(40)
  })

  test("all specialists have prependRequestContext", () => {
    const specialists = new WebProvider().agentSpecs().filter((s) => s.role === "specialist")
    expect(specialists.length).toBe(12)
    for (const s of specialists) expect(s.prependRequestContext).toBe(true)
  })

  test("input-validation agent has destructive-SQL deny rules", () => {
    const iv = new WebProvider().agentSpecs().find((s) => s.name === "wstg-input-validation")!
    const bash = iv.permissions.bash
    expect(typeof bash).toBe("object")
    if (typeof bash === "object") {
      expect(bash["*DROP TABLE*"]).toBe("deny")
      expect(bash["*xp_cmdshell*"]).toBe("deny")
    }
  })

  test("input-validation agent has inject_probe permission", () => {
    const iv = new WebProvider().agentSpecs().find((s) => s.name === "wstg-input-validation")!
    expect(iv.permissions.inject_probe).toBe("allow")
  })

  test("smart tool agents have their tool permissions", () => {
    const specs = new WebProvider().agentSpecs()
    expect(specs.find((s) => s.name === "wstg-authentication")!.permissions.authn_test).toBe("allow")
    expect(specs.find((s) => s.name === "wstg-business-logic")!.permissions.business_test).toBe("allow")
    const config = specs.find((s) => s.name === "wstg-config-deploy")!
    expect(config.permissions.misconfig_test).toBe("allow")
    expect(config.permissions.recon_test).toBe("allow")
  })

  test("llm agent has llmhook permission", () => {
    const llm = new WebProvider().agentSpecs().find((s) => s.name === "wstg-llm")!
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
    const orch = new WebProvider().agentSpecs().find((s) => s.name === "wstg-agent")!
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
    const iv = new WebProvider().agentSpecs().find((s) => s.name === "wstg-input-validation")!
    expect(iv.skills).toContain("wstg-injection")
    expect(iv.prompt).not.toContain("Embedded Skill References")
  })

  test("all specialists have Vortex read permissions", () => {
    const specialists = new WebProvider().agentSpecs().filter((s) => s.role === "specialist")
    for (const s of specialists) {
      expect(s.permissions.vortex_query).toBe("allow")
      expect(s.permissions.vortex_inspect).toBe("allow")
    }
  })
})

describe("SpecialistClass → agent mapping", () => {
  test("specialistClasses matches the WSTG-aligned routing table", () => {
    const map = new WebProvider().specialistClasses()
    const expected: Record<string, string> = {
      "info-gathering": "wstg-info-gathering",
      "config-deployment": "wstg-config-deploy",
      "identity-management": "wstg-identity-mgmt",
      authentication: "wstg-authentication",
      authorization: "wstg-authorization",
      "session-management": "wstg-session-mgmt",
      "input-validation": "wstg-input-validation",
      "error-handling": "wstg-error-handling",
      cryptography: "wstg-cryptography",
      "business-logic": "wstg-business-logic",
      "client-side": "wstg-client-side",
      llm: "wstg-llm",
    }
    for (const [cls, agent] of Object.entries(expected)) expect(map[cls]).toBe(agent)
  })

  test("buildClassAgentMap rejects two agents claiming the same class", () => {
    expect(() =>
      buildClassAgentMap([
        { name: "wstg-authorization", specialistClass: "authorization" },
        { name: "wstg-idor", specialistClass: "authorization" },
      ]),
    ).toThrow(/claimed by both/)
  })

  test("buildClassAgentMap skips agents with no specialistClass", () => {
    const map = buildClassAgentMap([
      { name: "wstg-agent" },
      { name: "wstg-input-validation", specialistClass: "input-validation" },
    ])
    expect(map.size).toBe(1)
    expect(map.get("input-validation")).toBe("wstg-input-validation")
  })

  test("specialistClasses exposes exactly 12 owning specialists", () => {
    const map = new WebProvider().specialistClasses()
    expect(Object.keys(map).length).toBe(12)
    expect(map["input-validation"]).toBe("wstg-input-validation")
    expect(map["llm"]).toBe("wstg-llm")
    expect(map["authorization"]).toBe("wstg-authorization")
    expect(map["client-side"]).toBe("wstg-client-side")
  })
})

describe("orchestrator signal-routing table (rendered from code)", () => {
  test("renderSignalRoutingTable emits a header + one row per owned class", () => {
    const provider = new WebProvider()
    const map = new Map(Object.entries(provider.specialistClasses()))
    const table = renderSignalRoutingTable(map)
    expect(table).toContain("| Specialist class | Agent name |")
    for (const [owner, agent] of map) expect(table).toContain(`| \`${owner}\` | ${agent} |`)
    expect(table.split("\n").length).toBe(2 + map.size)
  })

  test("composed orchestrator prompt has the table injected, no placeholder left", () => {
    const orch = new WebProvider().agentSpecs().find((s) => s.name === "wstg-agent")!
    expect(orch.prompt).not.toContain(SIGNAL_ROUTING_PLACEHOLDER)
    expect(orch.prompt).toContain("| `input-validation` | wstg-input-validation |")
    expect(orch.prompt).toContain("| `config-deployment` | wstg-config-deploy |")
    expect(orch.prompt).toContain("| `authentication` | wstg-authentication |")
    expect(orch.prompt).toContain("| `client-side` | wstg-client-side |")
  })

  test("the placeholder constant matches the token the .txt carries", () => {
    const map = buildClassAgentMap([{ name: "wstg-input-validation", specialistClass: "input-validation" }])
    expect(renderSignalRoutingTable(map)).toContain("wstg-input-validation")
    expect(SIGNAL_ROUTING_PLACEHOLDER).toBe("{{SIGNAL_ROUTING_TABLE}}")
  })
})

describe("orchestrator agent roster (rendered from code)", () => {
  test("renderRoster lists every specialist from their own description", () => {
    const specs = new WebProvider().agentSpecs()
    const roster = renderRoster(specs)
    expect(roster).toContain("### Vulnerability Testing Agents")
    for (const s of specs) {
      if (s.role === "specialist") {
        expect(roster).toContain(`- **${s.name}**: ${s.description}`)
      }
    }
    expect(roster).not.toContain("- **wstg-agent**:")
  })

  test("composed orchestrator prompt has the roster injected, no placeholder left", () => {
    const orch = new WebProvider().agentSpecs().find((s) => s.name === "wstg-agent")!
    expect(orch.prompt).not.toContain(AGENT_ROSTER_PLACEHOLDER)
    expect(orch.prompt).toContain("### Vulnerability Testing Agents")
    expect(orch.prompt).toContain("- **wstg-input-validation**:")
    expect(orch.prompt).toContain("- **wstg-config-deploy**:")
  })

  test("roster entry text equals each agent's spec.description (single source)", () => {
    const orch = new WebProvider().agentSpecs().find((s) => s.name === "wstg-agent")!
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

  test("focus reduces the roster to orchestrator + named specialists", () => {
    process.env[KEY] = "input-validation,authorization"
    const names = new WebProvider().agentSpecs().map((s) => s.name).sort()
    expect(names).toEqual(["wstg-agent", "wstg-authorization", "wstg-input-validation"])
  })

  test("the wstg- prefix is optional and other specialists are dropped", () => {
    process.env[KEY] = "wstg-authorization"
    const names = new WebProvider().agentSpecs().map((s) => s.name)
    expect(names).toContain("wstg-authorization")
    expect(names).toContain("wstg-agent")
    expect(names).not.toContain("wstg-input-validation")
    expect(names).not.toContain("wstg-config-deploy")
  })

  test("unset restores the full 14-agent roster (no focus)", () => {
    delete process.env[KEY]
    expect(new WebProvider().agentSpecs().length).toBe(14)
  })
})
