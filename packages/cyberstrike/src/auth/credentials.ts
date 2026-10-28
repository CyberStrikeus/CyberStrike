import { Credential } from "@opencode/schema/credential"
import { Schema } from "effect"
import path from "path"
import { Global } from "../global"
import { Auth } from "./index"

// Labeled credentials per integration. The v1 Auth record stays the single source of the active credential:
// every activation writes it into Auth, and an Auth record written elsewhere (v1 login or logout) is adopted here.
export namespace Credentials {
  // Encoded shapes: plain strings, so callers decode them through the protocol schema at the boundary.
  export type Entry = typeof Credential.Entry.Encoded
  export type Value = typeof Credential.Value.Encoded

  const filepath = path.join(Global.Path.data, "credentials.json")

  const read = async () => {
    const data: unknown = await Bun.file(filepath).json().catch(() => [])
    if (!Array.isArray(data)) return []
    return data.filter(Schema.is(Credential.Entry))
  }

  const write = (entries: Entry[]) =>
    Bun.write(Bun.file(filepath), JSON.stringify(entries, null, 2), { mode: 0o600 })

  const pick = (metadata: Record<string, unknown> | undefined, key: string) => {
    const found = metadata?.[key]
    return typeof found === "string" ? { [key]: found } : {}
  }

  // The v1 record has no label, method or metadata slot for external credentials, so only key and OAuth values map.
  export function toAuth(value: Value): Auth.Info | undefined {
    if (value.type === "key") return { type: "api", key: value.key }
    if (value.type === "oauth")
      return {
        type: "oauth",
        refresh: value.refresh,
        access: value.access,
        expires: value.expires,
        ...pick(value.metadata, "accountId"),
        ...pick(value.metadata, "enterpriseUrl"),
      }
    return undefined
  }

  // v1 OAuth records carry no method ID, so the stored credential uses the generic "oauth" method.
  const fromAuth = (info: Auth.Info): Value | undefined => {
    if (info.type === "api") return { type: "key", key: info.key }
    if (info.type === "oauth")
      return {
        type: "oauth",
        methodID: "oauth",
        refresh: info.refresh,
        access: info.access,
        expires: info.expires,
        metadata: {
          ...(info.accountId === undefined ? {} : { accountId: info.accountId }),
          ...(info.enterpriseUrl === undefined ? {} : { enterpriseUrl: info.enterpriseUrl }),
        },
      }
    return undefined
  }

  // Makes the stored list agree with the v1 Auth record for every integration that has either.
  const reconcile = (stored: Entry[], auth: Record<string, Auth.Info>) => {
    const ids = [...new Set([...stored.map((entry) => entry.integrationID), ...Object.keys(auth)])]
    return ids.flatMap((id) => {
      const mine = stored.filter((entry) => entry.integrationID === id)
      const active = mine.find((entry) => entry.active)
      const expected = active ? toAuth(active.value) : undefined
      const actual = auth[id]
      if (Bun.deepEquals(expected, actual)) return mine
      const value = actual && fromAuth(actual)
      const deactivated = mine.map((entry) => ({ ...entry, active: false }))
      if (!value) return deactivated
      // A v1 record that differs from the stored active credential becomes the active one under the legacy ID.
      const legacy = `cred_${id}`
      const label = mine.find((entry) => entry.id === legacy)?.label ?? id
      return [
        { id: legacy, integrationID: id, label, active: true, value },
        ...deactivated.filter((entry) => entry.id !== legacy),
      ]
    })
  }

  async function sync() {
    const stored = await read()
    const next = reconcile(stored, await Auth.all())
    if (!Bun.deepEquals(next, stored)) await write(next)
    return next
  }

  // Writes the list and then the active value of the integration into the v1 Auth record.
  async function commit(entries: Entry[], integrationID: string) {
    await write(entries)
    const active = entries.find((entry) => entry.integrationID === integrationID && entry.active)
    const info = active ? toAuth(active.value) : undefined
    if (info) return Auth.set(integrationID, info)
    return Auth.remove(integrationID)
  }

  export function list() {
    return sync()
  }

  // Undefined means the ID is already taken. Without activate: false, a new credential becomes active.
  export async function create(input: {
    id?: string
    integrationID: string
    label?: string
    value: Value
    activate?: boolean
  }) {
    const all = await sync()
    const id = input.id ?? Credential.ID.create()
    if (all.some((entry) => entry.id === id)) return undefined
    const mine = all.filter((entry) => entry.integrationID === input.integrationID)
    const active = !(input.activate === false && mine.length > 0)
    const entry: Entry = {
      id,
      integrationID: input.integrationID,
      label: input.label ?? input.integrationID,
      active,
      value: input.value,
    }
    const kept = active
      ? all.map((item) => (item.integrationID === input.integrationID ? { ...item, active: false } : item))
      : all
    await commit([...kept, entry], input.integrationID)
    return entry
  }

  export async function update(id: string, label: string) {
    const all = await sync()
    if (!all.some((entry) => entry.id === id)) return false
    await write(all.map((entry) => (entry.id === id ? { ...entry, label } : entry)))
    return true
  }

  export async function activate(id: string) {
    const all = await sync()
    const target = all.find((entry) => entry.id === id)
    if (!target) return false
    await commit(
      all.map((entry) =>
        entry.integrationID === target.integrationID ? { ...entry, active: entry.id === id } : entry,
      ),
      target.integrationID,
    )
    return true
  }

  // Removing the active credential leaves the integration without one; no other credential is promoted.
  export async function remove(id: string) {
    const all = await sync()
    const target = all.find((entry) => entry.id === id)
    if (!target) return false
    await commit(
      all.filter((entry) => entry.id !== id),
      target.integrationID,
    )
    return true
  }
}
