import path from "path"
import { Global } from "../global"
import { NamedError } from "@cyberstrike-io/util/error"
import z from "zod"

export const OAUTH_DUMMY_KEY = "cyberstrike-oauth-dummy-key"

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      accountId: z.string().optional(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  // A reference, not a secret: the credential is the value of the named environment variable, read at use time.
  export const External = z
    .object({
      type: z.literal("external"),
      env: z.string(),
    })
    .meta({ ref: "ExternalAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown, External]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  export const ExternalUnavailableError = NamedError.create(
    "AuthExternalUnavailable",
    z.object({
      env: z.string(),
      message: z.string(),
    }),
  )

  // The secret a record stands for. An external record whose variable is unset throws ExternalUnavailableError.
  export function resolve(info: Info | undefined) {
    if (info?.type === "api") return info.key
    if (info?.type !== "external") return undefined
    const value = process.env[info.env]
    if (value === undefined || value === "") {
      throw new ExternalUnavailableError({
        env: info.env,
        message: `Environment variable ${info.env} is not set`,
      })
    }
    return value
  }

  // False only for an external record whose variable is unset, so listings can skip it without throwing.
  export function available(info: Info | undefined) {
    if (info?.type !== "external") return true
    const value = process.env[info.env]
    return value !== undefined && value !== ""
  }

  const filepath = path.join(Global.Path.data, "auth.json")

  export async function get(providerID: string) {
    const auth = await all()
    return auth[providerID]
  }

  export async function all(): Promise<Record<string, Info>> {
    const file = Bun.file(filepath)
    const data = await file.json().catch(() => ({}) as Record<string, unknown>)
    return Object.entries(data).reduce(
      (acc, [key, value]) => {
        const parsed = Info.safeParse(value)
        if (!parsed.success) return acc
        acc[key] = parsed.data
        return acc
      },
      {} as Record<string, Info>,
    )
  }

  export async function set(key: string, info: Info) {
    const file = Bun.file(filepath)
    const data = await all()
    await Bun.write(file, JSON.stringify({ ...data, [key]: info }, null, 2), { mode: 0o600 })
  }

  export async function remove(key: string) {
    const file = Bun.file(filepath)
    const data = await all()
    delete data[key]
    await Bun.write(file, JSON.stringify(data, null, 2), { mode: 0o600 })
  }
}
