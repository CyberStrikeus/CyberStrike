import { Auth } from "../auth"
import { Config } from "../config/config"
import { Instance } from "../project/instance"

export interface DiscoveredModel {
  id: string
  owned_by?: string
}

function normalizeBaseURL(input: string): string {
  return input
    .replace(/\/+$/, "")
    .replace(/\/(chat\/)?completions$/, "")
    .replace(/\/models$/, "")
}

export async function discoverModels(baseURL: string, apiKey?: string): Promise<DiscoveredModel[]> {
  const base = normalizeBaseURL(baseURL)
  const url = base + "/models"
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`)

  const body = (await response.json()) as { data?: { id: string; owned_by?: string }[]; object?: string }
  if (!body.data || !Array.isArray(body.data)) throw new Error("Invalid response: missing data array")

  return body.data.map((m) => ({ id: m.id, owned_by: m.owned_by }))
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export async function addProvider(input: {
  name: string
  baseURL: string
  apiKey?: string
  models: DiscoveredModel[]
  scope: "project" | "global"
}) {
  const providerID = slugify(input.name)

  const models: Record<string, { name: string; tool_call: boolean; limit: { context: number; output: number } }> = {}
  for (const m of input.models) {
    models[m.id] = {
      name: m.id,
      tool_call: true,
      limit: { context: 131072, output: 32768 },
    }
  }

  const config: Config.Info = {
    provider: {
      [providerID]: {
        name: input.name,
        api: normalizeBaseURL(input.baseURL),
        models,
      },
    },
  }

  if (input.scope === "project") {
    await Config.update(config)
  } else {
    await Config.updateGlobal(config)
  }

  if (input.apiKey) {
    await Auth.set(providerID, { type: "api", key: input.apiKey })
  }

  await Instance.dispose()

  return { providerID, modelCount: input.models.length }
}
