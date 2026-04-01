import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Instance } from "../../project/instance"
import { Installation } from "@/installation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { Config } from "../../config/config"
import { errors } from "../error"

const log = Log.create({ service: "server" })

export const GlobalDisposedEvent = BusEvent.define("global.disposed", z.object({}))

export const GlobalRoutes = lazy(() =>
  new Hono()
    .get(
      "/health",
      describeRoute({
        summary: "Get health",
        description: "Get health information about the CyberStrike server.",
        operationId: "global.health",
        responses: {
          200: {
            description: "Health information",
            content: {
              "application/json": {
                schema: resolver(z.object({ healthy: z.literal(true), version: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ healthy: true, version: Installation.VERSION })
      },
    )
    .get(
      "/version-check",
      describeRoute({
        summary: "Check for updates",
        description: "Check if a newer version of CyberStrike is available.",
        operationId: "global.versionCheck",
        responses: {
          200: {
            description: "Version check result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    version: z.string(),
                    latest: z.string().optional(),
                    updateAvailable: z.boolean(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const latest = await Installation.latest().catch(() => undefined)
        const updateAvailable = !!latest && latest !== Installation.VERSION
        return c.json({
          version: Installation.VERSION,
          latest,
          updateAvailable,
        })
      },
    )
    .get(
      "/event",
      describeRoute({
        summary: "Get global events",
        description: "Subscribe to global events from the CyberStrike system using server-sent events.",
        operationId: "global.event",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(
                  z
                    .object({
                      directory: z.string(),
                      payload: BusEvent.payloads(),
                    })
                    .meta({
                      ref: "GlobalEvent",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("global event connected")
        c.header("Cache-Control", "no-cache, no-transform")
        c.header("X-Accel-Buffering", "no")
        c.header("Connection", "keep-alive")
        return streamSSE(c, async (stream) => {
          // Flush ~32KB padding to push through proxy buffers (Cloudflare tunnel, Nginx, etc.)
          for (let i = 0; i < 8; i++) await stream.write(`: ${" ".repeat(4000)}\n`)
          await stream.writeSSE({
            data: JSON.stringify({
              payload: {
                type: "server.connected",
                properties: {},
              },
            }),
          })
          async function handler(event: any) {
            await stream.writeSSE({
              data: JSON.stringify(event),
            })
          }
          GlobalBus.on("event", handler)

          // Send heartbeat every 30s to prevent WKWebView timeout (60s default)
          const heartbeat = setInterval(() => {
            stream.writeSSE({
              data: JSON.stringify({
                payload: {
                  type: "server.heartbeat",
                  properties: {},
                },
              }),
            })
          }, 30000)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              GlobalBus.off("event", handler)
              resolve()
              log.info("global event disconnected")
            })
          })
        })
      },
    )
    .get(
      "/event/poll",
      describeRoute({
        summary: "Poll global events",
        description:
          "Long-poll for global events. Returns collected events as JSON array. Use when SSE streaming is unavailable (e.g. behind Cloudflare tunnel).",
        operationId: "global.event.poll",
        responses: {
          200: {
            description: "Collected events",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      directory: z.string().optional(),
                      payload: BusEvent.payloads(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const events: Array<{ directory?: string; payload: unknown }> = []
        const handler = (event: any) => events.push(event)
        GlobalBus.on("event", handler)
        try {
          // Wait up to 5s, resolve early once events arrive
          await new Promise<void>((resolve) => {
            const check = setInterval(() => {
              if (events.length > 0) {
                clearInterval(check)
                clearTimeout(timeout)
                resolve()
              }
            }, 100)
            const timeout = setTimeout(() => {
              clearInterval(check)
              resolve()
            }, 5000)
          })
        } finally {
          GlobalBus.off("event", handler)
        }
        return c.json(events)
      },
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get global configuration",
        description: "Retrieve the current global CyberStrike configuration settings and preferences.",
        operationId: "global.config.get",
        responses: {
          200: {
            description: "Get global config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Config.getGlobal())
      },
    )
    .patch(
      "/config",
      describeRoute({
        summary: "Update global configuration",
        description: "Update global CyberStrike configuration settings and preferences.",
        operationId: "global.config.update",
        responses: {
          200: {
            description: "Successfully updated global config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        const next = await Config.updateGlobal(config)
        return c.json(next)
      },
    )
    .post(
      "/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose all CyberStrike instances, releasing all resources.",
        operationId: "global.dispose",
        responses: {
          200: {
            description: "Global disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.disposeAll()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: GlobalDisposedEvent.type,
            properties: {},
          },
        })
        return c.json(true)
      },
    ),
)
