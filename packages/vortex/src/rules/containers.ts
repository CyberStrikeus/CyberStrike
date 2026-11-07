// Container / orchestration platform fingerprint rules. Detect container management UIs, registries,
// and real-time infrastructure from response signatures.
// Category "technology", severity "info". Signals route to wstg-info-gathering for infrastructure
// mapping and attack-surface enumeration.
import type { DeclarativeRule } from "../declarative"

export const containerRules: DeclarativeRule[] = [
  {
    id: "tech-proxmox-ve",
    category: "technology",
    severity: "info",
    when: 'regex("pve-api-daemon|PVE", resp.header.server) || regex("Proxmox VE|PVEManager|proxmoxlib\\.js|pve-docs", resp.body)',
    message: "Container detected: proxmox-ve at {host}",
    dedupBy: "host",
    tags: ["tech", "container"],
  },
  {
    id: "tech-docker",
    category: "technology",
    severity: "info",
    when: 'resp.header.docker-distribution-api-version || regex("Docker Registry|docker-registry-ui|registry\\.docker\\.io", resp.body) || regex("docker", resp.header.server)',
    message: "Container detected: docker at {host}",
    dedupBy: "host",
    tags: ["tech", "container"],
  },
  {
    id: "tech-harbor",
    category: "technology",
    severity: "info",
    when: 'regex("Harbor", resp.header.server) || regex("goharbor\\.io|harbor-portal|__harbor|HarborAPI", resp.body)',
    message: "Container detected: harbor at {host}",
    dedupBy: "host",
    tags: ["tech", "container"],
  },
  {
    id: "tech-pubnub",
    category: "technology",
    severity: "info",
    when: 'regex("cdn\\.pubnub\\.com|pubnub\\.com/sdk|PubNub\\.init|pubnub\\.min\\.js", resp.body)',
    message: "Technology detected: pubnub at {endpoint}",
    dedupBy: "host",
    tags: ["tech", "container"],
  },
]
