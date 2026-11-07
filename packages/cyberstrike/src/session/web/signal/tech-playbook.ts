// Technology playbook — what a detected stack MEANS for testing (plan §06B).
//
// A fingerprint is only useful if it drives concrete test cases. The `technology` signal
// (emitted by TechnologyDetector on ingest, and by recon_test fingerprint actively) carries a
// tech slug; this module maps that slug to the stack-specific probes/vuln-classes a specialist
// should run. It is injected into the retest dispatch prompt so a detected stack ALWAYS becomes
// concrete tests — never an inert readout the LLM might ignore.
//
// PURE data + lookup (no I/O) so it unit-tests trivially and stays the single source of "what to
// do about tech X". Add a stack here and every layer (detector recognizes it → this drives it)
// picks it up.
export namespace TechPlaybook {
  export interface Entry {
    label: string // human name for the prompt
    // Stack-specific paths worth probing (exposed dashboards, debug, known-sensitive endpoints).
    paths: string[]
    // Vulnerability classes this stack is prone to — names the specialist/orchestrator can act on.
    vulnClasses: string[]
    // One-line testing directive for the specialist.
    directive: string
  }

  // Keyed by tech slug (lowercase, hyphenated) — the value the detector emits.
  const PLAYBOOK: Record<string, Entry> = {
    "spring-boot": {
      label: "Spring Boot",
      paths: ["/actuator", "/actuator/env", "/actuator/heapdump", "/actuator/mappings", "/actuator/health", "/actuator/beans", "/actuator/configprops", "/actuator/threaddump"],
      vulnClasses: ["actuator-exposure", "spel-injection", "sensitive-data-exposure"],
      directive: "Probe every /actuator/* endpoint unauthenticated (env/heapdump/mappings leak secrets + full config); test SpEL injection where user input reaches an expression.",
    },
    wordpress: {
      label: "WordPress",
      paths: ["/xmlrpc.php", "/wp-json/wp/v2/users", "/?author=1", "/wp-login.php", "/wp-content/debug.log", "/wp-json"],
      vulnClasses: ["user-enumeration", "plugin-cve", "xmlrpc-abuse", "auth"],
      directive: "Enumerate users via /?author=N and /wp-json/wp/v2/users; check xmlrpc.php (pingback SSRF + auth brute amplification); inventory plugins/themes and their versions for known CVEs.",
    },
    drupal: {
      label: "Drupal",
      paths: ["/CHANGELOG.txt", "/user/login", "/admin", "/rest/session/token", "/?q=user"],
      vulnClasses: ["core-cve", "sql-injection", "rce"],
      directive: "Read CHANGELOG.txt for exact core version → map to Drupalgeddon-class RCE/SQLi CVEs; probe REST/JSON:API endpoints.",
    },
    joomla: {
      label: "Joomla",
      paths: ["/administrator/", "/administrator/manifests/files/joomla.xml", "/api/index.php/v1/config/application"],
      vulnClasses: ["core-cve", "auth", "info-disclosure"],
      directive: "Read the version manifest; test the API config endpoint (CVE-2023-23752 unauth config/secret leak).",
    },
    django: {
      label: "Django",
      paths: ["/admin/", "/__debug__/", "/static/admin/"],
      vulnClasses: ["debug-exposure", "info-disclosure", "auth"],
      directive: "Trigger an error to check for DEBUG=True (leaks settings, SECRET_KEY, SQL); probe /admin/ and the debug toolbar.",
    },
    flask: {
      label: "Flask / Werkzeug",
      paths: ["/console", "/__debug__"],
      vulnClasses: ["debug-console-rce", "ssti", "info-disclosure"],
      directive: "Check for the Werkzeug debugger PIN console (RCE); test SSTI (Jinja2 `{{7*7}}`) on any reflected input.",
    },
    rails: {
      label: "Ruby on Rails",
      paths: ["/rails/info/routes", "/rails/info/properties"],
      vulnClasses: ["mass-assignment", "deserialization", "info-disclosure"],
      directive: "Test mass-assignment on model params; check for exposed /rails/info/*; review for unsafe Marshal/YAML deserialization.",
    },
    aspnet: {
      label: "ASP.NET",
      paths: ["/elmah.axd", "/trace.axd", "/Telerik.Web.UI.WebResource.axd"],
      vulnClasses: ["viewstate-deserialization", "info-disclosure", "padding-oracle"],
      directive: "Test ViewState (unsigned/known-MachineKey → deserialization RCE); probe elmah.axd/trace.axd for request-log disclosure.",
    },
    express: {
      label: "Express / Node",
      paths: ["/.env", "/package.json", "/debug"],
      vulnClasses: ["prototype-pollution", "info-disclosure", "nosql-injection"],
      directive: "Test prototype pollution on JSON bodies (__proto__); check for verbose error stacks; NoSQL injection where a Mongo/query backend is likely.",
    },
    nextjs: {
      label: "Next.js",
      paths: ["/_next/static/", "/api/", "/_next/data/"],
      vulnClasses: ["ssrf", "info-disclosure", "middleware-bypass"],
      directive: "Enumerate /api/* routes; check middleware auth bypass (CVE-2025-29927 x-middleware-subrequest); review _next/data JSON for leaked props.",
    },
    laravel: {
      label: "Laravel",
      paths: ["/.env", "/telescope", "/telescope/requests", "/_ignition/health-check"],
      vulnClasses: ["debug-rce", "info-disclosure", "env-exposure"],
      directive: "Check /_ignition (CVE-2021-3129 debug-mode RCE); probe /telescope (request/query/secret dashboard); test /.env exposure.",
    },
    tomcat: {
      label: "Apache Tomcat",
      paths: ["/manager/html", "/host-manager/html", "/manager/text/list"],
      vulnClasses: ["default-creds", "war-deploy-rce", "ghostcat"],
      directive: "Test Manager with default creds (tomcat/tomcat) → WAR upload RCE; check Ghostcat (AJP, CVE-2020-1938) file read.",
    },
    iis: {
      label: "Microsoft IIS",
      paths: ["/web.config", "/trace.axd"],
      vulnClasses: ["short-name-enum", "info-disclosure", "webdav"],
      directive: "Test IIS tilde (~) short-name enumeration; check WebDAV methods; probe for web.config disclosure.",
    },
    graphql: {
      label: "GraphQL",
      paths: ["/graphql", "/graphiql", "/v1/graphql", "/api/graphql"],
      vulnClasses: ["introspection", "idor", "dos-nested-query", "injection"],
      directive: "Run introspection (map the schema); test field-level authz/IDOR, batching abuse, and deeply-nested query DoS.",
    },
  }

