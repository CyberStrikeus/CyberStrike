#!/usr/bin/env bun
// Migrate knowledge/ markdown files to .cyberstrike/skill/ SKILL.md format
// Usage: bun run packages/cyberstrike/script/migrate-knowledge.ts
import path from "path"

const root = path.resolve(import.meta.dir, "../../..")
const knowledgeDir = path.join(root, "knowledge", "web-application")
const skillDir = path.join(root, ".cyberstrike", "skill")

const categoryMap: Record<string, { label: string; tags: string[] }> = {
  INFO: { label: "information-gathering", tags: ["recon", "fingerprint", "enumeration"] },
  CONF: { label: "configuration", tags: ["misconfiguration", "hardening", "server"] },
  IDNT: { label: "identity-management", tags: ["identity", "user-enum", "roles"] },
  ATHN: { label: "authentication", tags: ["authentication", "login", "credentials", "mfa"] },
  AUTHZ: { label: "authorization", tags: ["authorization", "access-control", "privilege"] },
  SESS: { label: "session-management", tags: ["session", "cookies", "csrf", "token"] },
  INPV: { label: "input-validation", tags: ["injection", "input-validation", "xss", "sqli"] },
  ERRH: { label: "error-handling", tags: ["error-handling", "information-leak", "stack-trace"] },
  CRYP: { label: "cryptography", tags: ["cryptography", "tls", "ssl", "encryption"] },
  BUSL: { label: "business-logic", tags: ["business-logic", "workflow", "abuse"] },
  CLNT: { label: "client-side", tags: ["client-side", "javascript", "dom", "cors"] },
  APIT: { label: "api-testing", tags: ["api", "rest", "graphql", "soap"] },
}

const cweMap: Record<string, string[]> = {
  "INPV-01": ["CWE-93"],
  "INPV-02": ["CWE-79"],
  "INPV-03": ["CWE-89"],
  "INPV-04": ["CWE-94"],
  "INPV-05": ["CWE-89", "CWE-564"],
  "INPV-06": ["CWE-90"],
  "INPV-07": ["CWE-91"],
  "INPV-08": ["CWE-90"],
  "INPV-09": ["CWE-78"],
  "INPV-10": ["CWE-601"],
  "INPV-11": ["CWE-94", "CWE-95"],
  "ATHN-01": ["CWE-522"],
  "ATHN-02": ["CWE-640"],
  "ATHN-03": ["CWE-304"],
  "ATHN-04": ["CWE-307"],
  "ATHN-05": ["CWE-287"],
  "ATHN-06": ["CWE-613"],
  "ATHN-07": ["CWE-287"],
  "ATHN-08": ["CWE-287"],
  "ATHN-09": ["CWE-521"],
  "ATHN-10": ["CWE-287"],
  "AUTHZ-01": ["CWE-639"],
  "AUTHZ-02": ["CWE-639"],
  "AUTHZ-03": ["CWE-269"],
  "AUTHZ-04": ["CWE-639"],
  "SESS-01": ["CWE-539"],
  "SESS-02": ["CWE-384"],
  "SESS-03": ["CWE-613"],
  "SESS-04": ["CWE-614"],
  "SESS-05": ["CWE-352"],
  "SESS-06": ["CWE-613"],
  "SESS-07": ["CWE-384"],
  "SESS-08": ["CWE-200"],
  "SESS-09": ["CWE-384"],
  "CONF-01": ["CWE-16"],
  "CONF-02": ["CWE-16"],
  "CONF-03": ["CWE-200"],
  "CONF-04": ["CWE-16"],
  "CONF-05": ["CWE-548"],
  "CONF-06": ["CWE-200"],
  "CONF-07": ["CWE-200"],
  "CONF-08": ["CWE-16"],
  "CONF-09": ["CWE-434"],
  "CONF-10": ["CWE-16"],
  "CONF-11": ["CWE-16"],
  "INFO-01": ["CWE-200"],
  "INFO-02": ["CWE-200"],
  "INFO-03": ["CWE-200"],
  "INFO-04": ["CWE-200"],
  "INFO-05": ["CWE-200"],
  "INFO-06": ["CWE-200"],
  "INFO-07": ["CWE-200"],
  "INFO-08": ["CWE-200"],
  "INFO-09": ["CWE-200"],
  "INFO-10": ["CWE-200"],
  "ERRH-01": ["CWE-209"],
  "ERRH-02": ["CWE-209"],
  "CRYP-01": ["CWE-326"],
  "CRYP-02": ["CWE-326"],
  "CRYP-03": ["CWE-311"],
  "CRYP-04": ["CWE-327"],
  "BUSL-01": ["CWE-840"],
  "BUSL-02": ["CWE-840"],
  "BUSL-03": ["CWE-840"],
  "BUSL-04": ["CWE-840"],
  "BUSL-05": ["CWE-840"],
  "BUSL-06": ["CWE-840"],
  "BUSL-07": ["CWE-840"],
  "BUSL-08": ["CWE-840"],
  "BUSL-09": ["CWE-840"],
  "CLNT-01": ["CWE-79"],
  "CLNT-02": ["CWE-79"],
  "CLNT-03": ["CWE-94"],
  "CLNT-04": ["CWE-601"],
  "CLNT-05": ["CWE-94"],
  "CLNT-06": ["CWE-200"],
  "CLNT-07": ["CWE-942"],
  "CLNT-08": ["CWE-1021"],
  "CLNT-09": ["CWE-922"],
  "CLNT-10": ["CWE-200"],
  "CLNT-11": ["CWE-79"],
  "CLNT-12": ["CWE-79"],
  "CLNT-13": ["CWE-942"],
  "APIT-01": ["CWE-200"],
  "APIT-02": ["CWE-200"],
  "APIT-03": ["CWE-89"],
  "APIT-04": ["CWE-200"],
}

