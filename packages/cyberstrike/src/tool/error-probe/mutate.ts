// Error-INDUCING request mutations (WSTG-ERRH). Pure transforms that malform a request STRUCTURALLY so a
// server with poor error handling coughs up a verbose error / debug page. These are deliberately NOT
// injection payloads (that is input-validation's job) — just malformed JSON, type confusion, a wrong
// content-type, and an invalid %-escape — so they trip parsers/validators without trying to execute
// anything. The response is then run through classifyErrorDisclosure.
import { HttpMessage } from "../../replay/message"
import { Mutate } from "../../replay/mutate"

const decoder = new TextDecoder("latin1")

function contentType(msg: HttpMessage.Request): string {
  return (msg.headers.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "").toLowerCase()
}

function looksJson(msg: HttpMessage.Request, bodyText: string): boolean {
  return contentType(msg).includes("json") || /^\s*[[{]/.test(bodyText)
}

export interface ErrVariant {
  name: string
  msg: HttpMessage.Request
}

// Build the deterministic set of malformations applicable to this request. GET/no-body requests still get
// the malformed-query variant, so every request yields at least one probe.
export function errorVariants(msg: HttpMessage.Request): ErrVariant[] {
  const out: ErrVariant[] = []
  const bodyText = decoder.decode(msg.body)
  const hasBody = bodyText.length > 0

  if (hasBody && looksJson(msg, bodyText)) {
    // Break the JSON grammar (unbalanced) → parser error.
    out.push({ name: "malformed-json", msg: Mutate.setBody(msg, bodyText.replace(/[}\]]\s*$/, "") + "{") })
    // Send the opposite container so a schema/type check fails: object↔array.
    const swapped = /^\s*\{/.test(bodyText) ? "[]" : "{}"
    out.push({ name: "type-confusion", msg: Mutate.setBody(msg, swapped) })
  }

  if (hasBody) {
    // Declare a content-type the body is not, so the wrong parser is chosen.
    const wrong = contentType(msg).includes("json") ? "application/x-www-form-urlencoded" : "application/json"
    out.push({ name: "wrong-content-type", msg: Mutate.setHeader(msg, "Content-Type", wrong) })
  }

  // Invalid percent-escape in the query — malformed input every endpoint sees, safe for GET.
  const sep = msg.target.includes("?") ? "&" : "?"
  out.push({ name: "malformed-query", msg: { ...msg, target: `${msg.target}${sep}_cs_err=%ZZ%` } })

  return out
}
