import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Session } from "../../session"
import { Topology } from "../../topology"
import { lazy } from "../../util/lazy"
import { TargetNote } from "../../topology/note"
import { NmapScan } from "../../topology/nmap"
import { NotFoundError } from "../../storage/db"

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
    .get(
      "/session/:sessionID/nmap",
      describeRoute({
        summary: "List Nmap scans",
        description: "Get saved parsed Nmap scans for a session.",
        operationId: "topology.nmapScans",
        responses: {
          200: {
            description: "Nmap scan history",
            content: {
              "application/json": {
                schema: resolver(NmapScan.Info.array()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      (c) => c.json(NmapScan.scans(Session.root(c.req.valid("param").sessionID))),
    )
    .post(
      "/session/:sessionID/nmap",
      describeRoute({
        summary: "Import Nmap XML",
        description: "Parse and persist an Nmap XML scan for topology and comparison.",
        operationId: "topology.nmapImport",
        responses: {
          200: {
            description: "Imported Nmap scan",
            content: {
              "application/json": {
                schema: resolver(NmapScan.Info),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator(
        "json",
        z.object({
          name: z.string().trim().min(1).max(200),
          xml: z.string().min(1),
          profile: z.string().max(100).optional(),
          command: z.string().max(2_000).optional(),
        }),
      ),
      (c) => {
        const { sessionID } = c.req.valid("param")
        return c.json(
          NmapScan.add({
            sessionID: Session.root(sessionID),
            source: "operator",
            ...c.req.valid("json"),
          }),
        )
      },
    )
    .get(
      "/session/:sessionID/nmap/diff",
      describeRoute({
        summary: "Compare Nmap scans",
        description: "Compare hosts, ports, and service changes between two saved scans.",
        operationId: "topology.nmapDiff",
        responses: {
          200: {
            description: "Nmap scan difference",
            content: {
              "application/json": {
                schema: resolver(NmapScan.Diff),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("query", z.object({ from: z.string(), to: z.string() })),
      (c) => {
        const root = Session.root(c.req.valid("param").sessionID)
        const query = c.req.valid("query")
        const scans = NmapScan.scans(root)
        const from = scans.find((scan) => scan.id === query.from)
        const to = scans.find((scan) => scan.id === query.to)
        if (!from || !to) throw new NotFoundError({ message: "Nmap scan not found in this session" })
        return c.json(NmapScan.diff(from, to))
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
