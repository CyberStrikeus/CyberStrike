import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless cyberstrike server",
  handler: async (args) => {
    if (!Flag.CYBERSTRIKE_SERVER_PASSWORD) {
      console.error(
        "Error: CYBERSTRIKE_SERVER_PASSWORD is required.\nSet it with: export CYBERSTRIKE_SERVER_PASSWORD=yourpassword",
      )
      process.exit(1)
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`cyberstrike server listening on http://${server.hostname}:${server.port}`)
    await new Promise(() => {})
    await server.stop()
  },
})
