import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { MCP } from "../../mcp"
import { Config } from "../../config/config"
import { BoltAuth } from "../../mcp/bolt-auth"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const BoltRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get Bolt status",
        description: "Get the status of all Bolt servers.",
        operationId: "bolt.status",
        responses: {
          200: {
            description: "Bolt server status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Status)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await MCP.boltStatus())
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Add Bolt server",
        description: "Dynamically add a new Bolt server.",
        operationId: "bolt.add",
        responses: {
          200: {
            description: "Bolt server added successfully",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Status)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          config: Config.Bolt,
        }),
      ),
      async (c) => {
        const { name, config } = c.req.valid("json")
        const result = await MCP.addBolt(name, config)
        await Config.updateGlobal({ bolt: { [name]: config } })
        return c.json(result.status)
      },
    )
    .post(
      "/:name/pair",
      describeRoute({
        summary: "Pair with Bolt server",
        description: "Pair with a Bolt server using Ed25519 key exchange. Requires admin token.",
        operationId: "bolt.pair",
        responses: {
          200: {
            description: "Bolt pairing successful",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    clientId: z.string(),
                    serverFingerprint: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          url: z.string().describe("Bolt server URL"),
          adminToken: z.string().describe("Admin token for pairing authorization"),
        }),
      ),
      async (c) => {
        const name = c.req.param("name")
        const { url, adminToken } = c.req.valid("json")
        try {
          const result = await BoltAuth.pair(name, url, adminToken)
          return c.json(result)
        } catch (error) {
          return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
        }
      },
    )
    .post(
      "/:name/connect",
      describeRoute({
        summary: "Connect a Bolt server",
        operationId: "bolt.connect",
        responses: {
          200: {
            description: "Bolt server connected",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const { name } = c.req.valid("param")
        await MCP.connectBolt(name)
        return c.json(true)
      },
    )
    .post(
      "/:name/disconnect",
      describeRoute({
        summary: "Disconnect a Bolt server",
        operationId: "bolt.disconnect",
        responses: {
          200: {
            description: "Bolt server disconnected",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const { name } = c.req.valid("param")
        await MCP.disconnectBolt(name)
        return c.json(true)
      },
    )
    .delete(
      "/:name",
      describeRoute({
        summary: "Remove a Bolt server",
        description: "Disconnect and permanently remove a Bolt server from configuration.",
        operationId: "bolt.remove",
        responses: {
          200: {
            description: "Bolt server removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const { name } = c.req.valid("param")
        await MCP.removeBolt(name)
        return c.json(true)
      },
    ),
)
