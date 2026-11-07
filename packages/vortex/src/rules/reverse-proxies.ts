// Reverse-proxy / API-gateway / load-balancing-proxy fingerprint rules. Detect edge proxies from
// their distinctive response headers and session cookies.
// Category "technology", severity "info". Signals route to wstg-info-gathering for infrastructure
// mapping and proxy-specific (header smuggling, origin bypass) surface mapping.
import type { DeclarativeRule } from "../declarative"

export const reverseProxyRules: DeclarativeRule[] = [
  {
    id: "tech-rp-envoy",
    category: "technology",
    severity: "info",
    when: 'regex("envoy", resp.header.server) || resp.header.x-envoy-upstream-service-time || resp.header.x-envoy-decorator-operation',
    message: "Reverse proxy detected: envoy at {host}",
    dedupBy: "host",
    tags: ["tech", "reverse-proxy"],
  },
  {
    id: "tech-rp-f5-bigip",
    category: "technology",
    severity: "info",
    when: 'regex("BigIP|BIG-IP", resp.header.server) || regex("BIGipServer", resp.header.set-cookie) || resp.header.x-cnection',
    message: "Reverse proxy detected: f5-bigip at {host}",
    dedupBy: "host",
    tags: ["tech", "reverse-proxy"],
  },
  {
    id: "tech-rp-ibm-datapower",
    category: "technology",
    severity: "info",
    when: 'regex("DataPower", resp.header.server) || resp.header.x-backside-transport || resp.header.x-global-transaction-id',
    message: "Reverse proxy detected: ibm-datapower at {host}",
    dedupBy: "host",
    tags: ["tech", "reverse-proxy"],
  },
  {
    id: "tech-rp-v2board",
    category: "technology",
    severity: "info",
    when: 'regex("v2board|V2Board", resp.body) || regex("v2board", resp.header.server)',
    message: "Reverse proxy detected: v2board at {host}",
    dedupBy: "host",
    tags: ["tech", "reverse-proxy"],
  },
  {
    id: "tech-rp-hydra-shield",
    category: "technology",
    severity: "info",
    when: 'regex("hydra-shield|Hydra-Shield|HydraShield", resp.header.server) || regex("hydra-shield", resp.body)',
    message: "Reverse proxy detected: hydra-shield at {host}",
    dedupBy: "host",
    tags: ["tech", "reverse-proxy"],
  },
  {
    id: "tech-rp-urllo",
    category: "technology",
    severity: "info",
    when: 'regex("urllo", resp.header.server) || regex("urllo\\.com|urllo-", resp.body)',
    message: "Reverse proxy detected: urllo at {host}",
    dedupBy: "host",
    tags: ["tech", "reverse-proxy"],
  },
]
