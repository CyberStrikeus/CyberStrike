import { Component, createResource, createSignal, For, Show } from "solid-js"
import { ButtonV2 } from "@cyberstrike-io/ui/v2/button-v2"
import { SelectV2 } from "@cyberstrike-io/ui/v2/select-v2"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import "./settings-v2.css"

const LINE_OPTIONS = ["100", "500", "1000", "2000"]

export const SettingsLogsV2: Component = () => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const [maxLines, setMaxLines] = createSignal("500")
  const [filter, setFilter] = createSignal("")

  const [logs, { refetch }] = createResource(
    () => ({ lines: maxLines(), sdk: serverSdk() }),
    async (source) => {
      const url = source.sdk.url
      if (!url) return { path: "", lines: [] as string[] }
      const res = await fetch(`${url}/global/log?lines=${source.lines}`)
      if (!res.ok) return { path: "", lines: [] as string[] }
      return res.json() as Promise<{ path: string; lines: string[] }>
    },
    { initialValue: { path: "", lines: [] as string[] } },
  )

  const filtered = () => {
    const f = filter().toLowerCase()
    if (!f) return logs()?.lines ?? []
    return (logs()?.lines ?? []).filter((line) => line.toLowerCase().includes(f))
  }

  const levelColor = (line: string) => {
    if (line.startsWith("ERROR")) return "settings-v2-log-error"
    if (line.startsWith("WARN")) return "settings-v2-log-warn"
    if (line.startsWith("DEBUG")) return "settings-v2-log-debug"
    return ""
  }

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked">
        <div class="settings-v2-tab-header-row">
          <h3 class="settings-v2-tab-title">{language.t("settings.logs.title")}</h3>
          <div class="settings-v2-logs-actions">
            <SelectV2
              appearance="inline"
              options={LINE_OPTIONS}
              current={maxLines()}
              onSelect={(v) => { if (v) setMaxLines(v) }}
              label={(v) => `${v} lines`}
              placement="bottom-end"
              gutter={6}
            />
            <ButtonV2 size="small" variant="outline" onClick={() => refetch()}>
              {language.t("settings.logs.refresh")}
            </ButtonV2>
          </div>
        </div>
        <div class="settings-v2-logs-search">
          <input
            type="text"
            placeholder={language.t("settings.logs.filter")}
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
            class="settings-v2-logs-filter-input"
          />
        </div>
      </div>
      <div class="settings-v2-tab-body settings-v2-logs">
        <Show when={logs()?.path}>
          <span class="settings-v2-logs-path">{logs()?.path}</span>
        </Show>
        <div class="settings-v2-logs-container">
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="settings-v2-logs-empty">{language.t("settings.logs.empty")}</div>
            }
          >
            <For each={filtered()}>
              {(line) => (
                <div class={`settings-v2-log-line ${levelColor(line)}`}>{line}</div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </>
  )
}
