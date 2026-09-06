export const METAFILE_PATHS = [
  { path: "/robots.txt", parser: "robots" as const },
  { path: "/sitemap.xml", parser: "sitemap" as const },
  { path: "/sitemap_index.xml", parser: "sitemap" as const },
  { path: "/.well-known/security.txt", parser: "text" as const },
  { path: "/crossdomain.xml", parser: "xml_urls" as const },
  { path: "/clientaccesspolicy.xml", parser: "xml_urls" as const },
  { path: "/humans.txt", parser: "text" as const },
  { path: "/.well-known/openid-configuration", parser: "json_urls" as const },
  { path: "/openapi.json", parser: "json_urls" as const },
  { path: "/swagger.json", parser: "json_urls" as const },
] as const

export type MetafileParser = (typeof METAFILE_PATHS)[number]["parser"]

export interface FingerprintProbe {
  path: string
  method: string
  tech: string
  evidence: RegExp
}

export const FINGERPRINT_PROBES: readonly FingerprintProbe[] = [
  { path: "/wp-login.php", method: "GET", tech: "WordPress", evidence: /wp-login|wordpress/i },
  { path: "/wp-includes/js/wp-emoji-release.min.js", method: "GET", tech: "WordPress", evidence: /twemoji|emoji/i },
  { path: "/administrator/index.php", method: "GET", tech: "Joomla", evidence: /joomla|com_login/i },
  { path: "/misc/drupal.js", method: "GET", tech: "Drupal", evidence: /drupal/i },
  { path: "/rails/info/routes", method: "GET", tech: "Ruby on Rails", evidence: /routes|rails/i },
  { path: "/actuator/info", method: "GET", tech: "Spring Boot", evidence: /"app"|"build"|"java"/i },
  { path: "/__debug__/", method: "GET", tech: "Django", evidence: /django|debug toolbar/i },
  { path: "/elmah.axd", method: "GET", tech: "ASP.NET", evidence: /elmah|error log/i },
  { path: "/server-status", method: "GET", tech: "Apache", evidence: /apache.*server.*status/i },
  { path: "/nginx_status", method: "GET", tech: "Nginx", evidence: /active connections|reading|writing/i },
]

export const LEAKAGE_PATTERNS = {
  html_comment: /<!--[\s\S]*?-->/g,
  internal_ip: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
  version_string: /(?:version|ver|v)\s*[:=]?\s*\d+\.\d+(?:\.\d+)?/gi,
  todo_fixme: /(?:TODO|FIXME|HACK|XXX|BUG|TEMP)[:\s].{5,80}/gi,
  email_address: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi,
  debug_flag: /(?:debug|verbose|dev.?mode)\s*[:=]\s*(?:true|1|on|yes)/gi,
}
