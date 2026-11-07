// Wordlists for active misconfiguration probing (plan §05 misconfig_test).
// Backup-file suffixes, admin paths, sensitive files, and HTTP methods.
// Pure data — no I/O. The probe orchestrator appends these to a base URL
// and sends via the shared HttpSender; the P0 signal fabric auto-classifies
// the responses (ExposedArtifact, DirectoryListing, ServerBanner, etc.).

export interface WordlistEntry {
  value: string
  category: WordlistCategory
  note: string
}

export type WordlistCategory = "backup" | "admin" | "sensitive_file" | "http_method"

const BACKUP_SUFFIXES: readonly string[] = [
  ".bak", ".old", ".orig", ".save", ".swp", ".swo",
  "~", ".copy", ".tmp", ".temp",
  ".bkp", ".backup", ".dist",
  ".1", ".2",
]

const BACKUP_PATTERNS: readonly string[] = [
  "web.config.bak", "web.config.old",
  ".htaccess.bak", ".htaccess.old",
  "config.php.bak", "config.php.old", "config.php~",
  "settings.py.bak", "settings.py.old",
  "application.yml.bak", "application.properties.bak",
  "database.yml.bak",
  "wp-config.php.bak", "wp-config.php.old",
]

const ADMIN_PATHS: readonly string[] = [
  "/admin", "/admin/", "/administrator", "/administrator/",
  "/wp-admin", "/wp-admin/", "/wp-login.php",
  "/admin/login", "/admin/dashboard",
  "/panel", "/cpanel", "/webmail",
  "/phpmyadmin", "/pma", "/adminer", "/adminer.php",
  "/manager", "/manager/html",
  "/console", "/jmx-console",
  "/admin-console",
  "/_admin", "/__admin",
  "/backstage", "/cms", "/cms/admin",
  "/controlpanel", "/dashboard", "/manage",
  "/siteadmin", "/webadmin",
]

const SENSITIVE_FILES: readonly string[] = [
  "/.env", "/.env.local", "/.env.production", "/.env.staging",
  "/.git/HEAD", "/.git/config",
  "/.gitignore", "/.dockerignore",
  "/robots.txt", "/sitemap.xml",
  "/.well-known/security.txt",
  "/crossdomain.xml", "/clientaccesspolicy.xml",
  "/server-status", "/server-info",
  "/elmah.axd", "/trace.axd",
  "/phpinfo.php", "/info.php",
  "/.DS_Store", "/Thumbs.db",
  "/WEB-INF/web.xml",
  "/META-INF/MANIFEST.MF",
  "/composer.json", "/package.json",
  "/Gemfile", "/requirements.txt",
  "/Dockerfile", "/docker-compose.yml",
  "/.svn/entries", "/.hg/hgrc",
  "/debug", "/debug/default/view",
  "/_debug_toolbar/",
  "/actuator", "/actuator/health", "/actuator/env",
  "/swagger.json", "/swagger-ui.html", "/api-docs",
  "/graphql", "/graphiql",
]

const HTTP_METHODS: readonly string[] = [
  "OPTIONS", "PUT", "DELETE", "PATCH",
  "TRACE", "CONNECT",
  "PROPFIND", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK",
]

export namespace Wordlists {
  export function backupSuffixes(): readonly string[] {
    return BACKUP_SUFFIXES
  }

  export function backupPatterns(): readonly string[] {
    return BACKUP_PATTERNS
  }

  export function adminPaths(): readonly string[] {
    return ADMIN_PATHS
  }

  export function sensitiveFiles(): readonly string[] {
    return SENSITIVE_FILES
  }

  export function httpMethods(): readonly string[] {
    return HTTP_METHODS
  }

  export function select(opts?: { categories?: WordlistCategory[]; limit?: number }): WordlistEntry[] {
    const cats = opts?.categories ?? (["backup", "admin", "sensitive_file", "http_method"] as WordlistCategory[])
    let out: WordlistEntry[] = []

    if (cats.includes("backup")) {
      for (const s of BACKUP_SUFFIXES) out.push({ value: s, category: "backup", note: `backup suffix: ${s}` })
      for (const p of BACKUP_PATTERNS) out.push({ value: `/${p}`, category: "backup", note: `backup file: ${p}` })
    }
    if (cats.includes("admin")) {
      for (const p of ADMIN_PATHS) out.push({ value: p, category: "admin", note: `admin path: ${p}` })
    }
    if (cats.includes("sensitive_file")) {
      for (const f of SENSITIVE_FILES) out.push({ value: f, category: "sensitive_file", note: `sensitive file: ${f}` })
    }
    if (cats.includes("http_method")) {
      for (const m of HTTP_METHODS) out.push({ value: m, category: "http_method", note: `HTTP method: ${m}` })
    }

    if (opts?.limit && opts.limit > 0) out = out.slice(0, opts.limit)
    return out
  }
}
