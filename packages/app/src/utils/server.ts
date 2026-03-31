import { createCyberstrikeClient } from "@cyberstrike-io/sdk/v2/client"
import type { ServerConnection } from "@/context/server"

export function basicAuth(username: string, password: string): string {
  const credentials = `${username}:${password}`
  const bytes = new TextEncoder().encode(credentials)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createCyberstrikeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: basicAuth(server.username ?? "cyberstrike", server.password),
    }
  })()

  return createCyberstrikeClient({
    ...config,
    headers: { ...config.headers, ...auth },
    baseUrl: server.url,
  })
}
