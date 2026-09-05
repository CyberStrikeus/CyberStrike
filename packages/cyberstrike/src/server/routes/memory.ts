import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { MemoryStore } from "../../memory/store"
import { Session } from "../../session"
import { lazy } from "../../util/lazy"

const SessionID = z.string().optional()

export const MemoryRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List structured memory",
        description: "List valid project and engagement memory with provenance.",
        operationId: "memory.list",
        responses: {
          200: {
            description: "Memory entries",
            content: {
              "application/json": {
                schema: resolver(MemoryStore.Info.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          sessionID: SessionID,
          kind: MemoryStore.Kind.optional(),
          includeInvalid: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
      ),
      (c) => {
        const query = c.req.valid("query")
        return c.json(
          MemoryStore.list({
            ...query,
            sessionID: query.sessionID ? Session.root(query.sessionID) : undefined,
          }),
        )
      },
    )
    .get(
      "/search",
      describeRoute({
        summary: "Search structured memory",
        description: "Run engagement-scoped FTS retrieval over valid memory.",
        operationId: "memory.search",
        responses: {
          200: {
            description: "Ranked memory entries",
            content: {
              "application/json": {
                schema: resolver(MemoryStore.Info.extend({ rank: z.number() }).array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string().min(1),
          sessionID: SessionID,
          kind: MemoryStore.Kind.optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
      ),
      (c) => {
        const query = c.req.valid("query")
        return c.json(
          MemoryStore.search({
            ...query,
            sessionID: query.sessionID ? Session.root(query.sessionID) : undefined,
          }),
        )
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create human memory",
        description: "Create a human-trusted project or engagement memory entry with secret redaction.",
        operationId: "memory.create",
        responses: {
          200: {
            description: "Created memory entry",
            content: {
              "application/json": {
                schema: resolver(MemoryStore.Info),
              },
            },
          },
        },
      }),
      validator("json", MemoryStore.Create.omit({ source: true, trust: true })),
      (c) => {
        const body = c.req.valid("json")
        return c.json(
          MemoryStore.add({
            ...body,
            sessionID: body.sessionID ? Session.root(body.sessionID) : undefined,
            source: "operator",
            trust: "human",
          }),
        )
      },
    )
    .post(
      "/:entryID/invalidate",
      describeRoute({
        summary: "Invalidate memory",
        description: "Soft-invalidate a memory entry while preserving its audit history.",
        operationId: "memory.invalidate",
        responses: {
          200: {
            description: "Invalidated memory entry",
            content: {
              "application/json": {
                schema: resolver(MemoryStore.Info.optional()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ entryID: z.string() })),
      (c) => c.json(MemoryStore.invalidate(c.req.valid("param").entryID)),
    )
    .post(
      "/:entryID/promote",
      describeRoute({
        summary: "Promote evaluated memory",
        description: "Promote a candidate lesson to human-trusted procedural memory after evaluation gates pass.",
        operationId: "memory.promote",
        responses: {
          200: {
            description: "Promoted procedural memory",
            content: {
              "application/json": {
                schema: resolver(MemoryStore.Info),
              },
            },
          },
        },
      }),
      validator("param", z.object({ entryID: z.string() })),
      validator("json", MemoryStore.Promotion),
      (c) => c.json(MemoryStore.promote(c.req.valid("param").entryID, c.req.valid("json"))),
    ),
)
