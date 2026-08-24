import z from "zod"
import { Tool } from "./tool"
import { launchHackbrowser } from "./hackbrowser-launcher"
import { HackbrowserStatus } from "../session/hackbrowser-status"
import { HackbrowserMode } from "../session/hackbrowser-mode"

const DESCRIPTION = `Crawl a web application autonomously and capture HTTP requests with UI context.

Use this when you have a target URL but no captured requests yet — hackbrowser will navigate the app, fill forms, clicks buttons, and stream every HTTP request into the current session for later vulnerability analysis. After captures arrive, the proxy-analyzer ingest pipeline analyzes them automatically.

This tool runs ASYNCHRONOUSLY: it returns immediately after starting the background crawl. Captures stream into the session over the next 30s–2min. Do NOT call this tool again to "wait" for results — use web_get_session_context to inspect captured endpoints when you actually need them. The hackbrowser status (running / completed / failed) appears in the TUI sidebar.

When you know which mode the user wants (they said it in chat, or context makes it obvious), pass \`mode\` directly. When you do NOT know, omit \`mode\` — the tool will ask the user automatically via a structured question UI.

Available modes:
- full-auto-headless — AI crawls autonomously, no browser window. Fastest option.
- full-auto-headed — AI crawls with visible browser window. For watching/debugging.
- co-pilot — AI crawls but user can pause and intervene. Best for complex apps. (Coming soon)
- observer — User browses manually, only HTTP traffic is captured. (Coming soon)

Authentication options:
- \`login\` — pass username + password for automatic login. The crawler fills the login form and proceeds. Use this in Full Auto mode when the user provides credentials in chat. No manual interaction needed.
- \`credentials\` — pass credential IDs for manual login. The browser opens visibly and waits for the user to log in before crawling. Use for complex auth flows (2FA, OAuth, CAPTCHA) where auto-fill won't work. Forces visible browser.

Do NOT combine \`login\` and \`credentials\` — use one or the other.`

export const HackbrowserTool = Tool.define("hackbrowser", {
  description: DESCRIPTION,
  parameters: z.object({
    mode: HackbrowserStatus.Mode.optional().describe(
      "Crawl mode. Pass when you already know the user's preference from conversation context. " +
        "Omit to let the tool ask the user via a structured question UI. " +
        "full-auto-headless: AI crawl, no browser window. full-auto-headed: AI crawl, visible browser. " +
        "co-pilot: AI crawl with pause/resume (coming soon). observer: manual browse, capture only (coming soon).",
    ),
    target: z
      .string()
      .url()
      .describe(
        "Target URL to crawl. Used both as the start of navigation and as the basis for the auto-derived network scope (*.{eTLD+1}).",
      ),
    login: z
      .object({
        username: z.string().describe("Login username or email"),
        password: z.string().describe("Login password"),
      })
      .optional()
      .describe(
        "Auto-fill login credentials. The crawler fills the login form automatically — no manual interaction. " +
          "Use in Full Auto mode when the user provides credentials in chat. " +
          "Do NOT combine with the credentials parameter.",
      ),
    credentials: z
      .array(z.string())
      .optional()
      .describe(
        "Credential IDs for manual login. Opens browser visibly, waits for user to log in, then crawls. " +
          "Use for complex auth (2FA, OAuth, CAPTCHA) where auto-fill won't work. " +
          "Forces headless: false. Only use when a human is present.",
      ),
    scope: z
      .array(z.string())
      .optional()
      .describe(
        'Optional network scope override. Hostname patterns ("*.example.com") that bound which requests get captured. Replaces the auto-derived default.',
      ),
    exclude: z
      .array(z.string())
      .optional()
      .describe(
        'Optional UI labels the planner must skip (e.g. "Delete Account", "Cancel Subscription"). Semantic match.',
      ),
    steps: z.number().int().min(1).max(200).optional().describe("Maximum number of pages to crawl. Defaults to 50."),
  }),
  async execute(args, ctx) {
    const mode = await HackbrowserMode.resolve(
      ctx.sessionID,
      args.mode,
      ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    )

    if (HackbrowserMode.PHASE_2.has(mode)) {
      return {
        title: `hackbrowser ${args.target}`,
        output: `Mode "${mode}" is not available yet. Please select full-auto-headless or full-auto-headed.`,
        metadata: {},
      }
    }

    if (args.login && args.credentials && args.credentials.length > 0) {
      return {
        title: `hackbrowser ${args.target}`,
        output: `Cannot combine "login" (auto-fill) with "credentials" (manual login). Use one or the other.`,
        metadata: {},
      }
    }

    await ctx.ask({
      permission: "hackbrowser",
      patterns: [args.target],
      always: [args.target],
      metadata: { scope: args.scope, exclude: args.exclude },
    })

    const config = HackbrowserMode.toConfig(mode, args.credentials)

    const kickOff = await launchHackbrowser({
      target: args.target,
      sessionID: ctx.sessionID,
      scope: args.scope,
      exclude: args.exclude,
      credentials: args.credentials,
      steps: args.steps,
      headless: config.headless,
      mode,
      loginCredentials: args.login,
      signal: ctx.abort,
    })

    const credentialOverride = mode === "full-auto-headless" && args.credentials && args.credentials.length > 0
    const authInfo = args.login
      ? `Auto-fill login enabled — crawler will fill login forms automatically.`
      : credentialOverride
        ? `Note: browser opened visibly — credentials require manual login.`
        : null
    const output = [
      `Hackbrowser crawl started for ${args.target} in ${mode} mode.`,
      ...(authInfo ? [authInfo] : []),
      `Captures stream into this session as the crawl progresses (typically 30s–2min).`,
      ``,
      `Do NOT call this tool again to wait for results — it is already running.`,
      `Use web_get_session_context to inspect captured endpoints when you need them.`,
      `Live progress (running / completed / failed) appears in the TUI sidebar.`,
    ].join("\n")

    return {
      title: `hackbrowser ${args.target}`,
      output,
      metadata: {
        sessionID: kickOff.sessionID,
        started: kickOff.started,
      },
    }
  },
})
