import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Session } from "../../session"
import { Topology } from "../../topology"
import { lazy } from "../../util/lazy"
import { TargetNote } from "../../topology/note"

export const TopologyRoutes = lazy(() =>
  new Hono()
    .get(
    "/session/:sessionID",
    describeRoute({
      summary: "Get session topology",
      description: "Get a redacted graph projection of session assets, hosts, endpoints, identities, and findings.",
      operationId: "topology.get",
      responses: {
        200: {
          description: "Session topology",
          content: {
            "application/json": {
              schema: resolver(Topology.Snapshot),
            },
          },
        },
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    (c) => {
      const { sessionID } = c.req.valid("param")
      return c.json(Topology.get(Session.root(sessionID)))
    },
    )
    .get(
      "/session/:sessionID/notes",
      describeRoute({
        summary: "List target notes",
        description: "Get operator notes and links for topology entities.",
        operationId: "topology.notes",
        responses: {
          200: {
            description: "Target notes",
            content: {
              "application/json": {
                schema: resolver(TargetNote.Info.array()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("query", z.object({ entityID: z.string().optional() })),
      (c) => {
        const { sessionID } = c.req.valid("param")
        const root = Session.root(sessionID)
        return c.json(TargetNote.list(root, c.req.valid("query").entityID))
      },
    )
    .post(
      "/session/:sessionID/notes",
      describeRoute({
        summary: "Create target note",
        description: "Add an operator-authored note to a topology entity.",
        operationId: "topology.noteCreate",
        responses: {
          200: {
            description: "Created target note",
            content: {
              "application/json": {
                schema: resolver(TargetNote.Info),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("json", TargetNote.Create),
      (c) => {
        const { sessionID } = c.req.valid("param")
        return c.json(TargetNote.add(Session.root(sessionID), c.req.valid("json")))
      },
    )
    .patch(
      "/session/:sessionID/notes/:noteID",
      describeRoute({
        summary: "Update target note",
        operationId: "topology.noteUpdate",
        responses: {
          200: {
            description: "Updated target note",
            content: {
              "application/json": {
                schema: resolver(TargetNote.Info.optional()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string(), noteID: z.string() })),
      validator("json", TargetNote.Update),
      (c) => {
        const { sessionID, noteID } = c.req.valid("param")
        return c.json(TargetNote.update(Session.root(sessionID), noteID, c.req.valid("json")))
      },
    )
    .delete(
      "/session/:sessionID/notes/:noteID",
      describeRoute({
        summary: "Delete target note",
        operationId: "topology.noteDelete",
        responses: {
          200: {
            description: "Target note removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string(), noteID: z.string() })),
      (c) => {
        const { sessionID, noteID } = c.req.valid("param")
        return c.json(TargetNote.remove(Session.root(sessionID), noteID))
      },
    ),
)
