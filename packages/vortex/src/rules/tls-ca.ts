// TLS certificate authority detection rules. Two detection paths per CA:
// 1. tls.issuer — from the TLS handshake (proxy adapter, browser extension with cert access)
// 2. resp.body — site seals, trust badges, JS widgets embedded in pages (passive fallback)
// Category "technology", severity "info". Signals route to wstg-info-gathering and
// wstg-cryptography for CA-specific checks (cert pinning, CT compliance, revocation).
import type { DeclarativeRule } from "../declarative"

export const tlsCaRules: DeclarativeRule[] = [
  {
    id: "tech-ca-sectigo",
    category: "technology",
    severity: "info",
    when: 'regex("sectigo|comodo", tls.issuer) || regex("seal\\.sectigo\\.com|seal\\.comodoca\\.com|sectigo-trust-seal|comodo.?secure|sectigo.?site.?seal", resp.body)',
    message: "TLS CA detected: sectigo at {endpoint}",
    dedupBy: "host",
    tags: ["tech", "tls-ca"],
  },
  {
    id: "tech-ca-aws-acm",
    category: "technology",
    severity: "info",
    when: 'regex("amazon", tls.issuer)',
    message: "TLS CA detected: aws-acm at {endpoint}",
    dedupBy: "host",
    tags: ["tech", "tls-ca"],
  },
  {
    id: "tech-ca-digicert",
    category: "technology",
    severity: "info",
    when: 'regex("digicert", tls.issuer) || regex("seal\\.digicert\\.com|digicert\\.com/seal|DigiCertClickID|norton.?secured.?seal|symantec\\.com/seal", resp.body)',
    message: "TLS CA detected: digicert at {endpoint}",
    dedupBy: "host",
    tags: ["tech", "tls-ca"],
  },
  {
    id: "tech-ca-thawte",
    category: "technology",
    severity: "info",
    when: 'regex("thawte", tls.issuer) || regex("seal\\.thawte\\.com|thawte.?site.?seal|thawte\\.com/ssl", resp.body)',
    message: "TLS CA detected: thawte at {endpoint}",
    dedupBy: "host",
    tags: ["tech", "tls-ca"],
  },
  {
    id: "tech-ca-letsencrypt",
    category: "technology",
    severity: "info",
    when: 'regex("let.?s encrypt|letsencrypt|isrg", tls.issuer)',
    message: "TLS CA detected: letsencrypt at {endpoint}",
    dedupBy: "host",
    tags: ["tech", "tls-ca"],
  },
  {
    id: "tech-ca-identrust",
    category: "technology",
    severity: "info",
    when: 'regex("identrust|iden trust", tls.issuer)',
    message: "TLS CA detected: identrust at {endpoint}",
    dedupBy: "host",
    tags: ["tech", "tls-ca"],
  },
  {
    id: "tech-ca-entrust",
    category: "technology",
    severity: "info",
    when: 'regex("entrust", tls.issuer) || regex("seal\\.entrust\\.net|entrust\\.net/seal|entrust.?site.?seal", resp.body)',
    message: "TLS CA detected: entrust at {endpoint}",
    dedupBy: "host",
    tags: ["tech", "tls-ca"],
  },
]
