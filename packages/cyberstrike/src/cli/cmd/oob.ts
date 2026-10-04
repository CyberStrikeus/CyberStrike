import { cmd } from "./cmd"
import { OobServer } from "../../oob/server"

export const OobCommand = cmd({
  command: "oob",
  describe: "run the out-of-band interaction server (DNS + HTTP capture for blind-vuln confirmation)",
  handler: async () => {
    if (!OobServer.configured()) {
      console.error(
        [
          "Error: the OOB server needs a delegated domain.",
          "  export CYBERSTRIKE_OOB_DOMAIN=oob.yourdomain.com   # delegated to this host",
          "  export CYBERSTRIKE_OOB_IP=<this host's public IP>   # returned in DNS A answers",
          "Then delegate oob.yourdomain.com's NS to this host (glue record). See docs/oob-server.md.",
        ].join("\n"),
      )
      process.exit(1)
    }
    OobServer.start()
    console.log(`OOB server running for *.${OobServer.domain()} — Ctrl-C to stop.`)
    await new Promise(() => {})
  },
})
