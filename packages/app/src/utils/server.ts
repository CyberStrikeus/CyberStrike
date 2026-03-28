import { createCyberstrikeClient } from "@cyberstrike-io/sdk/v2/client"
import type { ServerConnection } from "@/context/server"

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createCyberstrikeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${btoa(`${server.username ?? "cyberstrike"}:${server.password}`)}`,
    }
  })()

  return createCyberstrikeClient({
    ...config,
    headers: { ...config.headers, ...auth },
    baseUrl: server.url,
  })
}
