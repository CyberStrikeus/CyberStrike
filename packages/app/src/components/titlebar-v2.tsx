// Reduced v2 titlebar (Phase B spike).
//
// Upstream's `components/titlebar.tsx` (~673 lines) + `titlebar-tab-strip.tsx`
// (~417 lines) are welded to the multi-server tab machine (`context/tabs`,
// `context/global` per-server `ServerCtx`), the `@dnd-kit/*` drag stack, and v2
// UI components (`icon-button-v2`, `keybind-v2`, `tooltip-v2`) that CyberStrike's
// ui package does not yet ship. Rather than port that whole stack, this file is
// the presentational tab strip REDUCED to the single-server case and fed from
// the adapter (`context/tabs` shim -> a list of exactly one active tab).
//
// It proves the v2 shell frame renders behind the flag; it is NOT the full tab UX
// (no reorder, no close-history, no per-tab prompt state).
import { For, Show, createMemo } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { Icon } from "@cyberstrike-io/ui/icon"
import { IconButton } from "@cyberstrike-io/ui/icon-button"
import { Tooltip } from "@cyberstrike-io/ui/tooltip"
import { useServer } from "@/context/server"
import { tabHref, tabKey, useTabs, type Tab } from "@/context/tabs"

function tabLabel(tab: Tab) {
  if (tab.type === "draft") return "New session"
  return tab.sessionId.slice(0, 8)
}

export function TitlebarV2() {
  const server = useServer()
  const tabs = useTabs()
  const navigate = useNavigate()
  const location = useLocation()

  const canGoBack = createMemo(() => location.pathname !== "/")

  return (
    <div
      data-component="titlebar-v2"
      class="shrink-0 h-10 min-w-0 flex items-stretch gap-1 px-2 bg-v2-background-bg-base border-b border-v2-border-border-weak"
    >
      <div class="flex items-center gap-0.5 pr-1">
        <IconButton
          icon="arrow-left"
          variant="ghost"
          size="small"
          disabled={!canGoBack()}
          aria-label="Back"
          onClick={() => navigate(-1)}
        />
        <IconButton icon="arrow-right" variant="ghost" size="small" aria-label="Forward" onClick={() => navigate(1)} />
      </div>

      <div class="flex-1 min-w-0 flex items-stretch gap-1 overflow-x-auto no-scrollbar">
        <For each={tabs.store()}>
          {(tab) => {
            const active = createMemo(() => tabs.active() && tabKey(tabs.active()!) === tabKey(tab))
            return (
              <button
                type="button"
                classList={{
                  "flex items-center gap-2 px-3 my-1 rounded-md text-12-medium min-w-0 max-w-52 truncate": true,
                  "bg-v2-background-bg-raised text-v2-text-text-strong": !!active(),
                  "text-v2-text-text-base hover:bg-v2-background-bg-raised": !active(),
                }}
                onClick={() => navigate(tabHref(tab))}
              >
                <Icon name="code-lines" size="small" />
                <span class="truncate">{tabLabel(tab)}</span>
              </button>
            )
          }}
        </For>
        <Show when={tabs.store().length === 0}>
          <span class="flex items-center px-3 text-12-regular text-v2-text-text-weak">{server.name || server.url}</span>
        </Show>
      </div>

      <div class="flex items-center gap-0.5 pl-1">
        <Tooltip placement="bottom" value={server.name || server.url}>
          <span class="flex items-center px-2 text-11-medium text-v2-text-text-weak truncate max-w-40">
            {server.name || server.url}
          </span>
        </Tooltip>
      </div>
    </div>
  )
}