const chainMap: Record<string, { chains_with: string[]; prerequisites: string[] }> = {
  "INPV-05": {
    chains_with: ["wstg-authz-02", "wstg-conf-05", "wstg-inpv-06"],
    prerequisites: ["wstg-info-01", "wstg-info-06"],
  },
  "INPV-02": { chains_with: ["wstg-sess-05", "wstg-athn-05", "wstg-clnt-01"], prerequisites: ["wstg-info-01"] },
  "INPV-09": { chains_with: ["wstg-inpv-05", "wstg-conf-05"], prerequisites: ["wstg-info-01", "wstg-info-06"] },
  "INPV-06": { chains_with: ["wstg-athn-05", "wstg-authz-02"], prerequisites: ["wstg-info-06"] },
  "INPV-10": { chains_with: ["wstg-inpv-02", "wstg-sess-05"], prerequisites: ["wstg-info-01"] },
  "AUTHZ-02": { chains_with: ["wstg-inpv-05", "wstg-athn-05", "wstg-authz-03"], prerequisites: ["wstg-athn-01"] },
  "AUTHZ-03": { chains_with: ["wstg-authz-02", "wstg-athn-05"], prerequisites: ["wstg-athn-01", "wstg-idnt-01"] },
  "ATHN-05": { chains_with: ["wstg-authz-02", "wstg-sess-01"], prerequisites: ["wstg-idnt-01"] },
  "ATHN-04": { chains_with: ["wstg-athn-05", "wstg-athn-02"], prerequisites: ["wstg-idnt-01"] },
  "SESS-05": { chains_with: ["wstg-inpv-02", "wstg-athn-05"], prerequisites: ["wstg-sess-01"] },
  "CONF-05": { chains_with: ["wstg-inpv-05", "wstg-inpv-09", "wstg-info-06"], prerequisites: ["wstg-info-01"] },
  "INFO-01": { chains_with: ["wstg-info-06", "wstg-conf-01"], prerequisites: [] },
  "INFO-06": { chains_with: ["wstg-inpv-05", "wstg-inpv-09", "wstg-conf-05"], prerequisites: ["wstg-info-01"] },
}

const severityBoostMap: Record<string, Record<string, string>> = {
  "INPV-05": {
    "wstg-authz-02": "SQLi + IDOR = Account Takeover (Critical)",
    "wstg-conf-05": "SQLi + Directory Listing = Full DB Dump (Critical)",
  },
  "INPV-02": {
    "wstg-sess-05": "XSS + CSRF = Session Hijack (Critical)",
    "wstg-athn-05": "XSS + Auth Bypass = Account Takeover (Critical)",
  },
  "INPV-09": {
    "wstg-inpv-05": "Command Injection + SQLi = Full System Compromise (Critical)",
  },
  "AUTHZ-02": {
    "wstg-inpv-05": "IDOR + SQLi = Mass Data Breach (Critical)",
    "wstg-authz-03": "IDOR + Privilege Escalation = Admin Access (Critical)",
  },
}

