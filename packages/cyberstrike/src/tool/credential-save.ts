import z from "zod"
import { Tool } from "./tool"
import { WebCredential } from "../session/web/web-credential"
import { Session } from "../session"

export const CredentialSaveTool = Tool.define("credential_save", {
  description: `Save login credentials to the session vault for hackbrowser auto-fill.

When the user provides login credentials in chat (username/password, email/password, etc.), call this tool to store them in the credential vault. The hackbrowser crawler will then use these credentials to auto-fill login forms during crawling.

Multiple credentials can be saved — one per role (admin, user, moderator, etc.). Each gets a label to identify the role.

This tool ONLY stores login inputs (username + password). Auth headers and tokens are captured automatically during hackbrowser crawls — do NOT pass headers here.

Examples of when to call this tool:
- User says "admin credentials are admin@site.com / Pass123"
- User says "use user1:password1 for testing"
- User provides multiple accounts for different roles`,
  parameters: z.object({
    credentials: z
      .array(
        z.object({
          label: z.string().describe("Role label for this credential (e.g. 'admin', 'regular-user', 'moderator')"),
          username: z.string().describe("Login username or email"),
          password: z.string().describe("Login password"),
        }),
      )
      .min(1)
      .describe("One or more credential sets to save to the vault"),
  }),
  async execute(args, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const saved: Array<{ id: string; label: string; username: string }> = []
    const skipped: Array<{ label: string; username: string; reason: string }> = []

    for (const cred of args.credentials) {
      const existing = WebCredential.get(sessionID).find(
        (c) => c.username === cred.username && c.label === cred.label,
      )

      if (existing) {
        WebCredential.update({
          id: existing.id,
          sessionID,
          password: cred.password,
          valid: true,
        })
        saved.push({ id: existing.id, label: cred.label, username: cred.username })
        continue
      }

      const info = WebCredential.add({
        sessionID,
        label: cred.label,
        username: cred.username,
        password: cred.password,
      })
      saved.push({ id: info.id, label: cred.label, username: cred.username })
    }

    if (saved.length === 0) {
      return {
        title: "credential_save: nothing saved",
        output: skipped.map((s) => `${s.label} (${s.username}): ${s.reason}`).join("\n"),
        metadata: { saved: 0, ids: [] as string[] },
      }
    }

    const lines = saved.map((s) => `  ${s.label}: ${s.username} → ${s.id}`)
    return {
      title: `Saved ${saved.length} credential${saved.length > 1 ? "s" : ""} to vault`,
      output: [
        `${saved.length} credential${saved.length > 1 ? "s" : ""} saved to session vault:`,
        ...lines,
        ``,
        `These will be available for hackbrowser auto-fill.`,
        `Use hackbrowser to crawl — it will ask which credentials to use.`,
      ].join("\n"),
      metadata: { saved: saved.length, ids: saved.map((s) => s.id) },
    }
  },
})
