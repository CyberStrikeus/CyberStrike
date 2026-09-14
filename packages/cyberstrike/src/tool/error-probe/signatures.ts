// Error-disclosure classifier (WSTG-ERRH-01/02). Pure — no I/O. Classifies a response body for the kinds
// of information an improperly-handled error leaks: framework debug pages, stack traces, filesystem-path
// disclosure, internal addresses, and language-runtime error verbosity. Builds ON TOP of
// Observe.errorSignatures (which covers DB/injection error strings + a generic stack-trace) and adds the
// ERRH-specific classes that signal a server is returning diagnostic detail to the client.
import { Observe } from "../../replay/observe"

export interface Disclosure {
  kind: string
  severity: "high" | "medium" | "low"
  matched: string // a short snippet around the match, for evidence
  note: string
}

interface Rule {
  kind: string
  severity: Disclosure["severity"]
  re: RegExp
  note: string
}

// Ordered, specific → generic. A framework debug page is the highest-value (it usually exposes source,
// environment, and often an interactive console); bare path/host disclosure is lower.
const RULES: Rule[] = [
  // ── Framework debug / exception pages (high) ──
  { kind: "debug-page-werkzeug", severity: "high", re: /Werkzeug Debugger|\/\/ Werkzeug Debugger|The debugger caught an exception/i, note: "Flask/Werkzeug interactive debugger — exposes source + a Python console (often RCE via the PIN)" },
  { kind: "debug-page-django", severity: "high", re: /You're seeing this error because you have\s*<code>DEBUG = True|Django Version:|Request Method:.*Request URL:/i, note: "Django DEBUG=True error page — exposes settings, SQL, traceback, env" },
  { kind: "debug-page-rails", severity: "high", re: /Action Controller: Exception caught|<title>Action Controller|full_trace|application\.rb:\d+:in/i, note: "Rails development exception page — exposes source + full trace" },
  { kind: "debug-page-symfony-whoops", severity: "high", re: /Whoops\\|Whoops, looks like something went wrong|Symfony\\Component\\|class="exception"/i, note: "Symfony/Whoops error page — exposes source, args, environment" },
  { kind: "debug-page-aspnet", severity: "high", re: /Server Error in '.*' Application|<title>Runtime Error|Show Detailed Compiler Output|Stack Trace:\s*\[/i, note: "ASP.NET detailed error page — exposes source line, stack, and config state" },
  { kind: "debug-page-spring", severity: "medium", re: /Whitelabel Error Page|There was an unexpected error \(type=/i, note: "Spring Boot Whitelabel/verbose error — leaks exception class + status detail" },
  { kind: "debug-page-express", severity: "medium", re: /<pre>(Error|TypeError|ReferenceError):[\s\S]*?\bat\s+.+?:\d+:\d+/, note: "Express default (non-production) error handler — full Node stack in the response" },
  // ── Language runtime errors (medium) ──
  { kind: "error-php", severity: "medium", re: /(Fatal error|Parse error|Warning|Notice)<\/b>:.*?in <b>.*?<\/b> on line|(Fatal error|Parse error):.* in .* on line \d+/i, note: "PHP error with file + line — path disclosure + internal logic leak" },
  { kind: "error-dotnet", severity: "medium", re: /System\.[\w.]+Exception:|at [\w.]+\.[\w<>]+\(.*\) in .*:line \d+/, note: ".NET exception with type + source line" },
  { kind: "error-java", severity: "medium", re: /javax?\.servlet\.\w+Exception|java\.lang\.[\w.]+Exception|org\.springframework\.[\w.]+Exception|\bat [\w.$]+\([\w.]+\.java:\d+\)/, note: "Java/JSP exception + stack frame — class names, source, framework internals" },
  { kind: "error-node", severity: "medium", re: /\bat Object\.<anonymous>|\(node:internal\/|\/node_modules\/[\w@/-]+\.js:\d+:\d+/, note: "Node.js stack frame — module paths + internal file layout" },
  { kind: "error-ruby", severity: "medium", re: /[\w/.-]+\.rb:\d+:in [`']/, note: "Ruby error with file + line" },
  { kind: "error-python", severity: "medium", re: /Traceback \(most recent call last\):[\s\S]*?File ".*?", line \d+/, note: "Python traceback with file paths + line numbers" },
  { kind: "error-go", severity: "medium", re: /goroutine \d+ \[[\w ]+\]:|\bruntime\.\w+\(|panic: /, note: "Go panic / goroutine dump — source paths + runtime internals" },
  // ── Filesystem & network disclosure (medium/low) ──
  { kind: "path-disclosure-unix", severity: "medium", re: /(\/var\/www\/|\/home\/[\w.-]+\/|\/usr\/(local\/)?(share|lib|src)\/|\/opt\/[\w.-]+\/|\/app\/[\w.-]+)/, note: "absolute UNIX filesystem path — server layout disclosure" },
  { kind: "path-disclosure-win", severity: "medium", re: /[A-Za-z]:\\(inetpub|Windows|Users|wwwroot|Program Files)[\\\w.-]*/i, note: "absolute Windows filesystem path — server layout disclosure" },
  { kind: "internal-address", severity: "low", re: /\b(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b|\b[\w-]+\.(internal|local|corp|lan|intranet)\b/, note: "internal IP / hostname — network topology disclosure" },
]

function snippet(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 20)
  return text.slice(start, Math.min(text.length, index + len + 60)).replace(/\s+/g, " ").trim()
}

// Classify a response body. Deterministic + order-stable. Folds in Observe.errorSignatures so a DB/
// injection error string (sqli/nosql/ldap/xpath) or its generic stack-trace is reported here too as an
// error-handling disclosure (verbose DB error = improper error handling), without duplicating the regexes.
export function classifyErrorDisclosure(body: Uint8Array | string): Disclosure[] {
  const text = typeof body === "string" ? body : new TextDecoder("latin1").decode(body)
  const out: Disclosure[] = []
  const seen = new Set<string>()
  for (const rule of RULES) {
    const m = rule.re.exec(text)
    if (!m) continue
    if (seen.has(rule.kind)) continue
    seen.add(rule.kind)
    out.push({ kind: rule.kind, severity: rule.severity, matched: snippet(text, m.index, m[0].length), note: rule.note })
  }
  for (const cls of Observe.errorSignatures(text)) {
    const kind = cls === "stacktrace" ? "stacktrace" : `db-error-${cls}`
    if (seen.has(kind)) continue
    seen.add(kind)
    out.push({
      kind,
      severity: "medium",
      matched: "(matched Observe.errorSignatures)",
      note: cls === "stacktrace" ? "a stack trace is present in the response" : `verbose ${cls.toUpperCase()} error string returned to the client`,
    })
  }
  return out
}
