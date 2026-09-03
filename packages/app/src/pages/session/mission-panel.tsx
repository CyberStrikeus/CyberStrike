import { For, Show, createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import type {
  MethodologyAssetCoverageResponse,
  MethodologyChainsResponse,
  MethodologyCoverageResponse,
  MethodologyPerformanceResponse,
  MethodologyStateResponse,
} from "@cyberstrike-io/sdk/v2/client"
import { Icon } from "@cyberstrike-io/ui/icon"
import { useSDK } from "@/context/sdk"
import { usePrompt } from "@/context/prompt"
import { useServer } from "@/context/server"
import { useWorkbench } from "@/context/workbench"

const text = (value: unknown) => (typeof value === "string" ? value : "")
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

const stateDot = (status: string) => {
  if (status === "completed") return "bg-icon-success-base"
  if (status === "in_progress") return "bg-icon-warning-base"
  if (status === "blocked") return "bg-icon-danger-base"
  return "bg-surface-inset-base"
}

function Metric(props: { label: string; value: string | number; detail?: string }) {
  return (
    <div class="p-2 rounded bg-surface-base border border-border-weak-base min-w-0">
      <div class="text-10-medium text-text-weaker uppercase tracking-wider">{props.label}</div>
      <div class="mt-0.5 text-18-medium text-text-strong tabular-nums">{props.value}</div>
      <Show when={props.detail}>
        <div class="text-10-regular text-text-weak truncate">{props.detail}</div>
      </Show>
    </div>
  )
}

export function MissionPanel() {
  const params = useParams()
  const sdk = useSDK()
  const prompt = usePrompt()
  const server = useServer()
  const workbench = useWorkbench()
  const [data, setData] = createStore<{
    state?: MethodologyStateResponse
    coverage?: MethodologyCoverageResponse
    assets: MethodologyAssetCoverageResponse
    chains: MethodologyChainsResponse
    agents: MethodologyPerformanceResponse
    loading: boolean
    error: string
  }>({
    assets: [],
    chains: [],
    agents: [],
    loading: false,
    error: "",
  })

  let generation = 0
  const load = async () => {
    const sessionID = params.id
    if (!sessionID) return
    const request = ++generation
    setData({ loading: true, error: "" })
    try {
      const [state, coverage, assets, chains, agents] = await Promise.all([
        sdk.client.methodology.state({ sessionID }),
        sdk.client.methodology.coverage({ sessionID }),
        sdk.client.methodology.assetCoverage({ sessionID }),
        sdk.client.methodology.chains({ sessionID }),
        sdk.client.methodology.performance({ sessionID }),
      ])
      if (request !== generation || params.id !== sessionID) return
      setData({
        state: state.data,
        coverage: coverage.data,
        assets: assets.data ?? [],
        chains: chains.data ?? [],
        agents: agents.data ?? [],
        loading: false,
        error: "",
      })
    } catch (cause) {
      if (request !== generation || params.id !== sessionID) return
      setData({
        loading: false,
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  createEffect(() => {
    params.id
    void load()
    const timer = setInterval(load, 30_000)
    onCleanup(() => {
      generation++
      clearInterval(timer)
    })
  })

  createEffect(on(() => workbench.revision("mission"), () => void load(), { defer: true }))

  const blocking = createMemo(() => data.state?.violations.filter((item) => item.severity === "blocking") ?? [])
  const warnings = createMemo(() => data.state?.violations.filter((item) => item.severity !== "blocking") ?? [])
  const active = createMemo(
    () =>
      data.agents
        .filter((item) => item.stats.missionsCompleted > 0)
        .sort((a, b) => b.stats.performanceScore - a.stats.performanceScore),
  )
  const actions = createMemo(() => {
    const result = [
      {
        id: "coverage",
        title: "Close coverage gaps",
        detail: `Review untested checks and continue ${data.state?.currentPhase ?? "the current methodology phase"}.`,
        risk: "Read-only",
        prompt: `Review the current methodology state and per-asset coverage. Identify the highest-value untested checks, explain why they matter, and propose the next scoped actions. Do not execute active tests until I approve the plan.`,
      },
      {
        id: "report",
        title: "Prepare report",
        detail: "Compile validated findings, evidence, coverage, and remediation priorities.",
        risk: "Read-only",
        prompt: `Compile the current engagement report. Include only validated findings, evidence provenance, methodology coverage, limitations, and prioritized remediation. Flag anything that still requires verification.`,
      },
    ]
    const chain = data.chains[0]
    if (chain) {
      result.unshift({
        id: "chain",
        title: "Investigate top attack path",
        detail: text(chain.expectedImpact) || text(chain.pattern) || "Review the highest-confidence chain candidate.",
        risk: "Active approval",
        prompt: `Review the highest-confidence attack-chain candidate (${text(chain.pattern)}). Show the supporting evidence, exact authorized scope, prerequisites, request/command preview, expected impact, stop conditions, and rollback. Wait for approval before executing any active step.`,
      })
    }
    return result
  })

  const prepare = (value: string) => {
    prompt.set([{ type: "text", content: value, start: 0, end: value.length }], value.length)
  }

  return (
    <div class="flex flex-col gap-3 pb-4">
      <div class="flex items-center justify-between px-2">
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">Mission posture</span>
        <Show when={data.loading}>
          <span class="text-10-regular text-text-weaker">Refreshing...</span>
        </Show>
        <Show when={!data.loading && workbench.last("mission") > 0}>
          <span class="text-10-mono text-text-weaker">
            Live · {new Date(workbench.last("mission")).toLocaleTimeString()}
          </span>
        </Show>
      </div>

      <Show when={!params.id}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">Select a session to view mission posture</div>
      </Show>
      <Show when={data.error}>
        <div class="mx-2 px-2 py-1.5 rounded bg-surface-critical-base text-11-regular text-text-critical-base">
          {data.error}
        </div>
      </Show>

      <Show when={params.id && data.state && data.coverage}>
        <div class="grid grid-cols-2 gap-2 px-2">
          <Metric
            label="Methodology"
            value={`${data.state!.completionPercent}%`}
            detail={`${data.state!.completedCount}/${data.state!.totalCount} phases`}
          />
          <Metric
            label="Coverage"
            value={`${data.coverage!.coveragePercent}%`}
            detail={`${data.coverage!.completedChecks}/${data.coverage!.totalChecks} checks`}
          />
          <Metric label="Findings" value={data.coverage!.vulnerableChecks} detail="Vulnerable checks" />
          <Metric label="Chains" value={data.chains.length} detail="Attack opportunities" />
        </div>

        <Show when={server.role() !== "observer"}>
          <section class="px-2">
            <div class="mb-1.5 text-10-medium text-text-weaker uppercase tracking-wider">Action center</div>
            <div class="flex flex-col gap-1">
              <For each={actions()}>
                {(action) => (
                  <button
                    type="button"
                    class="w-full p-2 rounded bg-surface-base border border-border-weak-base text-left hover:border-border-strong"
                    onClick={() => prepare(action.prompt)}
                  >
                    <div class="flex items-center gap-2">
                      <span class="flex-1 text-11-medium text-text-strong">{action.title}</span>
                      <span
                        class="px-1.5 py-0.5 rounded text-10-medium"
                        classList={{
                          "bg-surface-info-base text-text-info-base": action.risk === "Read-only",
                          "bg-surface-warning-base text-text-warning-base": action.risk !== "Read-only",
                        }}
                      >
                        {action.risk}
                      </span>
                    </div>
                    <div class="mt-0.5 text-10-regular text-text-weak">{action.detail}</div>
                    <div class="mt-1 text-10-medium text-text-accent">Prepare in prompt →</div>
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>

        <section class="px-2">
          <div class="mb-1.5 text-10-medium text-text-weaker uppercase tracking-wider">Phases</div>
          <div class="flex flex-col rounded border border-border-weak-base overflow-hidden">
            <For each={data.state!.phases}>
              {(phase) => (
                <div class="flex items-center gap-2 px-2 py-1.5 border-b border-border-weak-base last:border-b-0">
                  <span class={`size-1.5 rounded-full shrink-0 ${stateDot(phase.status)}`} />
                  <span class="flex-1 min-w-0 text-11-regular text-text-base truncate">{phase.name}</span>
                  <span class="text-10-mono text-text-weaker tabular-nums">{phase.deliverableCount}</span>
                </div>
              )}
            </For>
          </div>
        </section>

        <Show when={blocking().length > 0 || warnings().length > 0}>
          <section class="px-2">
            <div class="mb-1.5 text-10-medium text-text-weaker uppercase tracking-wider">
              Validation · {blocking().length} blocking · {warnings().length} warnings
            </div>
            <div class="flex flex-col gap-1">
              <For each={[...blocking(), ...warnings()]}>
                {(violation) => (
                  <div
                    class="flex items-start gap-2 px-2 py-1.5 rounded"
                    classList={{
                      "bg-surface-critical-base text-text-critical-base": violation.severity === "blocking",
                      "bg-surface-warning-base text-text-warning-base": violation.severity !== "blocking",
                    }}
                  >
                    <Icon name="circle-ban-sign" size="small" />
                    <span class="text-11-regular">{violation.message}</span>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={data.chains.length > 0}>
          <section class="px-2">
            <div class="mb-1.5 text-10-medium text-text-weaker uppercase tracking-wider">Attack paths</div>
            <div class="flex flex-col gap-1">
              <For each={data.chains.slice(0, 8)}>
                {(chain) => (
                  <div class="px-2 py-1.5 rounded bg-surface-base border border-border-weak-base">
                    <div class="flex items-center gap-2">
                      <span class="text-11-medium text-text-strong truncate flex-1">
                        {text(chain.pattern) || "Candidate chain"}
                      </span>
                      <span class="text-10-mono text-text-weaker">{Math.round(number(chain.confidence))}%</span>
                    </div>
                    <div class="text-10-regular text-text-weak truncate">
                      {text(chain.expectedImpact) || text(chain.testingPlan)}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={data.assets.length > 0}>
          <section class="px-2">
            <div class="mb-1.5 text-10-medium text-text-weaker uppercase tracking-wider">Asset coverage</div>
            <div class="flex flex-col gap-1">
              <For each={data.assets.slice(0, 12)}>
                {(asset) => (
                  <div class="flex items-center gap-2">
                    <span class="w-24 text-10-mono text-text-weak truncate" title={asset.asset}>
                      {asset.asset}
                    </span>
                    <div class="h-1.5 flex-1 rounded-full bg-surface-inset-base overflow-hidden">
                      <div
                        class="h-full bg-icon-accent-base"
                        style={{ width: `${Math.max(0, Math.min(asset.coveragePercent, 100))}%` }}
                      />
                    </div>
                    <span class="w-8 text-right text-10-mono text-text-weaker">{asset.coveragePercent}%</span>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={active().length > 0}>
          <section class="px-2">
            <div class="mb-1.5 text-10-medium text-text-weaker uppercase tracking-wider">Agent performance</div>
            <div class="flex flex-col gap-1">
              <For each={active()}>
                {(agent) => (
                  <div class="flex items-center gap-2 px-2 py-1 rounded bg-surface-base">
                    <span class="flex-1 text-11-regular text-text-base truncate">{agent.agent}</span>
                    <span class="text-10-mono text-text-weaker">{agent.stats.missionsCompleted} missions</span>
                    <span class="w-7 text-right text-10-mono text-text-accent">{agent.stats.performanceScore}</span>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>
      </Show>
    </div>
  )
}