  /** The playbook for a tech slug, or undefined if unknown. */
  export function get(slug: string): Entry | undefined {
    return PLAYBOOK[slug.toLowerCase()]
  }

  /** Render a compact, prompt-ready block for one or more detected tech slugs. */
  export function render(slugs: string[]): string {
    const lines: string[] = []
    for (const slug of slugs) {
      const e = get(slug)
      if (!e) continue
      lines.push(
        `- ${e.label}: ${e.directive}`,
        `    paths to probe: ${e.paths.join(", ")}`,
        `    vuln classes: ${e.vulnClasses.join(", ")}`,
      )
    }
    return lines.join("\n")
  }

  /** All known slugs (for the detector to know what it can recognize / for tests). */
  export function slugs(): string[] {
    return Object.keys(PLAYBOOK)
  }

  // recon_test fingerprint returns human labels ("WordPress", "Spring Boot"); map them to playbook
  // slugs so the active probe feeds the same signal/playbook path as the passive detector. Unknown
  // labels (e.g. bare web servers like Apache/Nginx) return undefined → no playbook, no signal.
  const LABEL_TO_SLUG: Record<string, string> = {
    wordpress: "wordpress",
    joomla: "joomla",
    drupal: "drupal",
    "ruby on rails": "rails",
    rails: "rails",
    "spring boot": "spring-boot",
    django: "django",
    flask: "flask",
    "asp.net": "aspnet",
    express: "express",
    "next.js": "nextjs",
    nextjs: "nextjs",
    laravel: "laravel",
    tomcat: "tomcat",
    "microsoft iis": "iis",
    iis: "iis",
    graphql: "graphql",
  }

  export function slugForLabel(label: string): string | undefined {
    return LABEL_TO_SLUG[label.trim().toLowerCase()]
  }
}
