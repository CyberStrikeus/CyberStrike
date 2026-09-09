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
]
