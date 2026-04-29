import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Server } from "../../server/server"
import { createCyberstrikeClient } from "@cyberstrike-io/sdk/v2"
import { launchHackbrowser, stopHackbrowser } from "../../tool/hackbrowser-launcher"
import { tui } from "./tui/app"
import { UI } from "../ui"

export const HackbrowserCommand = cmd({
  command: "hackbrowser <target>",
  describe: "crawl a web app and open TUI for live analysis",
  builder: (yargs) =>
    yargs
      .positional("target", {
        type: "string",
        demandOption: true,
        describe: "target URL to crawl",
      })
      .option("scope", {
        type: "string",
        array: true,
        describe: 'hostname scope patterns (e.g. "*.example.com")',
      })
      .option("exclude", {
        type: "string",
        array: true,
        describe: 'UI labels to skip (e.g. "Delete Account")',
      })
      .option("steps", {
        type: "number",
        describe: "max pages to crawl (default 50)",
      })
      .option("credential", {
        type: "string",
        array: true,
        describe: "credential label to crawl as — repeatable, forces visible browser for manual login",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      // Real HTTP server required: tui() connects via URL, and hackbrowser's
      // ingest loopback uses Server.url() which is only set after listen().
      const server = Server.listen({ port: 0, hostname: "127.0.0.1" })
      const serverUrl = server.url.toString().replace(/\/$/, "")
      const sdk = createCyberstrikeClient({ baseUrl: serverUrl, directory: process.cwd() })

      const sessionResult = await sdk.session.create({ title: `hackbrowser: ${args.target}` })
      const sessionID = sessionResult.data?.id
      if (!sessionID) {
        UI.error("Failed to create session")
        process.exit(1)
      }

      const credentials = args.credential ?? []
      const kickOff = await launchHackbrowser({
        target: args.target,
        sessionID,
        scope: args.scope,
        exclude: args.exclude,
        steps: args.steps,
        credentials,
        headless: credentials.length === 0,
      }).catch((err: unknown) => {
        UI.error(`hackbrowser: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      })

      if (!kickOff.started) {
        UI.error(`hackbrowser: ${kickOff.message}`)
        process.exit(1)
      }

      // TUI opens immediately — crawl runs in background, sidebar updates live.
      // onExit aborts the background crawl so Playwright doesn't outlive the server.
      await tui({
        url: serverUrl,
        args: { sessionID },
        directory: process.cwd(),
        onExit: async () => {
          stopHackbrowser(sessionID)
        },
      })
    })
  },
})
