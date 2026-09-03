import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { PageState } from "../session/web/page-state"
import { WebControl } from "../session/web/control"

const description = `Drive the live browser: click / type / navigate — the co-driving "hands".

Target elements by the stable id from web_get_page_state (not a CSS selector). The SAME
deterministic guard that annotates page-state is enforced here on the exact element:
- a logout / sign-out element is DENIED — never ends the authenticated session mid-crawl;
- a destructive element (delete / cancel account / revoke …) needs a human's confirmation and
  is skipped automatically — report it instead of forcing it;
- everything else is relayed to the extension and acked.

ops:
  click    — click element_id.
  type     — focus element_id and set its value to text (fires input/change).
  navigate — go to url (no element_id).

Call web_get_page_state first to see ids, kinds and policies. When url is omitted for
click/type, the page the browser is currently on is used.`

export const WebActionTool = Tool.define("web_action", {
  description,
  parameters: z.object({
    op: z.enum(["click", "type", "navigate"]).describe("click | type | navigate"),
    element_id: z.string().optional().describe("Stable element id from web_get_page_state (click/type)."),
    text: z.string().optional().describe("Text to enter (type only)."),
    url: z.string().optional().describe("navigate: destination url. click/type: page url (defaults to current)."),
  }),
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Record<string, unknown> }> {
    const sessionID = Session.root(ctx.sessionID)

    if (!WebControl.connected(sessionID)) {
      return {
        title: "No browser attached",
        output: "No extension is connected on this session — cannot act. Start capture in a browser first.",
        metadata: { ok: false, error: "no-extension" },
      }
    }

    const relay = async (cmd: Record<string, unknown>, note: string) => {
      const ack = await WebControl.send(sessionID, cmd)
      if (ack.ok) return { title: `web_action: ${note}`, output: `OK — ${note}`, metadata: { ok: true } }
      const why =
        ack.error === "no-extension"
          ? "no browser attached"
          : ack.error === "timeout"
            ? "timed out waiting for the browser"
            : ack.error === "element not found"
              ? "the browser could not find that element (the page may have changed — re-read web_get_page_state)"
              : ack.error || "relay failed"
      return { title: `web_action failed: ${note}`, output: `FAILED — ${why}`, metadata: { ok: false, error: ack.error } }
    }

    if (params.op === "navigate") {
      if (!params.url) return { title: "url required", output: "navigate needs a url.", metadata: { ok: false } }
      return relay({ op: "navigate", url: params.url }, `navigate → ${params.url}`)
    }

    if (!params.element_id)
      return { title: "element_id required", output: `${params.op} needs an element_id.`, metadata: { ok: false } }

    const url = params.url ?? PageState.current(sessionID)?.url
    if (!url)
      return {
        title: "no page",
        output: "No current page and no url given. Call web_get_page_state first.",
        metadata: { ok: false },
      }

    const pol = PageState.elementPolicy(sessionID, url, params.element_id)
    if (!pol)
      return {
        title: "unknown element",
        output: `No element "${params.element_id}" in page-state for ${url}. Re-read web_get_page_state — the page may have changed.`,
        metadata: { ok: false, error: "unknown-element" },
      }
    if (pol.policy === "deny")
      return {
        title: `BLOCKED (logout): ${pol.label}`,
        output: `Guard DENIED this ${pol.kind} element ("${pol.label}"). Logging out would end the authenticated session — never do it during a crawl. Skip it.`,
        metadata: { ok: false, policy: "deny", kind: pol.kind },
      }
    if (pol.policy === "confirm")
      return {
        title: `NEEDS HUMAN CONFIRMATION (destructive): ${pol.label}`,
        output: `This ${pol.kind} element ("${pol.label}") is irreversible and requires a human to confirm. Skipped — report it as a destructive action the human should review, do not retry.`,
        metadata: { ok: false, policy: "confirm", kind: pol.kind },
      }

    const label = pol.label || params.element_id
    if (params.op === "type")
      return relay({ op: "type", elementId: params.element_id, text: params.text ?? "" }, `type into ${label}`)
    return relay({ op: "click", elementId: params.element_id }, `click ${label}`)
  },
})
