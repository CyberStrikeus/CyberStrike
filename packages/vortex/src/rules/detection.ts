// Extended passive security detection rules — broadening coverage beyond the original signature/misconfig/auth
// baseline. Each rule is deliberately low false-positive: precise signatures or field conditions over a single
// captured request/response pair. Organized by detection domain.
import type { DeclarativeRule } from "../declarative"

// ── Information Disclosure ──────────────────────────────────────────────────────────────────────────
export const infoDisclosureRules: DeclarativeRule[] = [
  {
    // RFC 1918 private IPs leaked in response body — internal network topology disclosure. The pattern
    // requires a full dotted-quad with word boundaries to avoid matching version strings (e.g. "10.2.3").
    id: "private-ip-disclosure",
    category: "info-disclosure",
    severity: "low",
    when: 'regex("\\b(10\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}|172\\.(1[6-9]|2[0-9]|3[01])\\.[0-9]{1,3}\\.[0-9]{1,3}|192\\.168\\.[0-9]{1,3}\\.[0-9]{1,3})\\b", resp.body)',
    message: "Private/internal IP address disclosed in the response of {endpoint}",
    dedupBy: "endpoint",
    tags: ["info-disclosure", "network"],
  },
  {
    // Email addresses in error responses (4xx/5xx) often reveal admin contacts, internal usernames, or
    // support addresses. Only fires on error pages to avoid FP on legitimate profile/user-list APIs.
    id: "email-in-error",
    category: "info-disclosure",
    severity: "low",
    when: 'resp.status >= 400 && regex("[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}", resp.body)',
    message: "Email address leaked in error response at {endpoint}",
    evidence: "{resp.status} on {req.method} {req.path}",
    dedupBy: "endpoint",
    tags: ["info-disclosure"],
  },
  {
    // Source map files (.js.map / .css.map) served with a 200 expose the original, unminified source code
    // including variable names, comments, and internal logic.
    id: "source-map-exposed",
    category: "info-disclosure",
    severity: "medium",
    when: 'resp.status == 200 && regex("\\.(js|css)\\.map($|\\?)", req.path) && regex("\\"(version|sources|mappings)\\"", resp.body)',
    message: "Source map file served at {endpoint} — original source code exposed",
    dedupBy: "endpoint",
    tags: ["info-disclosure", "exposure"],
  },
  {
    // phpinfo() output reveals PHP version, modules, environment variables, server paths, and config —
    // one of the highest-value recon pages an attacker can find.
    id: "phpinfo-exposed",
    category: "misconfiguration",
    severity: "high",
    when: 'resp.status == 200 && regex("<title>phpinfo[(][)]</title>|<h1 class=\\"p\\">PHP Version|PHP Credits|Configuration File [(]php.ini[)] Path", resp.body)',
    message: "phpinfo() output exposed at {endpoint}",
    dedupBy: "endpoint",
    tags: ["php", "misconfig", "exposure"],
  },
  {
    // Cloud metadata endpoints (AWS/GCP/Azure) accessible from the application — SSRF pivot or direct
    // misconfiguration. A 200 on any metadata IP/hostname is critical.
    id: "cloud-metadata-accessible",
    category: "misconfiguration",
    severity: "critical",
    when: 'resp.status == 200 && regex("169\\.254\\.169\\.254|metadata\\.google\\.internal|metadata\\.azure\\.com", req.url)',
    message: "Cloud metadata endpoint accessible at {endpoint} — credential/config exfiltration risk",
    dedupBy: "host",
    tags: ["cloud", "ssrf", "misconfig"],
  },
  {
    // WSDL/SOAP service descriptions expose the entire API contract — method names, parameter types,
    // internal namespaces, and endpoint addresses.
    id: "wsdl-exposed",
    category: "info-disclosure",
    severity: "medium",
    when: 'resp.status == 200 && regex("<wsdl:definitions|<definitions[^>]+xmlns[^>]+wsdl|<wsdl:service", resp.body)',
    message: "WSDL/SOAP service description exposed at {endpoint}",
    dedupBy: "endpoint",
    tags: ["info-disclosure", "api"],
  },
  {
    // Database connection strings in response bodies reveal hostnames, ports, credentials, and database
    // names. Matches common URI schemes and ADO.NET-style connection strings.
    id: "database-connection-string",
    category: "info-disclosure",
    severity: "high",
    when: 'regex("(mongodb|mysql|postgres|postgresql|mssql|redis|amqp)://[^\\s]{5,}|Server=[^;]+;.*Database=|Data Source=[^;]+;", resp.body)',
    message: "Database connection string leaked in the response of {endpoint}",
    dedupBy: "endpoint",
    tags: ["info-disclosure", "credentials"],
  },
  {
    // Framework/language version disclosed in error pages (5xx). Version info narrows attacker CVE search.
    // Gated to 5xx to avoid matching version strings in normal page content.
    id: "error-framework-version",
    category: "info-disclosure",
    severity: "low",
    when: 'resp.status >= 500 && regex("PHP/[0-9]|Python/[0-9]|Ruby/[0-9]|Node/v[0-9]|ASP\\.NET[^<]{0,20}[0-9]+\\.[0-9]|Express/[0-9]|Tomcat/[0-9]|Jetty/[0-9]", resp.body)',
    message: "Framework/runtime version disclosed in error response at {endpoint}",
    dedupBy: "host",
    tags: ["info-disclosure"],
  },
]

