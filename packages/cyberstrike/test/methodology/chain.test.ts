import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Intel } from "../../src/methodology/intel"
import { Chain } from "../../src/methodology/chain"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Chain — Detection", () => {
  test("detect returns empty array for empty session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const chains = Chain.detect(session.id)
        expect(chains).toEqual([])

        await Session.remove(session.id)
      },
    })
  })

  test("detects credential_endpoint chain", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // Add credential + endpoint intel on same asset
        Intel.add({
          sessionID: session.id,
          data: {
            type: "credential",
            severity: "high",
            title: "Default admin credentials",
            detail: "admin:admin123 found in login page",
            asset: "app.example.com",
            source: "test",
            confidenceLevel: "confirmed",
            tags: ["credential"],
          },
        })

        Intel.add({
          sessionID: session.id,
          data: {
            type: "endpoint",
            severity: "medium",
            title: "POST /api/admin/users",
            detail: "Admin user management endpoint",
            asset: "app.example.com",
            source: "test",
            confidenceLevel: "confirmed",
            tags: ["admin", "endpoint"],
          },
        })

        const chains = Chain.detect(session.id)
        const credentialChain = chains.find((c) => c.pattern === "credential_endpoint")
        expect(credentialChain).toBeDefined()
        if (credentialChain) {
          expect(credentialChain.expectedImpact).toContain("ACCOUNT_TAKEOVER")
        }

        await Session.remove(session.id)
      },
    })
  })

  test("detects xss_csrf chain when XSS VRT check is vulnerable", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // Add endpoint with XSS (generates VRT checks including XSS)
        const xssEntry = Intel.add({
          sessionID: session.id,
          data: {
            type: "endpoint",
            severity: "medium",
            title: "GET /search",
            detail: "Search endpoint with XSS via q parameter",
            asset: "app.example.com",
            source: "test",
            confidenceLevel: "confirmed",
            tags: ["xss"],
          },
        })

        // Mark the XSS VRT check as vulnerable (required for chain detection)
        const checks = Intel.getVrtChecks(session.id, xssEntry.id)
        const xssCheck = checks.find((c) => c.category.includes("XSS"))
        if (xssCheck) {
          Intel.updateVrtCheck(session.id, xssCheck.entryID, xssCheck.category, {
            status: "tested_vulnerable",
            technique: "Manual testing",
            testedBy: "test-agent",
            evidence: { requestSent: "GET /search?q=<script>alert(1)</script>" },
          })
        }

        // Add state-changing endpoint (POST = state change)
        Intel.add({
          sessionID: session.id,
          data: {
            type: "endpoint",
            severity: "medium",
            title: "POST /api/user/update",
            detail: "State-changing user update endpoint, no CSRF protection",
            asset: "app.example.com",
            source: "test",
            confidenceLevel: "high",
            tags: ["state-change", "csrf"],
          },
        })

        const chains = Chain.detect(session.id)
        const xssCsrfChain = chains.find((c) => c.pattern === "xss_csrf")
        expect(xssCsrfChain).toBeDefined()

        await Session.remove(session.id)
      },
    })
  })

  test("does not detect chain for unrelated assets", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        Intel.add({
          sessionID: session.id,
          data: {
            type: "credential",
            severity: "high",
            title: "Credential found",
            detail: "admin:password",
            asset: "site-a.com",
            source: "test",
            confidenceLevel: "confirmed",
            tags: ["credential"],
          },
        })

        Intel.add({
          sessionID: session.id,
          data: {
            type: "endpoint",
            severity: "medium",
            title: "Admin endpoint",
            detail: "/admin/dashboard",
            asset: "completely-different-site.com",
            source: "test",
            confidenceLevel: "confirmed",
            tags: ["admin"],
          },
        })

        const chains = Chain.detect(session.id)
        // These are on completely different domains, so no chain should form
        const credChain = chains.find((c) => c.pattern === "credential_endpoint")
        expect(credChain).toBeUndefined()

        await Session.remove(session.id)
      },
    })
  })

  test("save and load persists chains", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        Intel.add({
          sessionID: session.id,
          data: {
            type: "credential",
            severity: "high",
            title: "Leaked API key",
            detail: "API key found in JS source",
            asset: "target.com",
            source: "test",
            confidenceLevel: "confirmed",
            tags: ["credential"],
          },
        })

        Intel.add({
          sessionID: session.id,
          data: {
            type: "endpoint",
            severity: "medium",
            title: "GET /api/sensitive",
            detail: "Sensitive data endpoint",
            asset: "target.com",
            source: "test",
            confidenceLevel: "confirmed",
            tags: ["endpoint"],
          },
        })

        const detected = Chain.detect(session.id)
        if (detected.length > 0) {
          Chain.save(session.id, detected)
          const loaded = Chain.load(session.id)
          expect(loaded.length).toBe(detected.length)
          expect(loaded[0].pattern).toBe(detected[0].pattern)
        }

        await Session.remove(session.id)
      },
    })
  })
})

describe("Chain — Format", () => {
  test("formatForPrompt returns empty string for empty chains", () => {
    const result = Chain.formatForPrompt([])
    expect(result).toBe("")
  })

  test("formatForPrompt returns markdown for chains", () => {
    const chains: Chain.Candidate[] = [
      {
        id: "test-chain-1",
        pattern: "credential_endpoint",
        entryIDs: ["a", "b"],
        entryTitles: ["Cred found", "Admin endpoint"],
        assets: ["target.com"],
        expectedImpact: "ACCOUNT_TAKEOVER",
        severity: "critical",
        testingPlan: "Use credential on endpoint",
        status: "detected",
        confidence: 80,
        detectedAt: Date.now(),
      },
    ]
    const result = Chain.formatForPrompt(chains)
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain("Chain")
    expect(result).toContain("CREDENTIAL_ENDPOINT")
  })
})
