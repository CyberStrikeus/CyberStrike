import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import { Methodology } from "../../methodology/methodology"
import { Intel } from "../../methodology/intel"
import { Chain } from "../../methodology/chain"
import { Validation } from "../../methodology/validation"
import { AgentPerformance } from "../../methodology/performance"
import { Session } from "../../session"

const sessionParam = z.object({
  sessionID: z.string(),
})

export const MethodologyRoutes = lazy(() =>
  new Hono()
    // Methodology state (phases, violations, completion)
    .get(
      "/session/:sessionID/state",
      describeRoute({
        summary: "Get methodology state",
        description: "Returns phase progression, violations, and completion percentage for a session.",
        operationId: "methodology.state",
        responses: {
          200: {
            description: "Methodology state",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    phases: z.array(
                      z.object({
                        id: z.string(),
                        name: z.string(),
                        status: z.string(),
                        deliverableCount: z.number(),
                      }),
                    ),
                    violations: z.array(
                      z.object({
                        gate: z.string(),
                        severity: z.string(),
                        message: z.string(),
                      }),
                    ),
                    completionPercent: z.number(),
                    completedCount: z.number(),
                    totalCount: z.number(),
                    currentPhase: z.string().nullable(),
                  }),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", sessionParam),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const rootSession = Session.root(sessionID)
        const state = Methodology.computeState(rootSession)
        return c.json(state)
      },
    )

    // Intel entries for a session
    .get(
      "/session/:sessionID/intel",
      describeRoute({
        summary: "Get intel entries",
        description: "Returns all intelligence entries for a session.",
        operationId: "methodology.intel",
        responses: {
          200: {
            description: "Intel entries",
            content: {
              "application/json": {
                schema: resolver(z.array(z.record(z.string(), z.any()))),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", sessionParam),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const rootSession = Session.root(sessionID)
        const entries = Intel.get(rootSession)
        return c.json(entries)
      },
    )

    // Coverage report
    .get(
      "/session/:sessionID/intel/coverage",
      describeRoute({
        summary: "Get coverage report",
        description: "Returns VRT coverage statistics and untested items.",
        operationId: "methodology.coverage",
        responses: {
          200: {
            description: "Coverage report",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    totalChecks: z.number(),
                    completedChecks: z.number(),
                    vulnerableChecks: z.number(),
                    coveragePercent: z.number(),
                    totalEntries: z.number(),
                  }),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", sessionParam),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const rootSession = Session.root(sessionID)
        const coverage = Intel.computeCoverage(rootSession)
        return c.json(coverage)
      },
    )

    // Chain candidates
    .get(
      "/session/:sessionID/chains",
      describeRoute({
        summary: "Get chain candidates",
        description: "Returns detected vulnerability chain opportunities.",
        operationId: "methodology.chains",
        responses: {
          200: {
            description: "Chain candidates",
            content: {
              "application/json": {
                schema: resolver(z.array(z.record(z.string(), z.any()))),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", sessionParam),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const rootSession = Session.root(sessionID)
        const chains = Chain.load(rootSession)
        return c.json(chains)
      },
    )

    // Validation violations
    .get(
      "/session/:sessionID/violations",
      describeRoute({
        summary: "Get validation violations",
        description: "Returns methodology and evidence quality violations.",
        operationId: "methodology.violations",
        responses: {
          200: {
            description: "Validation results",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    summary: z.string(),
                    blockingCount: z.number(),
                    warningCount: z.number(),
                  }),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", sessionParam),
      validator(
        "query",
        z.object({
          scope_items: z.string().optional(),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const query = c.req.valid("query")
        const rootSession = Session.root(sessionID)
        const scopeItems = query.scope_items ? query.scope_items.split(",") : []
        const gates = Validation.runAllGates(rootSession, scopeItems)
        return c.json(gates)
      },
    )

    // Agent performance
    .get(
      "/session/:sessionID/performance",
      describeRoute({
        summary: "Get agent performance",
        description: "Returns Liyakat scores and mission stats for all agents in a session.",
        operationId: "methodology.performance",
        responses: {
          200: {
            description: "Agent performance data",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      agent: z.string(),
                      stats: z.object({
                        missionsCompleted: z.number(),
                        findingsReported: z.number(),
                        chainsContributed: z.number(),
                        turnsUsed: z.number(),
                        successRate: z.number(),
                        coverageContributed: z.number(),
                        rejectionCount: z.number(),
                        averageEvidenceQuality: z.number(),
                        performanceScore: z.number(),
                        morale: z.number(),
                      }),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", sessionParam),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const rootSession = Session.root(sessionID)
        const agents = [
          "web-application",
          "proxy-agent",
          "explore",
          "cloud-security",
          "internal-network",
          "mobile-application",
          "cyberstrike",
        ]
        const results = agents.map((agent) => ({
          agent,
          stats: AgentPerformance.getOrCreate(rootSession, agent),
        }))
        return c.json(results)
      },
    )

    // Per-asset coverage
    .get(
      "/session/:sessionID/intel/coverage/assets",
      describeRoute({
        summary: "Get per-asset coverage",
        description: "Returns VRT coverage broken down by target asset.",
        operationId: "methodology.assetCoverage",
        responses: {
          200: {
            description: "Per-asset coverage",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      asset: z.string(),
                      totalChecks: z.number(),
                      completedChecks: z.number(),
                      vulnerableChecks: z.number(),
                      coveragePercent: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", sessionParam),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const rootSession = Session.root(sessionID)
        const assetCoverage = Intel.computePerAssetCoverage(rootSession)
        return c.json(assetCoverage)
      },
    ),
)