// ── Injection Error Signatures ──────────────────────────────────────────────────────────────────────
export const injectionSignatureRules: DeclarativeRule[] = [
  {
    // MongoDB/Mongoose/CouchDB error patterns in response — NoSQL injection indicator. These driver
    // errors surface when untrusted input reaches a query operator.
    id: "nosql-error-signature",
    category: "injection",
    severity: "high",
    when: 'regex("MongoError|MongoServerError|MongooseError|CastError.*ObjectId|BadValue.*operator|Cannot apply.*to type|CouchDB.*error", resp.body)',
    message: "NoSQL error signature in the response of {endpoint}",
    evidence: "{resp.status} on {req.method} {req.path}",
    dedupBy: "endpoint",
    tags: ["injection", "nosql"],
  },
  {
    // XML parsing errors surface when the parser chokes on injected entities or malformed markup —
    // XXE / XML injection indicator.
    id: "xml-parsing-error",
    category: "injection",
    severity: "high",
    when: 'regex("SAXParseException|XMLSyntaxError|lxml\\.etree|xml\\.parsers\\.expat|XML parsing error|xmlParseEntityRef|DOMDocument::loadXML|simplexml_load_string", resp.body)',
    message: "XML parsing error in the response of {endpoint} — XXE/XML injection indicator",
    evidence: "{resp.status} on {req.method} {req.path}",
    dedupBy: "endpoint",
    tags: ["injection", "xxe", "xml"],
  },
  {
    // LDAP error patterns — surface when untrusted input reaches an LDAP query. Specific enough
    // (driver class names, function names) to avoid false positives on generic "error" text.
    id: "ldap-error-signature",
    category: "injection",
    severity: "high",
    when: 'regex("LDAPException|javax\\.naming\\.NamingException|ldap_search|ldap_bind|InvalidDnSyntax|LDAP error code|LdapErr:|DSID-", resp.body)',
    message: "LDAP error signature in the response of {endpoint}",
    evidence: "{resp.status} on {req.method} {req.path}",
    dedupBy: "endpoint",
    tags: ["injection", "ldap"],
  },
  {
    // Template engine errors from Jinja2, Twig, Freemarker, Velocity, ERB, Pebble, Thymeleaf — SSTI
    // indicator. These are specific exception class names, not generic strings.
    id: "template-error-signature",
    category: "injection",
    severity: "high",
    when: 'regex("jinja2\\.exceptions|Twig_Error|Twig\\\\Error|freemarker\\.template\\.TemplateException|org\\.apache\\.velocity|ERB::Error|TemplateSyntaxError|PebbleException|TemplateProcessingException", resp.body)',
    message: "Template engine error in the response of {endpoint} — SSTI indicator",
    evidence: "{resp.status} on {req.method} {req.path}",
    dedupBy: "endpoint",
    tags: ["injection", "ssti"],
  },
  {
    // Deserialization error signatures from Java, PHP, .NET — indicates untrusted data reaching an
    // object deserializer, often RCE-exploitable.
    id: "deserialization-error",
    category: "injection",
    severity: "critical",
    when: 'regex("java\\.io\\.InvalidClassException|ClassNotFoundException.*readObject|ObjectInputStream|unserialize[(][)].*failed|BinaryFormatter\\.Deserialize|ysoserial|GHCB.*gadget|TypeNameHandling", resp.body)',
    message: "Deserialization error in the response of {endpoint} — potential RCE vector",
    evidence: "{resp.status} on {req.method} {req.path}",
    dedupBy: "endpoint",
    tags: ["injection", "deserialization", "rce"],
  },
  {
    // XPath errors surface when injected characters break an XPath query — XPath injection indicator.
    id: "xpath-error-signature",
    category: "injection",
    severity: "high",
    when: 'regex("XPathException|Invalid XPath|XPathEvalError|lxml\\.etree\\.XPath|javax\\.xml\\.xpath|XPath syntax error|xmlXPathEval", resp.body)',
    message: "XPath error in the response of {endpoint} — XPath injection indicator",
    evidence: "{resp.status} on {req.method} {req.path}",
    dedupBy: "endpoint",
    tags: ["injection", "xpath"],
  },
  {
    // Shell/command execution error patterns — only the shell-specific signatures (sh:, /bin/sh,
    // bash:, cmd.exe) to avoid FP on generic system errors.
    id: "command-exec-error",
    category: "injection",
    severity: "critical",
    when: 'regex("sh: [0-9]*: .*not found|/bin/(sh|bash|dash): |bash: .*command not found|cmd\\.exe.*not recognized|\\bexec[(][)]:.*failed|Cannot run program|java\\.lang\\.ProcessBuilder", resp.body)',
    message: "Command execution error in the response of {endpoint} — command injection indicator",
    evidence: "{resp.status} on {req.method} {req.path}",
    dedupBy: "endpoint",
    tags: ["injection", "rce", "cmdi"],
  },
]

