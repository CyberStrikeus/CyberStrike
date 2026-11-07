export * from "./client.js"
export * from "./server.js"
// NOTE: the command catalog is intentionally NOT re-exported here. This barrel pulls in server.js
// (node-only: child_process), so importing the catalog through it would drag node code into the
// browser app bundle. Import it from the dedicated pure subpath instead: "@cyberstrike-io/sdk/v2/commands".

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
