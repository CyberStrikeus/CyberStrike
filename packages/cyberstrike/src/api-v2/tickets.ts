import { Context } from "effect"

export function tickets() {
  const entries = new Map<string, { id: string; directory: string; expires: number }>()
  return {
    issue(id: string, directory: string) {
      entries.forEach((entry, key) => {
        if (entry.expires <= Date.now()) entries.delete(key)
      })
      const ticket = crypto.randomUUID()
      entries.set(ticket, { id, directory, expires: Date.now() + 30_000 })
      return { ticket, expires_in: 30 }
    },
    consume(ticket: string, id: string, directory: string) {
      const entry = entries.get(ticket)
      if (!entry || entry.expires <= Date.now() || entry.id !== id || entry.directory !== directory) return false
      entries.delete(ticket)
      return true
    },
  }
}

export class Tickets extends Context.Service<Tickets, ReturnType<typeof tickets>>()("@cyberstrike/api-v2/Tickets") {}
