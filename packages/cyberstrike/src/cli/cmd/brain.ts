import { cmd } from "./cmd"
import { BrainRelay } from "../../brain/relay"
import { BrainExecutor } from "../../brain/executor"
import { Installation } from "../../installation"

const DEFAULT_BRAIN_URL = "wss://brain.cyberstrike.io/v1/ws"

export const BrainCommand = cmd({
  command: "brain <action>",
  describe: "connect to CyberStrike Brain (Pro/Enterprise)",
  builder: (yargs) =>
    yargs
      .positional("action", {
        choices: ["connect", "status", "disconnect"] as const,
        describe: "brain action",
      })
      .option("url", {
        type: "string",
        describe: "brain service URL (default: wss://brain.cyberstrike.io/v1/ws)",
      })
      .option("license", {
        type: "string",
        describe: "license token (or set CYBERSTRIKE_LICENSE env var)",
      })
      .option("domain", {
        type: "string",
        describe: "domain to assess (aws, azure, gcp, internal)",
      })
      .option("message", {
        type: "string",
        alias: "m",
        describe: "assessment request message",
      }),
  handler: async (args) => {
    const action = args.action as string

    if (action === "status") {
      if (BrainRelay.isConnected()) {
        console.log("Connected to CyberStrike Brain")
      } else {
        console.log("Not connected")
      }
      return
    }

    if (action === "disconnect") {
      BrainRelay.disconnect()
      console.log("Disconnected from CyberStrike Brain")
      return
    }

    if (action === "connect") {
      const license = args.license ?? process.env["CYBERSTRIKE_LICENSE"]
      if (!license) {
        console.error("Error: license required. Set CYBERSTRIKE_LICENSE or use --license")
        process.exit(1)
      }

      const url = args.url ?? process.env["CYBERSTRIKE_BRAIN_URL"] ?? DEFAULT_BRAIN_URL
      console.log(`Connecting to CyberStrike Brain at ${url}...`)

      await BrainRelay.connect({
        url,
        license,
        version: Installation.VERSION,
        capabilities: ["aws", "azure", "gcp", "internal", "web"],
        onToolCall: BrainExecutor.execute,
        onConnected: (sessionId, tier) => {
          console.log(`Connected! Session: ${sessionId}, Tier: ${tier}`)
        },
        onStreamDelta: (_requestId, delta) => {
          process.stdout.write(delta)
        },
        onResponse: (_requestId, content) => {
          console.log("\n" + content)
        },
        onError: (_requestId, code, message) => {
          console.error(`Brain error [${code}]: ${message}`)
        },
        onDisconnect: () => {
          console.log("Disconnected from Brain. Reconnecting...")
        },
      })

      if (args.domain && args.message) {
        const id = crypto.randomUUID()
        BrainRelay.request(id, args.domain, args.message)
      }

      await new Promise(() => {})
    }
  },
})