const techStackMap: Record<string, string[]> = {
  "INPV-05": ["mysql", "postgresql", "mssql", "oracle", "sqlite", "php", "java", "python", "nodejs"],
  "INPV-02": ["javascript", "html", "php", "java", "python", "nodejs", "react", "angular", "vue"],
  "INPV-06": ["ldap", "activedirectory", "openldap"],
  "INPV-07": ["xml", "xpath"],
  "INPV-09": ["linux", "windows", "php", "python", "nodejs", "ruby"],
  "INPV-11": ["python", "ruby", "php", "java", "jinja2", "twig", "freemarker"],
  "INPV-04": ["php", "asp", "jsp"],
  "CRYP-01": ["tls", "ssl", "openssl"],
  "CRYP-02": ["tls", "ssl"],
  "CONF-01": ["apache", "nginx", "iis", "tomcat"],
  "CONF-05": ["apache", "nginx", "iis"],
  "CONF-09": ["php", "java", "asp", "nodejs"],
  "APIT-01": ["rest", "graphql", "soap", "grpc"],
  "APIT-03": ["graphql"],
  "CLNT-07": ["cors", "javascript"],
  "CLNT-08": ["html", "javascript"],
  "SESS-01": ["cookies", "jwt", "session"],
  "SESS-05": ["html", "javascript", "cookies"],
}

async function migrate() {
  const glob = new Bun.Glob("WSTG-*/WSTG-*.md")
  const files: string[] = []
  for await (const file of glob.scan({ cwd: knowledgeDir, absolute: false })) {
    files.push(file)
  }
  files.sort()

  let created = 0
  let skipped = 0

  for (const relPath of files) {
    const full = path.join(knowledgeDir, relPath)
    const content = await Bun.file(full).text()

    const titleMatch = content.match(/^#\s+(WSTG-(\w+)-(\d+(?:\.\d+)?))[:\s]+(.+)$/m)
    if (!titleMatch) {
      console.log(`  SKIP (no title): ${relPath}`)
      skipped++
      continue
    }

    const owaspId = titleMatch[1]
    const catCode = titleMatch[2]
    const testNum = titleMatch[3]
    const testName = titleMatch[4].trim()
    const shortKey = `${catCode}-${testNum}`
    const name = owaspId.toLowerCase()
    const destDir = path.join(skillDir, name)
    const destFile = path.join(destDir, "SKILL.md")

    if (await Bun.file(destFile).exists()) {
      console.log(`  EXISTS: ${name}`)
      skipped++
      continue
    }

    const cat = categoryMap[catCode]
    const cweIds = cweMap[shortKey] ?? []
    const chains = chainMap[shortKey]
    const boosts = severityBoostMap[shortKey]
    const techStack = techStackMap[shortKey] ?? []
    const tags = [...(cat?.tags ?? []), "wstg", catCode.toLowerCase()]

    const frontmatter = [
      "---",
      `name: ${name}`,
      `description: "${testName}"`,
      `category: ${cat?.label ?? "other"}`,
      `owasp_id: ${owaspId}`,
      `version: "1.0.0"`,
      `author: cyberstrike-official`,
      `tags: [${tags.join(", ")}]`,
      `tech_stack: [${techStack.join(", ")}]`,
      `cwe_ids: [${cweIds.join(", ")}]`,
      `chains_with: [${(chains?.chains_with ?? []).join(", ")}]`,
      `prerequisites: [${(chains?.prerequisites ?? []).join(", ")}]`,
    ]

    if (boosts && Object.keys(boosts).length > 0) {
      frontmatter.push("severity_boost:")
      for (const [target, desc] of Object.entries(boosts)) {
        frontmatter.push(`  ${target}: "${desc}"`)
      }
    } else {
      frontmatter.push("severity_boost: {}")
    }

    frontmatter.push("---")

    const body = content.replace(/^#\s+.+$/m, `# ${name}`).trim()
    const output = frontmatter.join("\n") + "\n\n" + body + "\n"

    await Bun.write(destFile, output)
    created++
    console.log(`  CREATED: ${name}`)
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped`)
}

migrate().catch((e) => {
  console.error(e)
  process.exit(1)
})