// ── Authentication & Session ────────────────────────────────────────────────────────────────────────
export const authSessionRules: DeclarativeRule[] = [
  {
    // A JWT without an "exp" (expiry) claim means the token never expires — if stolen, it grants
    // permanent access. jwt_payload must return non-empty (token exists) and the payload must lack "exp".
    id: "jwt-no-expiry",
    category: "auth",
    severity: "medium",
    when: 'jwt_payload(req.header.authorization) && !contains(jwt_payload(req.header.authorization), "\\"exp\\"") && !contains(jwt_payload(req.header.authorization), "\\"exp\\":") ',
    message: "JWT without expiry claim at {endpoint} — token never expires if stolen",
    dedupBy: "endpoint",
    tags: ["auth", "jwt"],
  },
  {
    // HTTP Basic auth over cleartext (http://) sends base64-encoded credentials readable by any
    // network observer. Gated on the URL scheme to avoid false positives on HTTPS.
    id: "basic-auth-cleartext",
    category: "auth",
    severity: "high",
    when: 'starts_with(req.url, "http://") && icontains(req.header.authorization, "basic ")',
    message: "Basic authentication sent over cleartext HTTP at {endpoint}",
    evidence: "Credentials visible to any network observer",
    dedupBy: "host",
    tags: ["auth", "cleartext"],
  },
  {
    // Password/secret/credential field echoed in a 2xx JSON response body. APIs that return the user
    // object with the password field populated are a common misconfiguration.
    id: "credentials-in-response",
    category: "info-disclosure",
    severity: "high",
    when: 'resp.status >= 200 && resp.status < 300 && regex("\\"(password|passwd|secret|client_secret|private_key|secret_key)\\"\\s*:\\s*\\"[^\\"]{1,}", resp.body)',
    message: "Credential field echoed in the response of {endpoint}",
    dedupBy: "endpoint",
    tags: ["info-disclosure", "credentials"],
  },
  {
    // Session tokens embedded in URL path segments (;jsessionid=, ;phpsessid=, ;sid=) are exposed in
    // logs, Referer headers, and browser history — session fixation / hijacking vector.
    id: "session-token-in-path",
    category: "auth-session",
    severity: "medium",
    when: 'regex(";(jsessionid|phpsessid|aspsessionid|sid|cfid|cftoken)=", lower(req.url))',
    message: "Session token embedded in URL path at {endpoint} — leaked via logs/Referer",
    dedupBy: "endpoint",
    tags: ["auth-session", "session-fixation"],
  },
  {
    // Credit card number patterns (Visa, Mastercard, Amex, Discover) in response body. Uses known
    // BIN prefixes + length constraints to stay precise without full Luhn validation.
    id: "credit-card-in-response",
    category: "info-disclosure",
    severity: "high",
    when: 'regex("\\b(4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\\b", resp.body)',
    message: "Possible credit card number in the response of {endpoint}",
    dedupBy: "endpoint",
    tags: ["info-disclosure", "pci", "pii"],
  },
]

// ── API Security ────────────────────────────────────────────────────────────────────────────────────
export const apiSecurityRules: DeclarativeRule[] = [
  {
    // A GraphQL endpoint accepting a JSON array of operations enables batched queries — this is often
    // used to bypass rate limiting (send 1000 login attempts in one HTTP request).
    id: "graphql-batch-enabled",
    category: "misconfiguration",
    severity: "medium",
    when: 'regex("/graphql", req.path) && regex("^\\s*\\[", req.body) && resp.status == 200 && regex("^\\s*\\[", resp.body)',
    message: "GraphQL batch queries enabled at {endpoint} — rate-limit bypass risk",
    dedupBy: "endpoint",
    tags: ["graphql", "api", "rate-limit"],
  },
  {
    // API paths with explicit deprecation markers suggest old, possibly less-hardened API surfaces
    // that may lack current security controls.
    id: "deprecated-api-surface",
    category: "misconfiguration",
    severity: "low",
    when: 'resp.status >= 200 && resp.status < 300 && regex("/(deprecated|legacy|old-api|v0)/", req.path)',
    message: "Deprecated/legacy API surface still serving at {endpoint}",
    dedupBy: "endpoint",
    tags: ["api", "misconfig"],
  },
  {
    // US Social Security Number pattern (XXX-XX-XXXX) in a 2xx API response. Strict format: the first
    // group can't be 000/666/9xx, middle can't be 00, last can't be 0000 — matches real SSN rules.
    id: "ssn-in-response",
    category: "info-disclosure",
    severity: "high",
    when: 'resp.status >= 200 && resp.status < 300 && regex("\\b(?!000|666|9\\d{2})\\d{3}-(?!00)\\d{2}-(?!0000)\\d{4}\\b", resp.body)',
    message: "Possible SSN pattern in the response of {endpoint}",
    dedupBy: "endpoint",
    tags: ["info-disclosure", "pii"],
  },
]

export const detectionRules: DeclarativeRule[] = [
  ...infoDisclosureRules,
  ...injectionSignatureRules,
  ...authSessionRules,
  ...apiSecurityRules,
]
