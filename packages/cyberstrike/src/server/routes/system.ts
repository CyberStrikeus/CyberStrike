import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { SystemCapabilities } from "../../system/capabilities"
import { lazy } from "../../util/lazy"

export const SystemRoutes = lazy(() =>
  new Hono().get(
    "/capabilities",
    describeRoute({
      summary: "Get execution-plane capabilities",
      description: "Get redacted host, runtime, interface, and security-tool readiness.",
      operationId: "system.capabilities",
      responses: {
        200: {
          description: "Execution-plane capabilities",
          content: {
            "application/json": {
              schema: resolver(SystemCapabilities.Info),
            },
          },
        },
      },
    }),
    async (c) => c.json(await SystemCapabilities.get()),
  ),
)
