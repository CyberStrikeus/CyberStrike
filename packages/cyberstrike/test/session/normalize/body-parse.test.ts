import { describe, expect, test } from "bun:test"
import { parseBody, bodyKeyShapeHash } from "../../../src/session/normalize/protocol"
import { extractSlots } from "../../../src/session/normalize/slots"

// Body slots only (path/query stripped), as "name=value" strings.
function bodySlots(body: string | undefined, contentType: string | undefined, protocol = "rest"): string[] {
  return extractSlots({ normalizedPath: "/x", canonicalPath: "/x", query: undefined, body, contentType, protocol })
    .filter((s) => s.loc === "body")
    .map((s) => `${s.name}=${s.value}`)
}

const FORM = "application/x-www-form-urlencoded"
const JSON_CT = "application/json"

describe("parseBody — single dispatch", () => {
  test("JSON by content-type", () => {
    expect(parseBody('{"a":1}', JSON_CT)).toEqual({ kind: "json", value: { a: 1 } })
  })
  test("JSON by shape-sniff even when content-type has no 'json' (csp-report, +json)", () => {
    expect(parseBody('{"x":1}', "application/csp-report").kind).toBe("json")
    expect(parseBody('{"x":1}', "application/vnd.api+json").kind).toBe("json")
    expect(parseBody("[1,2]", "text/plain").kind).toBe("json")
  })
  test("form-urlencoded", () => {
    const p = parseBody("a=1&b=2", FORM)
    expect(p.kind).toBe("form")
    if (p.kind === "form") expect(p.fields).toEqual([{ name: "a", value: "1" }, { name: "b", value: "2" }])
  })
  test("multipart", () => {
    const p = parseBody('--X\r\nContent-Disposition: form-data; name="uid"\r\n\r\n7\r\n--X--', "multipart/form-data; boundary=X")
    expect(p.kind).toBe("multipart")
  })
  test("none: empty / unstructured / malformed-not-JSON", () => {
    expect(parseBody("", JSON_CT).kind).toBe("none")
    expect(parseBody(undefined, JSON_CT).kind).toBe("none")
    expect(parseBody("hello world", "text/plain").kind).toBe("none")
    expect(parseBody("not{json", "text/plain").kind).toBe("none")
  })
  test("malformed JSON under json content-type falls through, not thrown", () => {
    expect(() => parseBody("{broken", JSON_CT)).not.toThrow()
    expect(parseBody("{broken", JSON_CT).kind).toBe("none")
  })
})

describe("bodyKeyShapeHash — value-invariance is the dedup contract", () => {
  test("form: same field NAMES, different VALUES → SAME key", () => {
    expect(bodyKeyShapeHash("a=1&b=2", FORM)).toBe(bodyKeyShapeHash("a=9&b=xyz", FORM))
  })
  test("form: extra field → DIFFERENT key", () => {
    expect(bodyKeyShapeHash("a=1&b=2", FORM)).not.toBe(bodyKeyShapeHash("a=1&b=2&c=3", FORM))
  })
  test("json: same shape, different values → SAME; extra key → DIFFERENT", () => {
    expect(bodyKeyShapeHash('{"a":1,"b":2}', JSON_CT)).toBe(bodyKeyShapeHash('{"a":99,"b":"x"}', JSON_CT))
    expect(bodyKeyShapeHash('{"a":1}', JSON_CT)).not.toBe(bodyKeyShapeHash('{"a":1,"b":2}', JSON_CT))
  })
  test("csp-report: two different reports collapse to ONE key (the ×55→1 fix)", () => {
    const a = '{"csp-report":{"blocked-uri":"inline","line-number":1563}}'
    const b = '{"csp-report":{"blocked-uri":"eval","line-number":42}}'
    expect(bodyKeyShapeHash(a, "application/csp-report")).toBe(bodyKeyShapeHash(b, "application/csp-report"))
    expect(bodyKeyShapeHash(a, "application/csp-report")).toBeDefined()
  })
  test("multipart: same field names, different values → SAME key", () => {
    const a = '--X\r\nContent-Disposition: form-data; name="uid"\r\n\r\n7\r\n--X--'
    const b = '--X\r\nContent-Disposition: form-data; name="uid"\r\n\r\n999\r\n--X--'
    expect(bodyKeyShapeHash(a, "multipart/form-data; boundary=X")).toBe(bodyKeyShapeHash(b, "multipart/form-data; boundary=X"))
  })
  test("distinct content-type shapes stay in separate namespaces (form vs json prefix)", () => {
    expect(bodyKeyShapeHash("a=1&b=2", FORM)).not.toBe(bodyKeyShapeHash('{"a":1,"b":2}', JSON_CT))
  })
})

