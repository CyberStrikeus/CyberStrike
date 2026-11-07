export * from "./client.js"
export * from "./server.js"
export * from "./commands.js"

import { createClient } from "./client.js"
import { createServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createCyberstrike(options?: ServerOptions) {
  const server = await createServer({
    ...options,
  })

  const client = createClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
