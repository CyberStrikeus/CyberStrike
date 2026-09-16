// v2 NewLayout (Phase B spike) — ported from upstream `pages/layout-new.tsx`.
//
// Structure preserved: a v2-token frame (bg-v2-*) hosting a titlebar tab strip
// over a scrollable main region, with a toast region. Reductions vs upstream:
//   - upstream `components/titlebar` -> `components/titlebar-v2` (adapter-fed,
//     single-server; see that file for what was dropped)
//   - upstream `DebugBar` / `help-button` TabsInfoPopup / `platform.updater`
//     update banner omitted (not required for the shell to render)
//   - `@/utils/toast` is the local shim (legacy toaster; no v2 toaster yet)
import { Suspense, createEffect, type ParentProps } from "solid-js"
import { TitlebarV2 } from "@/components/titlebar-v2"
import { setV2Toast, ToastRegion } from "@/utils/toast"

export default function NewLayout(props: ParentProps) {
  createEffect(() => setV2Toast(true))

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <TitlebarV2 />
      <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
        <Suspense>{props.children}</Suspense>
      </main>
      <ToastRegion v2 />
    </div>
  )
}