describe("bodySlots — value extraction, now symmetric with keying", () => {
  test("form fields become name+value observations (was JSON-only → empty)", () => {
    expect(bodySlots("HiddenUserID=42&btnReturn=Return", FORM)).toEqual(["HiddenUserID=42", "btnReturn=Return"])
  })
  test("csp-report body is observed (shape-sniff), not dropped", () => {
    const slots = bodySlots('{"csp-report":{"blocked-uri":"inline","line-number":42}}', "application/csp-report")
    expect(slots).toContain("csp-report.blocked-uri=inline")
    expect(slots).toContain("csp-report.line-number=42")
  })
  test("multipart: text field observed, file part skipped (binary, no value)", () => {
    const body = '--X\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\nBINARY\r\n--X\r\nContent-Disposition: form-data; name="uid"\r\n\r\n7\r\n--X--'
    const slots = bodySlots(body, "multipart/form-data; boundary=X")
    expect(slots).toContain("uid=7")
    expect(slots.some((s) => s.startsWith("file=") || s.startsWith("a.png="))).toBe(false)
  })
  test("JSON leaves unchanged (nested)", () => {
    expect(bodySlots('{"user":{"id":5,"name":"a"}}', JSON_CT)).toEqual(["user.id=5", "user.name=a"])
  })
  test("graphql variables + jsonrpc params still extracted via protocol", () => {
    expect(bodySlots('{"query":"q","variables":{"id":7}}', JSON_CT, "graphql")).toContain("id=7")
    expect(bodySlots('{"jsonrpc":"2.0","method":"m","params":{"id":5}}', JSON_CT, "jsonrpc")).toContain("id=5")
  })
  test("the asymmetry is fixed: form has BOTH a key AND slots", () => {
    const body = "user_id=42"
    expect(bodyKeyShapeHash(body, FORM)).toBeDefined()
    expect(bodySlots(body, FORM)).toEqual(["user_id=42"])
  })
})

const XML = "text/xml; charset=utf-8"
const SOAP = (op: string, inner: string, prefix = "soap") =>
  `<${prefix}:Envelope xmlns:${prefix}="http://schemas.xmlsoap.org/soap/envelope/"><${prefix}:Body>` +
  `<${op} xmlns="urn:x">${inner}</${op}></${prefix}:Body></${prefix}:Envelope>`

describe("SOAP/XML — dedup + operation + observation", () => {
  test("parseBody: xml by content-type", () => {
    expect(parseBody(SOAP("Add", "<a>1</a>"), XML).kind).toBe("xml")
  })
  test("value-invariance: same operation, different values → SAME key (was: fragment)", () => {
    expect(bodyKeyShapeHash(SOAP("Add", "<intA>5</intA><intB>3</intB>"), XML)).toBe(
      bodyKeyShapeHash(SOAP("Add", "<intA>99</intA><intB>7</intB>"), XML),
    )
  })
  test("operation-distinction comes free (operation is in the element path)", () => {
    expect(bodyKeyShapeHash(SOAP("Add", "<a>1</a>"), XML)).not.toBe(bodyKeyShapeHash(SOAP("Subtract", "<a>1</a>"), XML))
  })
  test("namespace-prefix invariance: soap: vs s: → SAME key (local names)", () => {
    expect(bodyKeyShapeHash(SOAP("Add", "<a>1</a>", "soap"), XML)).toBe(
      bodyKeyShapeHash(SOAP("Add", "<a>1</a>", "s"), XML),
    )
  })
  test("values observed (IDOR substrate): element text lands in slots", () => {
    const slots = bodySlots(SOAP("GetUser", "<userId>42</userId>"), XML)
    expect(slots).toContain("Envelope.Body.GetUser.userId=42")
  })
  test("attributes observed (id=\"42\" is IDOR-relevant)", () => {
    const slots = bodySlots(SOAP("Get", '<user id="42">alice</user>'), XML)
    expect(slots.some((s) => s.includes("@id=42"))).toBe(true)
  })
  test("SOAP fault still parses to a shape, not raw fragmentation", () => {
    const fault = SOAP("Fault", "<faultcode>Server</faultcode><faultstring>boom</faultstring>")
    expect(bodyKeyShapeHash(fault, XML)).toBeDefined()
  })
  test("malformed / non-XML with a non-xml content-type is NOT swallowed by the parser", () => {
    // a `<?php ?>` injection payload sent as application/json must stay 'none' (no `<`-sniff)
    expect(parseBody("<?php system($_GET['c']); ?>", JSON_CT).kind).toBe("none")
    expect(bodyKeyShapeHash("<?php system($_GET['c']); ?>", JSON_CT)).toBeUndefined()
  })
})
