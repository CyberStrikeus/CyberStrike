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

Use this when you have a target URL but no captured requests yet — hackbrowser will navigate the app, fill forms, click buttons, and stream every HTTP request into the current session for later vulnerability analysis. After it completes, the proxy-analyzer (existing ingest pipeline) will analyze captures automatically.

Defaults to headless mode. Multi-credential mode (--credential) requires manual login and is not supported through the tool — use the standalone CLI for that.`

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

    const result = await launchHackbrowser({
      url: args.url,
      sessionID: ctx.sessionID,
      scope: args.scope,
      exclude: args.exclude,
      credentialID: args.credentialID,
      steps: args.steps,
      signal: ctx.abort,
    })

    const errorSuffix = result.errors.length > 0 ? ` (${result.errors.length} error${result.errors.length === 1 ? "" : "s"})` : ""
    const output = [
      `Captured ${result.capturedEndpoints} endpoint${result.capturedEndpoints === 1 ? "" : "s"} across ${result.pagesExplored} page${result.pagesExplored === 1 ? "" : "s"}${errorSuffix}.`,
      ...(result.errors.length > 0 ? ["", "Errors:", ...result.errors.map((e) => `  - ${e}`)] : []),
      "",
      "Use web_get_session_context to inspect what was discovered.",
    ].join("\n")

    return {
      title: `hackbrowser ${args.url}`,
      output,
      metadata: {
        sessionID: result.sessionID,
        capturedEndpoints: result.capturedEndpoints,
        pagesExplored: result.pagesExplored,
        totalSteps: result.totalSteps,
        errors: result.errors,
      },
    }
  },
})
