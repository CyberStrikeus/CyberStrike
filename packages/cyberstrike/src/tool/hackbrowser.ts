// Hackbrowser tool — agent-callable wrapper around the hackbrowser library.
// All cyberstrike→hackbrowser plumbing (Provider, Server URL, log bridge,
// re-entrance) lives in hackbrowser-launcher.ts; this file is just the
// Tool.define surface (parameters, permission gate, output shape).
//
// MVP entry point per INTEGRATION.md §6 (Karar 4). Slash and CLI subcommand
// will reuse the same launcher.

import z from "zod"
import { Tool } from "./tool"
import { launchHackbrowser } from "./hackbrowser-launcher"

const DESCRIPTION = `Crawl a web application autonomously and capture HTTP requests with UI context.

Use this when you have a target URL but no captured requests yet — hackbrowser will navigate the app, fill forms, click buttons, and stream every HTTP request into the current session for later vulnerability analysis. After captures arrive, the proxy-analyzer ingest pipeline analyzes them automatically.

This tool runs ASYNCHRONOUSLY: it returns immediately after starting the background crawl. Captures stream into the session over the next 30s–2min. Do NOT call this tool again to "wait" for results — use web_get_session_context to inspect captured endpoints when you actually need them. The hackbrowser status (running / completed / failed) appears in the TUI sidebar.

Defaults to headless mode.`

export const HackbrowserTool = Tool.define("hackbrowser", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().url().describe("Target URL to crawl. Used both as the start of navigation and as the basis for the auto-derived network scope (*.{eTLD+1})."),
    scope: z
      .array(z.string())
      .optional()
      .describe('Optional network scope override. Hostname patterns ("*.example.com") that bound which requests get captured. Replaces the auto-derived default.'),
    exclude: z
      .array(z.string())
      .optional()
      .describe('Optional UI labels the planner must skip (e.g. "Delete Account", "Cancel Subscription"). Semantic match.'),
    credentialID: z
      .string()
      .optional()
      .describe("Credential ID to tag captures with (when the session has a registered credential)."),
    steps: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Maximum number of pages to crawl. Defaults to 50."),
    headless: z
      .boolean()
      .optional()
      .describe("Open the browser with a visible window when false (useful for visual debug). Defaults to true (headless). The TUI sidebar still shows live progress in either mode."),
  }),
  async execute(args, ctx) {
    // Permission gate — opening a browser + outbound network is high-risk;
    // require explicit consent. Pattern is the target URL so the user can
    // grant blanket permission for a host on first use.
    await ctx.ask({
      permission: "hackbrowser",
      patterns: [args.url],
      always: [args.url],
      metadata: { scope: args.scope, exclude: args.exclude },
    })

    // Fire and forget — launchHackbrowser returns immediately after sync
    // prep (Provider resolve, Server URL, log sink). The actual runCrawl
    // runs in a background IIFE so the chat session prompt loop unblocks
    // and ingest queue tasks (proxy-analyzer dispatches) can run in
    // parallel (INTEGRATION.md §10.9 / §13.6).
    const kickOff = await launchHackbrowser({
      url: args.url,
      sessionID: ctx.sessionID,
      scope: args.scope,
      exclude: args.exclude,
      credentialID: args.credentialID,
      steps: args.steps,
      headless: args.headless,
      signal: ctx.abort,
    })

    // Output is intentionally a "started" notice, NOT a result summary.
    // Spell-out is for weak LLMs — see feedback_weak_llm_baseline:
    // explicit "do NOT poll" + "use web_get_session_context when you
    // need them" prevents looped re-invocation.
    const output = [
      `Hackbrowser crawl started for ${args.url}.`,
      `Captures stream into this session as the crawl progresses (typically 30s–2min).`,
      ``,
      `Do NOT call this tool again to wait for results — it is already running.`,
      `Use web_get_session_context to inspect captured endpoints when you need them.`,
      `Live progress (running / completed / failed) appears in the TUI sidebar.`,
    ].join("\n")

    return {
      title: `hackbrowser ${args.url}`,
      output,
      metadata: {
        sessionID: kickOff.sessionID,
        started: kickOff.started,
      },
    }
  },
})
