import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { listen as listenV2 } from "../../api-v2/server"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs).options({
      api: {
        type: "string" as const,
        describe: "also start a second listener speaking this API surface (v2)",
      },
      "api-port": {
        type: "number" as const,
        describe: "port for the --api listener",
        default: 4198,
      },
    }),
  describe: "starts a headless cyberstrike server",
  handler: async (args) => {
    if (!Flag.CYBERSTRIKE_SERVER_PASSWORD) {
      console.error(
        "Error: CYBERSTRIKE_SERVER_PASSWORD is required.\nSet it with: export CYBERSTRIKE_SERVER_PASSWORD=yourpassword",
      )
      process.exit(1)
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen({ ...opts, webUI: false })
    console.log(`cyberstrike server listening on http://${server.hostname}:${server.port}`)
    console.log(`API-only mode — connect from app.cyberstrike.io or use 'cyberstrike web' for built-in UI`)
    if (args.api === "v2") {
      const v2 = await listenV2({ hostname: opts.hostname, port: args["api-port"] })
      console.log(`cyberstrike v2 API listening on ${v2.url}`)
    }
    await new Promise(() => {})
    await server.stop()
  },
})
