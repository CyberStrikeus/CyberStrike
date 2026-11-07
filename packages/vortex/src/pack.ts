// Rule packs — the FILE-distributed unit of rules (the nuclei-templates equivalent). The source of
// truth for the large rule corpus is files (JSON), versioned SEPARATELY from the engine and loaded +
// selected at runtime — never baked into a build, because rules change far more often than the
// engine. A pack groups the three rule shapes; `loadPackDir` merges every *.json in a directory.
import z from "zod"
import type { Transaction } from "./transaction"
import { DeclarativeRuleSchema, type DeclarativeRule } from "./declarative"
import { ChainRuleSchema, type ChainRule } from "./chain"
import { AggregateRuleSchema, type AggregateRule } from "./aggregate"
import { ProbeRuleSchema, type ProbeRule } from "./probe"
import type { Context } from "./rule-meta"

export const PackSchema = z
  .object({
    name: z.string().optional(),
    declarative: z.array(DeclarativeRuleSchema).optional(),
    chains: z.array(ChainRuleSchema).optional(),
    aggregates: z.array(AggregateRuleSchema).optional(),
    probes: z.array(ProbeRuleSchema).optional(),
  })
  .strict()

export type Pack = z.infer<typeof PackSchema>

// Validate untrusted pack JSON (a file, or an agent's output), naming the bad field on failure.
export function parsePack(input: unknown): Pack {
  return PackSchema.parse(input)
}

// Merge many packs into one (concatenate each shape). Used after loading a directory of pack files.
export function mergePacks(packs: Pack[]): Pack {
  const out: Required<Omit<Pack, "name">> = { declarative: [], chains: [], aggregates: [], probes: [] }
  for (const p of packs) {
    if (p.declarative) out.declarative.push(...p.declarative)
    if (p.chains) out.chains.push(...p.chains)
    if (p.aggregates) out.aggregates.push(...p.aggregates)
    if (p.probes) out.probes.push(...p.probes)
  }
  return out
}

// Load + merge every *.json pack in a directory. Runtime, not build time — a rule update is a file
// change, not an engine release.
export async function loadPackDir(dir: string): Promise<Pack> {
  const { readdir } = await import("node:fs/promises")
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()
  const packs: Pack[] = []
  for (const f of files) packs.push(parsePack(JSON.parse(await Bun.file(`${dir}/${f}`).text())))
  return mergePacks(packs)
}

// The tech context for the selector: the union of tech markers observed across the corpus, so the
// selector can prune tech-gated rules (e.g. an apache-CVE rule when no response looked like Apache).
export function contextFromCorpus(txs: Transaction[]): Context {
  const tech = new Set<string>()
  for (const tx of txs) for (const t of tx.tech ?? []) tech.add(t)
  return { tech: [...tech] }
}

export type { DeclarativeRule, ChainRule, AggregateRule, ProbeRule }
