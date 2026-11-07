// Database manager fingerprint rules. Detect web-based DB admin panels from response signatures.
// Category "technology", severity "info". Signals route to wstg-info-gathering for exposed admin
// interface enumeration and wstg-config-deploy for default-credential / unauth-access testing.
import type { DeclarativeRule } from "../declarative"

export const dbManagerRules: DeclarativeRule[] = [
  {
    id: "tech-dbm-phpmyadmin",
    category: "technology",
    severity: "info",
    when: 'regex("phpMyAdmin|phpmyadmin|pma_absolute_uri|pmahomme|pma_token|PMA_sendHeaderLocation", resp.body) || regex("phpMyAdmin", resp.header.set-cookie)',
    message: "DB manager detected: phpmyadmin at {endpoint}",
    dedupBy: "host",
    tags: ["tech", "db-manager"],
  },
  {
    id: "tech-dbm-adminer",
    category: "technology",
    severity: "info",
    when: 'regex("adminer\\.org|Adminer.*Editor|adminer\\.css|adminer\\.php|adminer_version", resp.body)',
    message: "DB manager detected: adminer at {endpoint}",
    dedupBy: "host",
    tags: ["tech", "db-manager"],
  },
  {
    id: "tech-dbm-knack",
    category: "technology",
    severity: "info",
    when: 'regex("knack\\.com|cdn\\.knack\\.com|KnackApp|knack-dist|Knack\\.render", resp.body)',
    message: "DB manager detected: knack at {endpoint}",
    dedupBy: "host",
    tags: ["tech", "db-manager"],
  },
  {
    id: "tech-dbm-xano",
    category: "technology",
    severity: "info",
    when: 'regex("xano\\.io|x8ki-letl-twmt\\.n7\\.xano\\.io|api\\.xano\\.com|Xano\\.init", resp.body)',
    message: "DB manager detected: xano at {endpoint}",
    dedupBy: "host",
    tags: ["tech", "db-manager"],
  },
]
