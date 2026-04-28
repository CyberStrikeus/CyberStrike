/**
 * Build the display string for a captured endpoint's host.
 * Returns "host:port", omitting the port when it is missing or a
 * scheme default (80/443) — same convention browser address bars use,
 * so production URLs stay clean while localhost:3000 keeps its port.
 *
 * Both fields are optional in the underlying schema; old captures
 * may have nullish host (rare). Returns "" if host is missing.
 */
export function formatEndpointHost(host: string | undefined, port: number | undefined): string {
  if (!host) return ""
  if (port == null || port === 80 || port === 443) return host
  return `${host}:${port}`
}
