import { describe, test, expect } from "bun:test"
import { classifyErrorDisclosure, injectionHandoff } from "../../../src/tool/error-probe/signatures"

const kinds = (body: string) => classifyErrorDisclosure(body).map((d) => d.kind)

describe("error-probe/signatures — classifyErrorDisclosure", () => {
  test("Werkzeug/Flask debug page → high", () => {
    const d = classifyErrorDisclosure("<h1>Werkzeug Debugger</h1> The debugger caught an exception")
    expect(d[0].kind).toBe("debug-page-werkzeug")
    expect(d[0].severity).toBe("high")
  })

  test("Django DEBUG page", () => {
    expect(kinds("Django Version: 4.2  Request Method: GET  Request URL: http://x/")).toContain("debug-page-django")
  })

  test("ASP.NET detailed error", () => {
    expect(kinds("Server Error in '/App' Application. Stack Trace: [SqlException]")).toContain("debug-page-aspnet")
  })

  test("Spring Whitelabel", () => {
    expect(kinds("Whitelabel Error Page There was an unexpected error (type=Internal Server Error, status=500).")).toContain("debug-page-spring")
  })

  test("language runtime errors: PHP, Java, Node, Python", () => {
    expect(kinds("<b>Fatal error</b>: Uncaught Error in <b>/var/www/app.php</b> on line 22")).toContain("error-php")
    expect(kinds("java.lang.NullPointerException\n\tat com.acme.Svc.run(Svc.java:41)")).toContain("error-java")
    expect(kinds("TypeError: x is not a function\n    at Object.<anonymous> (/srv/app/index.js:10:5)")).toContain("error-node")
    expect(kinds('Traceback (most recent call last):\n  File "/app/main.py", line 5')).toContain("error-python")
  })

  test("path + internal-address disclosure", () => {
    expect(kinds("open failed: /var/www/html/config/db.php")).toContain("path-disclosure-unix")
    expect(kinds("could not connect to C:\\inetpub\\wwwroot\\web.config")).toContain("path-disclosure-win")
    expect(kinds("upstream 10.0.13.4 timed out")).toContain("internal-address")
  })

  test("folds in Observe.errorSignatures (verbose DB error)", () => {
    expect(kinds("You have an error in your SQL syntax near '1'")).toContain("db-error-sqli")
  })

  test("a clean generic error page leaks nothing", () => {
    expect(classifyErrorDisclosure("<html><body>Something went wrong. Please try again.</body></html>")).toHaveLength(0)
  })

  test("each disclosure carries an evidence snippet", () => {
    const d = classifyErrorDisclosure("prefix... /home/deploy/app/secret.rb:8:in `call' ...suffix")
    expect(d.find((x) => x.kind === "error-ruby")?.matched).toContain(".rb:8:in")
  })
})

describe("error-probe/signatures — injectionHandoff", () => {
  test("maps DB-error disclosures to distinct input-validation signals", () => {
    const h = injectionHandoff([{ kind: "db-error-sqli" }, { kind: "db-error-nosql" }, { kind: "db-error-sqli" }, { kind: "stacktrace" }, { kind: "debug-page-django" }])
    expect(h).toEqual(["sql_error:input-validation", "nosql_error:input-validation"]) // sqli deduped; non-DB kinds ignored
  })

  test("no DB error → no handoff", () => {
    expect(injectionHandoff([{ kind: "path-disclosure-unix" }, { kind: "debug-page-werkzeug" }])).toEqual([])
  })

  test("every handoff value carries the input-validation owner (router dispatch contract)", () => {
    for (const v of injectionHandoff([{ kind: "db-error-ldap" }, { kind: "db-error-xpath" }])) {
      expect(v.split(":")[1]).toBe("input-validation")
    }
  })
})
