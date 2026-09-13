// Known-vulnerable-component / exposed-tech-feature rules (declarative DSL, passive). These show the
// DSL's version-awareness (compare_versions) and tech-gating — the class that scales toward a
// Nuclei-style corpus. Each self-gates on the tech in its own condition AND carries `requires.tech`
// so the selector can skip it when the corpus shows no such stack.
import type { DeclarativeRule } from "../declarative"

export const cveRules: DeclarativeRule[] = [
  {
    // Apache httpd 2.4.49 / 2.4.50 path traversal & RCE (CVE-2021-41773 / CVE-2021-42013). Gated on
    // an Apache Server banner AND the vulnerable version window.
    id: "apache-path-traversal-cve-2021-41773",
    category: "vulnerable-component",
    severity: "high",
    when: 'icontains(resp.header.server, "apache") && compare_versions(resp.header.server, ">= 2.4.49") && compare_versions(resp.header.server, "< 2.4.51")',
    message: "Apache {resp.header.server} in the CVE-2021-41773/42013 window (path traversal / RCE)",
    dedupBy: "host",
    tags: ["cve", "apache", "vulnerable-component"],
    requires: { tech: ["apache"] },
  },
  {
    // Spring Boot Actuator endpoints exposed unauthenticated — env/heapdump/mappings leak, sometimes
    // RCE via /actuator/env + refresh. Path + a 200 + the actuator JSON shape.
    id: "spring-actuator-exposed",
    category: "misconfiguration",
    severity: "high",
    when: 'regex("/actuator(/|$)", req.path) && resp.status == 200 && regex("\\"_links\\"|\\"activeProfiles\\"|\\"propertySources\\"|\\"healthComponent\\"", resp.body)',
    message: "Spring Boot Actuator exposed at {endpoint}",
    dedupBy: "endpoint",
    tags: ["spring", "exposure", "misconfig"],
    requires: { tech: ["spring"] },
  },

  // ── Outdated client-side library windows (version in the script URL) ─────────────────────────
  // The library version lives in its script URL (jquery-3.4.1.min.js, jquery@3.4.1, lodash@4.17.20).
  // compare_versions(req.url, …) reads the first dotted-number run, so each rule fires on the SCRIPT
  // transaction (a browser fetches every <script src> as its own request) — CDN-hosted or self-hosted
  // alike. Severity "low": a version-only match is a lead (an outdated, known-vulnerable component),
  // not a confirmed exploit. LLM/analyst extends the catalog the same way.
  {
    id: "jquery-xss-cve-2020-11022",
    category: "vulnerable-component",
    severity: "low",
    // jQuery < 3.5.0 — CVE-2020-11022 / CVE-2020-11023 (htmlPrefilter XSS).
    when: 'regex("jquery[-@/]", req.url) && compare_versions(req.url, ">= 1.0.0") && compare_versions(req.url, "< 3.5.0")',
    message: "Outdated jQuery {req.url} (< 3.5.0, CVE-2020-11022/11023 XSS)",
    dedupBy: "host",
    tags: ["cve", "jquery", "vulnerable-component", "outdated-library"],
    requires: { tech: ["jquery"] },
  },
  {
    id: "bootstrap-xss-3x",
    category: "vulnerable-component",
    severity: "low",
    // Bootstrap 3.x < 3.4.1 — XSS (CVE-2018-14040/14041/14042, CVE-2019-8331).
    when: 'regex("bootstrap[-@/]", req.url) && compare_versions(req.url, ">= 3.0.0") && compare_versions(req.url, "< 3.4.1")',
    message: "Outdated Bootstrap {req.url} (3.x < 3.4.1, XSS)",
    dedupBy: "host",
    tags: ["cve", "bootstrap", "vulnerable-component", "outdated-library"],
    requires: { tech: ["bootstrap"] },
  },
  {
    id: "bootstrap-xss-4x",
    category: "vulnerable-component",
    severity: "low",
    // Bootstrap 4.x < 4.3.1 — XSS (CVE-2019-8331 data-template/tooltip).
    when: 'regex("bootstrap[-@/]", req.url) && compare_versions(req.url, ">= 4.0.0") && compare_versions(req.url, "< 4.3.1")',
    message: "Outdated Bootstrap {req.url} (4.x < 4.3.1, CVE-2019-8331 XSS)",
    dedupBy: "host",
    tags: ["cve", "bootstrap", "vulnerable-component", "outdated-library"],
    requires: { tech: ["bootstrap"] },
  },
  {
    id: "lodash-proto-pollution",
    category: "vulnerable-component",
    severity: "low",
    // Lodash < 4.17.21 — prototype pollution / command injection (CVE-2020-8203, CVE-2021-23337).
    when: 'regex("lodash[-@/.]", req.url) && compare_versions(req.url, "< 4.17.21")',
    message: "Outdated Lodash {req.url} (< 4.17.21, CVE-2020-8203 / CVE-2021-23337)",
    dedupBy: "host",
    tags: ["cve", "lodash", "vulnerable-component", "outdated-library"],
    requires: { tech: ["lodash"] },
  },
  {
    id: "moment-redos",
    category: "vulnerable-component",
    severity: "low",
    // Moment.js < 2.29.4 — ReDoS (CVE-2022-31129) + path traversal (CVE-2022-24785, < 2.29.2).
    when: 'regex("moment[-@/.]", req.url) && compare_versions(req.url, "< 2.29.4")',
    message: "Outdated Moment.js {req.url} (< 2.29.4, CVE-2022-31129 ReDoS)",
    dedupBy: "host",
    tags: ["cve", "moment", "vulnerable-component", "outdated-library"],
    requires: { tech: ["moment"] },
  },
  {
    id: "angularjs-eol-vulns",
    category: "vulnerable-component",
    severity: "low",
    // AngularJS 1.x < 1.8.3 — prototype pollution / XSS (CVE-2019-10768, CVE-2020-7676); 1.x is EOL.
    when: 'regex("angular[-.@/]", req.url) && compare_versions(req.url, ">= 1.0.0") && compare_versions(req.url, "< 1.8.3")',
    message: "Outdated/EOL AngularJS {req.url} (1.x < 1.8.3, prototype-pollution/XSS)",
    dedupBy: "host",
    tags: ["cve", "angularjs", "vulnerable-component", "outdated-library"],
    requires: { tech: ["angularjs"] },
  },
]
