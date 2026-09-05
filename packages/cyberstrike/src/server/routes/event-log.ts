import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { EngagementEvent } from "../../event"
import { lazy } from "../../util/lazy"

export const EventLogRoutes = lazy(() =>
  new Hono()
    .get(
      "/session/:sessionID",
      describeRoute({
        summary: "List durable engagement events",
        description: "Get redacted execution events for a session in chronological order.",
        operationId: "eventLog.list",
        responses: {
          200: {
            description: "Engagement events",
            content: {
              "application/json": {
                schema: resolver(EngagementEvent.Info.array()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator(
        "query",
        z.object({
          before: z.coerce.number().int().positive().optional(),
          beforeID: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
      ),
      (c) => {
        const { sessionID } = c.req.valid("param")
        const query = c.req.valid("query")
        return c.json(EngagementEvent.list({ sessionID, ...query }))
      },
    )
    .get(
      "/session/:sessionID/stream",
      describeRoute({
        summary: "Stream engagement events",
        description: "Subscribe to redacted execution events for one session.",
        operationId: "eventLog.stream",
        responses: {
          200: {
            description: "Engagement event stream",
            content: {
              "text/event-stream": {
                schema: resolver(EngagementEvent.Info),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      (c) => {
        const { sessionID } = c.req.valid("param")
        c.header("Cache-Control", "no-cache, no-transform")
        c.header("X-Accel-Buffering", "no")
        c.header("Connection", "keep-alive")
        return streamSSE(c, async (stream) => {
          const closed = new Promise<void>((resolve) => stream.onAbort(resolve))
          let off = () => {}
          const disposed = new Promise<void>((resolve) => {
            off = EngagementEvent.onDispose(resolve)
          })
          const unsub = EngagementEvent.subscribe((event) => {
            if (event.sessionID !== sessionID) return
            void stream.writeSSE({ id: event.id, data: JSON.stringify(event) })
          })
          const heartbeat = setInterval(() => {
            void stream.write(": heartbeat\n\n")
          }, 30_000)
          try {
            await stream.write(": connected\n\n")
            await Promise.race([closed, disposed])
          } finally {
            clearInterval(heartbeat)
            off()
            unsub()
          }
        })
      },
    ),
)
