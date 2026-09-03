import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { Crawl } from "../session/web/crawl"
import { WebAct } from "../session/web/act"

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

// Map the shared executor's structured Result onto the tool's rich, LLM-facing output.
// The gate logic lives in WebAct.perform (shared with the co-driving loop); this only
// phrases the outcome.
function present(r: WebAct.Result): { title: string; output: string; metadata: Record<string, unknown> } {
  switch (r.status) {
    case "no-extension":
      return {
        title: "No browser attached",
        output: "No extension is connected on this session — cannot act. Start capture in a browser first.",
        metadata: { ok: false, error: "no-extension" },
      }
    case "human-driving":
      return {
        title: "Human is driving",
        output:
          "The browser panel is in Human-driver mode — the AI must not act. Observe with web_get_page_state; wait until the panel is switched to AI-driver.",
        metadata: { ok: false, error: "human-driving" },
      }
    case "bad-input":
      return r.message.startsWith("navigate")
        ? { title: "url required", output: r.message, metadata: { ok: false } }
        : { title: "element_id required", output: r.message, metadata: { ok: false } }
    case "no-page":
      return { title: "no page", output: `${r.message} Call web_get_page_state first.`, metadata: { ok: false } }
    case "unknown-element":
      return { title: "unknown element", output: `${r.message} Re-read web_get_page_state.`, metadata: { ok: false, error: "unknown-element" } }
    case "denied":
      return {
        title: `BLOCKED (logout): ${r.label}`,
        output: `Guard DENIED this ${r.kind} element ("${r.label}"). Logging out would end the authenticated session — never do it during a crawl. Skip it.`,
        metadata: { ok: false, policy: "deny", kind: r.kind },
      }
    case "confirm":
      return {
        title: `NEEDS HUMAN CONFIRMATION (destructive): ${r.label}`,
        output: `This ${r.kind} element ("${r.label}") is irreversible and requires a human to confirm. Skipped — report it as a destructive action the human should review, do not retry.`,
        metadata: { ok: false, policy: "confirm", kind: r.kind },
      }
    case "budget":
      return {
        title: "Crawl budget exhausted",
        output: `${r.message} Stop the crawl and report coverage — do not keep acting.`,
        metadata: { ok: false, error: "budget-exhausted" },
      }
    case "relay-failed":
      return { title: `web_action failed`, output: `FAILED — ${r.message}`, metadata: { ok: false, error: r.error } }
    case "ok": {
      let output = `OK — ${r.message}`
      if (r.repeat)
        output +=
          "\nNote: this element was already actioned earlier. If the page looks unchanged you may be in a cycle — prefer an UNVISITED nav/query element next."
      return { title: `web_action: ${r.message}`, output, metadata: { ok: true, ...(r.repeat ? { repeat: true } : {}) } }
    }
  }
}

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
    const r = await WebAct.perform(sessionID, {
      op: params.op,
      url: params.url,
      elementId: params.element_id,
      text: params.text,
    })
    const out = present(r)
    if (r.status === "budget") out.metadata = { ...out.metadata, ...Crawl.summary(sessionID) }
    return out
  },
})
