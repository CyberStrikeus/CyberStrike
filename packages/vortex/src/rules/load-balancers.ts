// Load balancer fingerprint rules. Detect load balancing infrastructure from response headers
// and body signatures.
// Category "technology", severity "info". Signals route to wstg-info-gathering for infrastructure
// mapping and origin-bypass / routing-abuse testing.
import type { DeclarativeRule } from "../declarative"

export const loadBalancerRules: DeclarativeRule[] = [
  {
    id: "tech-lb-google-cloud",
    category: "technology",
    severity: "info",
    when: 'regex("GFE|Google Frontend", resp.header.via) || regex("Google Frontend", resp.header.server) || resp.header.x-goog-load-balancer',
    message: "Load balancer detected: google-cloud-lb at {host}",
    dedupBy: "host",
    tags: ["tech", "load-balancer"],
  },
  {
    id: "tech-lb-amazon-alb",
    category: "technology",
    severity: "info",
    when: 'regex("awselb/2\\.0", resp.header.server) || regex("ELBv2", resp.header.via) || regex("AWSALB=", resp.header.set-cookie)',
    message: "Load balancer detected: amazon-alb at {host}",
    dedupBy: "host",
    tags: ["tech", "load-balancer"],
  },
  {
    id: "tech-lb-azure-front-door",
    category: "technology",
    severity: "info",
    when: 'resp.header.x-azure-ref || regex("afd", resp.header.x-ms-routing) || regex("Azure Front Door", resp.header.via)',
    message: "Load balancer detected: azure-front-door at {host}",
    dedupBy: "host",
    tags: ["tech", "load-balancer"],
  },
  {
    id: "tech-lb-amazon-elb",
    category: "technology",
    severity: "info",
    when: 'regex("awselb/1\\.0|ELB", resp.header.server) || regex("AWSELB=", resp.header.set-cookie)',
    message: "Load balancer detected: amazon-elb at {host}",
    dedupBy: "host",
    tags: ["tech", "load-balancer"],
  },
  {
    id: "tech-lb-arr",
    category: "technology",
    severity: "info",
    when: 'resp.header.x-powered-by-arr || regex("ARRAffinity=", resp.header.set-cookie) || regex("ARR/", resp.header.server)',
    message: "Load balancer detected: application-request-routing at {host}",
    dedupBy: "host",
    tags: ["tech", "load-balancer"],
  },
]
